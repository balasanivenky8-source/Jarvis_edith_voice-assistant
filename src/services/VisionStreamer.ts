import { CameraFacingMode, VisionMode } from "../types/assistant";

export interface VisionStreamerCallbacks {
  onFrame: (base64Jpeg: string) => void;
  onStateChange: (mode: VisionMode, stream: MediaStream | null) => void;
  onError?: (message: string) => void;
}

const FRAME_INTERVAL_MS = 1000; // 1 FPS max per Gemini Live API guidelines
const MAX_FRAME_WIDTH = 640;
const JPEG_QUALITY = 0.72;

export class VisionStreamer {
  private callbacks: VisionStreamerCallbacks;
  private mode: VisionMode = "off";
  private facingMode: CameraFacingMode = "user";
  private stream: MediaStream | null = null;
  private videoEl: HTMLVideoElement | null = null;
  private canvasEl: HTMLCanvasElement | null = null;
  private intervalId: number | null = null;

  constructor(callbacks: VisionStreamerCallbacks) {
    this.callbacks = callbacks;
  }

  getMode(): VisionMode {
    return this.mode;
  }

  getFacingMode(): CameraFacingMode {
    return this.facingMode;
  }

  getStream(): MediaStream | null {
    return this.stream;
  }

  async startCamera(facingMode: CameraFacingMode = this.facingMode): Promise<void> {
    this.stop();
    this.facingMode = facingMode;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: facingMode },
          width: { ideal: 640 },
          height: { ideal: 480 },
        },
        audio: false,
      });

      this.attachStream(stream, "camera");
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "Camera permission denied or unavailable.";
      this.callbacks.onError?.(message);
      throw err;
    }
  }

  async switchCameraFacing(facingMode: CameraFacingMode): Promise<void> {
    this.facingMode = facingMode;
    if (this.mode === "camera") {
      await this.startCamera(facingMode);
    }
  }

  async startScreen(): Promise<void> {
    this.stop();

    if (!navigator.mediaDevices?.getDisplayMedia) {
      const msg = "Screen sharing is not supported on this browser.";
      this.callbacks.onError?.(msg);
      throw new Error(msg);
    }

    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 5, max: 15 },
        },
        audio: false,
      });

      this.attachStream(stream, "screen");
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "Screen sharing was cancelled or blocked.";
      this.callbacks.onError?.(message);
      throw err;
    }
  }

  private attachStream(stream: MediaStream, mode: VisionMode): void {
    this.stream = stream;
    this.mode = mode;

    const [videoTrack] = stream.getVideoTracks();
    if (videoTrack) {
      videoTrack.onended = () => {
        if (this.stream === stream) {
          this.stop();
        }
      };
    }

    const video = document.createElement("video");
    video.srcObject = stream;
    video.muted = true;
    video.playsInline = true;
    void video.play().catch(() => {});

    this.videoEl = video;
    this.canvasEl = document.createElement("canvas");

    this.callbacks.onStateChange(mode, stream);

    this.intervalId = window.setInterval(() => {
      this.captureAndEmitFrame();
    }, FRAME_INTERVAL_MS);
  }

  private captureAndEmitFrame(): void {
    if (!this.videoEl || !this.canvasEl || this.mode === "off") return;
    if (this.videoEl.readyState < 2) return;

    const vw = this.videoEl.videoWidth;
    const vh = this.videoEl.videoHeight;
    if (!vw || !vh) return;

    const scale = Math.min(1, MAX_FRAME_WIDTH / vw);
    const width = Math.max(1, Math.round(vw * scale));
    const height = Math.max(1, Math.round(vh * scale));

    this.canvasEl.width = width;
    this.canvasEl.height = height;

    const ctx = this.canvasEl.getContext("2d");
    if (!ctx) return;

    ctx.drawImage(this.videoEl, 0, 0, width, height);
    const dataUrl = this.canvasEl.toDataURL("image/jpeg", JPEG_QUALITY);
    const base64 = dataUrl.split(",")[1];
    if (base64) {
      this.callbacks.onFrame(base64);
    }
  }

  stop(): void {
    const wasActive = this.mode !== "off";

    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    if (this.stream) {
      for (const track of this.stream.getTracks()) {
        track.onended = null;
        track.stop();
      }
      this.stream = null;
    }

    if (this.videoEl) {
      this.videoEl.srcObject = null;
      this.videoEl = null;
    }

    this.canvasEl = null;
    this.mode = "off";

    if (wasActive) {
      this.callbacks.onStateChange("off", null);
    }
  }
}
