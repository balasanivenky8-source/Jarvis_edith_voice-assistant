import { AudioLevels } from "../types/assistant";

const INPUT_SAMPLE_RATE = 16000;
const OUTPUT_SAMPLE_RATE = 24000;
const WORKLET_PROCESSOR_NAME = "jarvis-pcm16-capture";

const WORKLET_CODE = `
class JarvisPcmCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buffer = new Float32Array(2048);
    this._offset = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;
    const channel = input[0];
    for (let i = 0; i < channel.length; i++) {
      this._buffer[this._offset++] = channel[i];
      if (this._offset >= this._buffer.length) {
        this.port.postMessage(this._buffer.slice(0));
        this._offset = 0;
      }
    }
    return true;
  }
}
registerProcessor("${WORKLET_PROCESSOR_NAME}", JarvisPcmCaptureProcessor);
`;

function downsampleFloat32(
  buffer: Float32Array,
  fromRate: number,
  toRate: number
): Float32Array {
  if (fromRate === toRate) return buffer;
  const ratio = fromRate / toRate;
  const targetLength = Math.max(1, Math.round(buffer.length / ratio));
  const result = new Float32Array(targetLength);
  let offsetResult = 0;
  let offsetBuffer = 0;

  while (offsetResult < result.length) {
    const nextOffsetBuffer = Math.min(
      buffer.length,
      Math.round((offsetResult + 1) * ratio)
    );
    let accum = 0;
    let count = 0;
    for (let i = offsetBuffer; i < nextOffsetBuffer; i++) {
      accum += buffer[i];
      count++;
    }
    result[offsetResult] = count > 0 ? accum / count : 0;
    offsetResult++;
    offsetBuffer = nextOffsetBuffer;
  }
  return result;
}

function float32ToPcm16Base64(float32: Float32Array): string {
  const pcm16 = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    const clamped = Math.max(-1, Math.min(1, float32[i]));
    pcm16[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
  }
  const bytes = new Uint8Array(pcm16.buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}

function base64ToFloat32FromPcm16(base64: string): Float32Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const sampleCount = Math.floor(bytes.byteLength / 2);
  const view = new DataView(bytes.buffer, bytes.byteOffset, sampleCount * 2);
  const float32 = new Float32Array(sampleCount);
  for (let i = 0; i < sampleCount; i++) {
    float32[i] = view.getInt16(i * 2, true) / 32768;
  }
  return float32;
}

export interface AudioStreamerCallbacks {
  onAudioChunk: (base64Pcm16: string) => void;
  onPlaybackIdle?: () => void;
  onLevels?: (levels: AudioLevels) => void;
}

export class AudioStreamer {
  private callbacks: AudioStreamerCallbacks;
  private inputCtx: AudioContext | null = null;
  private outputCtx: AudioContext | null = null;
  private micStream: MediaStream | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private scriptProcessor: ScriptProcessorNode | null = null;
  private inputAnalyser: AnalyserNode | null = null;
  private outputAnalyser: AnalyserNode | null = null;
  private outputGain: GainNode | null = null;
  private activeSources = new Set<AudioBufferSourceNode>();
  private nextStartTime = 0;
  private isMuted = false;
  private workletUrl: string | null = null;
  private meterRafId: number | null = null;
  private inputFreqData = new Uint8Array(32);
  private outputFreqData = new Uint8Array(32);
  private turnCompletePending = false;

  constructor(callbacks: AudioStreamerCallbacks) {
    this.callbacks = callbacks;
  }

  async prepareContexts(): Promise<void> {
    if (!this.outputCtx || this.outputCtx.state === "closed") {
      this.outputCtx = new AudioContext({ sampleRate: OUTPUT_SAMPLE_RATE });
      this.outputAnalyser = this.outputCtx.createAnalyser();
      this.outputAnalyser.fftSize = 64;
      this.outputAnalyser.smoothingTimeConstant = 0.72;
      this.outputGain = this.outputCtx.createGain();
      this.outputGain.gain.value = 1;
      this.outputAnalyser.connect(this.outputGain);
      this.outputGain.connect(this.outputCtx.destination);
      this.outputFreqData = new Uint8Array(
        this.outputAnalyser.frequencyBinCount
      );
    }
    if (this.outputCtx.state === "suspended") {
      await this.outputCtx.resume();
    }

    if (!this.inputCtx || this.inputCtx.state === "closed") {
      this.inputCtx = new AudioContext({ sampleRate: INPUT_SAMPLE_RATE });
    }
    if (this.inputCtx.state === "suspended") {
      await this.inputCtx.resume();
    }
  }

  async startMic(): Promise<void> {
    await this.prepareContexts();
    if (!this.inputCtx) return;

    this.micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        sampleRate: { ideal: INPUT_SAMPLE_RATE },
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: false,
    });

    this.sourceNode = this.inputCtx.createMediaStreamSource(this.micStream);
    this.inputAnalyser = this.inputCtx.createAnalyser();
    this.inputAnalyser.fftSize = 64;
    this.inputAnalyser.smoothingTimeConstant = 0.7;
    this.inputFreqData = new Uint8Array(this.inputAnalyser.frequencyBinCount);
    this.sourceNode.connect(this.inputAnalyser);

    const actualRate = this.inputCtx.sampleRate;
    const handleFloatSamples = (rawSamples: Float32Array) => {
      if (this.isMuted) return;
      const resampled =
        actualRate === INPUT_SAMPLE_RATE
          ? rawSamples
          : downsampleFloat32(rawSamples, actualRate, INPUT_SAMPLE_RATE);
      const base64 = float32ToPcm16Base64(resampled);
      this.callbacks.onAudioChunk(base64);
    };

    const silentGain = this.inputCtx.createGain();
    silentGain.gain.value = 0;
    silentGain.connect(this.inputCtx.destination);

    if (this.inputCtx.audioWorklet) {
      try {
        const blob = new Blob([WORKLET_CODE], {
          type: "application/javascript",
        });
        this.workletUrl = URL.createObjectURL(blob);
        await this.inputCtx.audioWorklet.addModule(this.workletUrl);
        this.workletNode = new AudioWorkletNode(
          this.inputCtx,
          WORKLET_PROCESSOR_NAME
        );
        this.workletNode.port.onmessage = (event: MessageEvent<Float32Array>) => {
          handleFloatSamples(event.data);
        };
        this.sourceNode.connect(this.workletNode);
        this.workletNode.connect(silentGain);
      } catch {
        this.attachScriptProcessor(silentGain, handleFloatSamples);
      }
    } else {
      this.attachScriptProcessor(silentGain, handleFloatSamples);
    }

    this.startMeterLoop();
  }

  private attachScriptProcessor(
    silentGain: GainNode,
    onSamples: (samples: Float32Array) => void
  ) {
    if (!this.inputCtx || !this.sourceNode) return;
    this.scriptProcessor = this.inputCtx.createScriptProcessor(2048, 1, 1);
    this.scriptProcessor.onaudioprocess = (event) => {
      onSamples(event.inputBuffer.getChannelData(0));
    };
    this.sourceNode.connect(this.scriptProcessor);
    this.scriptProcessor.connect(silentGain);
  }

  playPcmChunk(base64Pcm16: string): void {
    if (!this.outputCtx || !this.outputAnalyser) return;
    if (this.outputCtx.state === "suspended") {
      void this.outputCtx.resume();
    }

    const float32 = base64ToFloat32FromPcm16(base64Pcm16);
    if (float32.length === 0) return;

    this.turnCompletePending = false;
    const buffer = this.outputCtx.createBuffer(
      1,
      float32.length,
      OUTPUT_SAMPLE_RATE
    );
    buffer.getChannelData(0).set(float32);

    const source = this.outputCtx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.outputAnalyser);

    const now = this.outputCtx.currentTime;
    if (this.nextStartTime < now) {
      this.nextStartTime = now + 0.025;
    }

    source.start(this.nextStartTime);
    this.nextStartTime += buffer.duration;
    this.activeSources.add(source);

    source.onended = () => {
      this.activeSources.delete(source);
      if (this.activeSources.size === 0 && this.turnCompletePending) {
        this.turnCompletePending = false;
        this.callbacks.onPlaybackIdle?.();
      }
    };
  }

  markTurnComplete(): void {
    if (this.activeSources.size === 0) {
      this.turnCompletePending = false;
      this.callbacks.onPlaybackIdle?.();
    } else {
      this.turnCompletePending = true;
    }
  }

  interrupt(): void {
    this.turnCompletePending = false;
    for (const source of this.activeSources) {
      try {
        source.onended = null;
        source.stop();
        source.disconnect();
      } catch {
        // Ignore already stopped sources
      }
    }
    this.activeSources.clear();
    if (this.outputCtx) {
      this.nextStartTime = this.outputCtx.currentTime;
    } else {
      this.nextStartTime = 0;
    }
  }

  setMuted(muted: boolean): void {
    this.isMuted = muted;
  }

  getMuted(): boolean {
    return this.isMuted;
  }

  hasActivePlayback(): boolean {
    return this.activeSources.size > 0;
  }

  private startMeterLoop(): void {
    if (this.meterRafId !== null) return;
    const tick = () => {
      let inputLevel = 0;
      let outputLevel = 0;
      const barCount = 24;
      const spectrum: number[] = new Array(barCount).fill(0);

      if (this.inputAnalyser && !this.isMuted) {
        this.inputAnalyser.getByteFrequencyData(this.inputFreqData);
        let sum = 0;
        for (let i = 0; i < this.inputFreqData.length; i++) {
          sum += this.inputFreqData[i];
        }
        inputLevel = Math.min(1, sum / (this.inputFreqData.length * 140));
      }

      if (this.outputAnalyser && this.activeSources.size > 0) {
        this.outputAnalyser.getByteFrequencyData(this.outputFreqData);
        let sum = 0;
        for (let i = 0; i < this.outputFreqData.length; i++) {
          sum += this.outputFreqData[i];
        }
        outputLevel = Math.min(1, sum / (this.outputFreqData.length * 135));
      }

      const activeBins =
        this.activeSources.size > 0 ? this.outputFreqData : this.inputFreqData;
      const isLiveInput = this.activeSources.size > 0 || !this.isMuted;

      if (isLiveInput && activeBins.length > 0) {
        for (let i = 0; i < barCount; i++) {
          const binIdx = Math.min(
            activeBins.length - 1,
            Math.floor((i / barCount) * Math.min(activeBins.length, 28))
          );
          spectrum[i] = activeBins[binIdx] / 255;
        }
      }

      this.callbacks.onLevels?.({ inputLevel, outputLevel, spectrum });
      this.meterRafId = requestAnimationFrame(tick);
    };
    this.meterRafId = requestAnimationFrame(tick);
  }

  stop(): void {
    if (this.meterRafId !== null) {
      cancelAnimationFrame(this.meterRafId);
      this.meterRafId = null;
    }

    this.interrupt();

    if (this.workletNode) {
      this.workletNode.port.onmessage = null;
      this.workletNode.disconnect();
      this.workletNode = null;
    }

    if (this.scriptProcessor) {
      this.scriptProcessor.onaudioprocess = null;
      this.scriptProcessor.disconnect();
      this.scriptProcessor = null;
    }

    if (this.sourceNode) {
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }

    if (this.micStream) {
      for (const track of this.micStream.getTracks()) {
        track.stop();
      }
      this.micStream = null;
    }

    if (this.workletUrl) {
      URL.revokeObjectURL(this.workletUrl);
      this.workletUrl = null;
    }

    if (this.inputCtx && this.inputCtx.state !== "closed") {
      void this.inputCtx.close();
    }
    this.inputCtx = null;

    if (this.outputCtx && this.outputCtx.state !== "closed") {
      void this.outputCtx.close();
    }
    this.outputCtx = null;
    this.inputAnalyser = null;
    this.outputAnalyser = null;
    this.outputGain = null;
    this.nextStartTime = 0;
  }
}
