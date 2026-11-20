import {
  AssistantState,
  AudioLevels,
  CameraFacingMode,
  LiveFunctionCall,
  LiveFunctionResponse,
  ToolActionFeedback,
  VisionMode,
} from "../types/assistant";
import { AudioStreamer } from "./AudioStreamer";
import { VisionStreamer } from "./VisionStreamer";

export interface LiveSessionCallbacks {
  onStateChange: (state: AssistantState) => void;
  onVisionChange: (mode: VisionMode, stream: MediaStream | null) => void;
  onLevels?: (levels: AudioLevels) => void;
  onToolAction?: (action: ToolActionFeedback) => void;
  onError?: (message: string) => void;
}

function normalizeUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "https://www.google.com";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

function triggerAnchorLaunch(url: string): boolean {
  try {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.target = "_blank";
    anchor.rel = "noopener noreferrer";
    anchor.style.display = "none";
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    return true;
  } catch {
    return false;
  }
}

export class LiveSession {
  private callbacks: LiveSessionCallbacks;
  private audioStreamer: AudioStreamer;
  private visionStreamer: VisionStreamer;
  private ws: WebSocket | null = null;
  private state: AssistantState = "disconnected";
  private isReady = false;

  constructor(callbacks: LiveSessionCallbacks) {
    this.callbacks = callbacks;

    this.audioStreamer = new AudioStreamer({
      onAudioChunk: (base64Pcm16) => {
        if (this.isReady && this.ws?.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify({ type: "audio", data: base64Pcm16 }));
        }
      },
      onPlaybackIdle: () => {
        if (this.state === "speaking") {
          this.setState("listening");
        }
      },
      onLevels: (levels) => {
        this.callbacks.onLevels?.(levels);
      },
    });

    this.visionStreamer = new VisionStreamer({
      onFrame: (base64Jpeg) => {
        if (this.isReady && this.ws?.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify({ type: "video", data: base64Jpeg }));
        }
      },
      onStateChange: (mode, stream) => {
        this.callbacks.onVisionChange(mode, stream);
      },
      onError: (msg) => {
        this.callbacks.onError?.(msg);
      },
    });
  }

  getState(): AssistantState {
    return this.state;
  }

  getVisionMode(): VisionMode {
    return this.visionStreamer.getMode();
  }

  getCameraFacing(): CameraFacingMode {
    return this.visionStreamer.getFacingMode();
  }

  private setState(next: AssistantState): void {
    if (this.state === next) return;
    this.state = next;
    this.callbacks.onStateChange(next);
  }

  async connect(): Promise<void> {
    if (this.state === "connecting" || this.state === "listening" || this.state === "speaking") {
      return;
    }

    this.setState("connecting");
    this.isReady = false;

    try {
      await this.audioStreamer.prepareContexts();
      await this.audioStreamer.startMic();
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : "Microphone access is required to talk with Jarvis.";
      this.callbacks.onError?.(msg);
      this.disconnect();
      return;
    }

    const androidBridge = (
      window as Window & {
        JarvisAndroid?: { getBackendUrl?: () => string };
      }
    ).JarvisAndroid;
    const customBackend = androidBridge?.getBackendUrl?.()?.trim();
    const backendHttpBase = customBackend
      ? customBackend.replace(/\/+$/, "")
      : null;

    let wsUrl: string;
    if (backendHttpBase) {
      wsUrl =
        backendHttpBase.replace(/^https:/i, "wss:").replace(/^http:/i, "ws:") +
        "/live";
    } else {
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      wsUrl = `${protocol}//${window.location.host}/live`;
    }

    const ws = new WebSocket(wsUrl);
    this.ws = ws;
    let errorReported = false;

    const diagnoseRemoteFailure = async (): Promise<string> => {
      if (!backendHttpBase) {
        return "WebSocket connection failed.";
      }
      try {
        const res = await fetch(`${backendHttpBase}/api/health`, {
          method: "GET",
          mode: "cors",
          redirect: "manual",
        });
        if (res.status === 404) {
          return "Live server not deployed at this URL (404). Publish the app or tap 'Server' to enter a live server URL.";
        }
        if (res.type === "opaqueredirect" || res.status === 302 || res.status === 401 || res.status === 403) {
          return "Server requires sign-in. Tap 'Server' and use 'Open in App' or enter a public server URL.";
        }
        if (!res.ok) {
          return `Server returned HTTP ${res.status}. Tap 'Server' to verify the live backend URL.`;
        }
        return "WebSocket upgrade failed on the live server. Check server logs or tap 'Server'.";
      } catch {
        return `Cannot reach ${backendHttpBase}. Check internet connection or tap 'Server' to update the URL.`;
      }
    };

    ws.onmessage = (event) => {
      try {
        const packet = JSON.parse(event.data);
        if (packet.type === "ready") {
          this.isReady = true;
          this.setState("listening");
        } else if (packet.type === "audio" && typeof packet.data === "string") {
          this.setState("speaking");
          this.audioStreamer.playPcmChunk(packet.data);
        } else if (packet.type === "interrupted") {
          this.audioStreamer.interrupt();
          this.setState("listening");
        } else if (packet.type === "turnComplete") {
          this.audioStreamer.markTurnComplete();
        } else if (
          packet.type === "toolCall" &&
          Array.isArray(packet.functionCalls)
        ) {
          void this.handleToolCalls(packet.functionCalls);
        } else if (packet.type === "error") {
          errorReported = true;
          this.callbacks.onError?.(
            typeof packet.message === "string"
              ? packet.message
              : "Live connection error."
          );
          this.disconnect();
        } else if (packet.type === "closed") {
          this.disconnect();
        }
      } catch (err) {
        console.error("Failed to parse server packet:", err);
      }
    };

    ws.onerror = () => {
      if (errorReported) return;
      errorReported = true;
      void diagnoseRemoteFailure().then((msg) => {
        this.callbacks.onError?.(msg);
      });
      this.disconnect();
    };

    ws.onclose = () => {
      if (!this.isReady && !errorReported) {
        errorReported = true;
        void diagnoseRemoteFailure().then((msg) => {
          this.callbacks.onError?.(msg);
        });
      }
      if (this.state !== "disconnected") {
        this.disconnect();
      }
    };
  }

  private async handleToolCalls(calls: LiveFunctionCall[]): Promise<void> {
    const responses: LiveFunctionResponse[] = [];

    for (const call of calls) {
      const name = call.name || "unknown";
      const args = call.args || {};
      let response: Record<string, unknown> = { ok: true };

      try {
        if (name === "openWebsite") {
          const url = normalizeUrl(String(args.url || ""));
          const label = args.label ? String(args.label) : new URL(url).hostname;
          triggerAnchorLaunch(url);
          this.callbacks.onToolAction?.({
            id: `${Date.now()}-${Math.random()}`,
            kind: "website",
            title: `Open ${label}`,
            subtitle: url,
            url,
            createdAt: Date.now(),
          });
          response = {
            status: "executed",
            url,
            label,
            note: "Launched site action and displayed direct link portal in UI.",
          };
        } else if (name === "searchWeb") {
          const query = String(args.query || "").trim();
          const url = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
          triggerAnchorLaunch(url);
          this.callbacks.onToolAction?.({
            id: `${Date.now()}-${Math.random()}`,
            kind: "search",
            title: `Search: ${query}`,
            subtitle: "Google Search",
            url,
            createdAt: Date.now(),
          });
          response = {
            status: "executed",
            query,
            url,
          };
        } else if (name === "enableCameraVision") {
          const facing: CameraFacingMode =
            args.facingMode === "environment" ? "environment" : "user";
          await this.visionStreamer.startCamera(facing);
          this.callbacks.onToolAction?.({
            id: `${Date.now()}-${Math.random()}`,
            kind: "vision",
            title: "Camera Eyes Active",
            subtitle: facing === "environment" ? "Rear Lens" : "Front Lens",
            createdAt: Date.now(),
          });
          response = {
            status: "active",
            mode: "camera",
            facingMode: facing,
          };
        } else if (name === "disableCameraVision") {
          if (this.visionStreamer.getMode() === "camera") {
            this.visionStreamer.stop();
          }
          response = { status: "disabled", mode: "off" };
        } else if (name === "switchCameraLens") {
          const facing: CameraFacingMode =
            args.facingMode === "environment" ? "environment" : "user";
          await this.visionStreamer.switchCameraFacing(facing);
          response = { status: "switched", facingMode: facing };
        } else if (name === "enableScreenVision") {
          await this.visionStreamer.startScreen();
          this.callbacks.onToolAction?.({
            id: `${Date.now()}-${Math.random()}`,
            kind: "vision",
            title: "Screen Eyes Active",
            subtitle: "Live Display Feed",
            createdAt: Date.now(),
          });
          response = { status: "active", mode: "screen" };
        } else if (name === "disableScreenVision") {
          if (this.visionStreamer.getMode() === "screen") {
            this.visionStreamer.stop();
          }
          response = { status: "disabled", mode: "off" };
        } else if (name === "copyToClipboard") {
          const text = String(args.text || "");
          const label = args.label ? String(args.label) : "Copied to clipboard";
          if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(text);
          }
          this.callbacks.onToolAction?.({
            id: `${Date.now()}-${Math.random()}`,
            kind: "clipboard",
            title: label,
            subtitle: text.slice(0, 60),
            createdAt: Date.now(),
          });
          response = { status: "copied", length: text.length };
        } else {
          response = { status: "unsupported", name };
        }
      } catch (err) {
        response = {
          status: "failed",
          error: err instanceof Error ? err.message : "Action failed",
        };
      }

      responses.push({
        id: call.id,
        name,
        response,
      });
    }

    if (this.ws?.readyState === WebSocket.OPEN && responses.length > 0) {
      this.ws.send(
        JSON.stringify({
          type: "toolResponse",
          functionResponses: responses,
        })
      );
    }
  }

  setMuted(muted: boolean): void {
    this.audioStreamer.setMuted(muted);
  }

  async toggleCameraVision(): Promise<void> {
    if (this.visionStreamer.getMode() === "camera") {
      this.visionStreamer.stop();
    } else {
      await this.visionStreamer.startCamera();
    }
  }

  async flipCameraLens(): Promise<void> {
    const next: CameraFacingMode =
      this.visionStreamer.getFacingMode() === "user" ? "environment" : "user";
    await this.visionStreamer.switchCameraFacing(next);
  }

  async toggleScreenVision(): Promise<void> {
    if (this.visionStreamer.getMode() === "screen") {
      this.visionStreamer.stop();
    } else {
      await this.visionStreamer.startScreen();
    }
  }

  stopVision(): void {
    this.visionStreamer.stop();
  }

  disconnect(): void {
    this.isReady = false;
    this.visionStreamer.stop();
    this.audioStreamer.stop();

    if (this.ws) {
      try {
        this.ws.onopen = null;
        this.ws.onmessage = null;
        this.ws.onerror = null;
        this.ws.onclose = null;
        if (
          this.ws.readyState === WebSocket.OPEN ||
          this.ws.readyState === WebSocket.CONNECTING
        ) {
          this.ws.close();
        }
      } catch {
        // Ignore close errors
      }
      this.ws = null;
    }

    this.setState("disconnected");
  }
}
