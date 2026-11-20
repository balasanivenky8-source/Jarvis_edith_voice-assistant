import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  Camera,
  CameraOff,
  Mic,
  MicOff,
  MonitorOff,
  MonitorUp,
  X,
} from "lucide-react";
import { ActionPortalToast } from "./components/ActionPortalToast";
import { VisionPip } from "./components/VisionPip";
import { VoiceCore } from "./components/VoiceCore";
import { LiveSession } from "./services/LiveSession";
import {
  AssistantState,
  AudioLevels,
  CameraFacingMode,
  ToolActionFeedback,
  VisionMode,
} from "./types/assistant";

function formatElapsed(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

export default function App() {
  const [state, setState] = useState<AssistantState>("disconnected");
  const [isMuted, setIsMuted] = useState(false);
  const [visionMode, setVisionMode] = useState<VisionMode>("off");
  const [visionStream, setVisionStream] = useState<MediaStream | null>(null);
  const [facingMode, setFacingMode] = useState<CameraFacingMode>("user");
  const [toolAction, setToolAction] = useState<ToolActionFeedback | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  const levelsRef = useRef<AudioLevels>({
    inputLevel: 0,
    outputLevel: 0,
    spectrum: new Array(24).fill(0),
  });

  const sessionRef = useRef<LiveSession | null>(null);
  const actionTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    const session = new LiveSession({
      onStateChange: (nextState) => {
        setState(nextState);
        if (nextState === "disconnected") {
          setIsMuted(false);
          setElapsedSeconds(0);
          levelsRef.current = {
            inputLevel: 0,
            outputLevel: 0,
            spectrum: new Array(24).fill(0),
          };
        }
      },
      onVisionChange: (mode, stream) => {
        setVisionMode(mode);
        setVisionStream(stream);
        if (sessionRef.current) {
          setFacingMode(sessionRef.current.getCameraFacing());
        }
      },
      onLevels: (levels) => {
        levelsRef.current = levels;
      },
      onToolAction: (action) => {
        setToolAction(action);
        if (actionTimeoutRef.current !== null) {
          window.clearTimeout(actionTimeoutRef.current);
        }
        actionTimeoutRef.current = window.setTimeout(() => {
          setToolAction(null);
        }, 7000);
      },
      onError: (msg) => {
        setErrorMessage(msg);
      },
    });

    sessionRef.current = session;

    return () => {
      if (actionTimeoutRef.current !== null) {
        window.clearTimeout(actionTimeoutRef.current);
      }
      session.disconnect();
      sessionRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (state !== "listening" && state !== "speaking") return;
    const timer = window.setInterval(() => {
      setElapsedSeconds((prev) => prev + 1);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [state]);

  const handleToggleSession = useCallback(async () => {
    const session = sessionRef.current;
    if (!session) return;
    setErrorMessage(null);

    if (state === "disconnected") {
      await session.connect();
    } else {
      session.disconnect();
    }
  }, [state]);

  const handleToggleMute = useCallback(() => {
    const session = sessionRef.current;
    if (!session || state === "disconnected") return;
    const next = !isMuted;
    session.setMuted(next);
    setIsMuted(next);
  }, [isMuted, state]);

  const handleToggleCamera = useCallback(async () => {
    const session = sessionRef.current;
    if (!session) return;
    setErrorMessage(null);

    try {
      if (state === "disconnected") {
        await session.connect();
      }
      await session.toggleCameraVision();
    } catch {
      // Error surfaced via LiveSession.onError
    }
  }, [state]);

  const handleFlipCamera = useCallback(async () => {
    const session = sessionRef.current;
    if (!session) return;
    try {
      await session.flipCameraLens();
      setFacingMode(session.getCameraFacing());
    } catch {
      // Error surfaced via LiveSession.onError
    }
  }, []);

  const handleToggleScreen = useCallback(async () => {
    const session = sessionRef.current;
    if (!session) return;
    setErrorMessage(null);

    try {
      if (state === "disconnected") {
        await session.connect();
      }
      await session.toggleScreenVision();
    } catch {
      // Error surfaced via LiveSession.onError
    }
  }, [state]);

  const isConnected = state === "listening" || state === "speaking";

  return (
    <div className="relative flex h-[100dvh] w-full flex-col justify-between overflow-hidden bg-[#06070b] text-slate-100">
      {/* Subtle architectural dark field */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(30,41,59,0.28)_0%,rgba(6,7,11,0.96)_68%)]"
      />

      {/* Minimal Top Bar */}
      <header className="relative z-20 flex items-center justify-between px-5 pt-4 pb-2 sm:px-8 sm:pt-6">
        <span className="font-display text-lg font-semibold tracking-tight text-white whitespace-nowrap shrink-0">
          Jarvis
        </span>

        <div className="flex items-center gap-3 text-xs text-slate-400 whitespace-nowrap shrink-0">
          {isConnected ? (
            <>
              <span className="text-slate-300">
                {state === "speaking" ? "Voice Active" : isMuted ? "Muted" : "Live Audio"}
              </span>
              <span aria-hidden="true">·</span>
              <span className="font-mono-tabular text-slate-300">
                {formatElapsed(elapsedSeconds)}
              </span>
            </>
          ) : (
            <span>{state === "connecting" ? "Connecting" : "Audio Standby"}</span>
          )}
          {typeof window !== "undefined" &&
            (
              window as Window & {
                JarvisAndroid?: { promptServerUrl?: () => void };
              }
            ).JarvisAndroid?.promptServerUrl && (
              <>
                <span aria-hidden="true">·</span>
                <button
                  type="button"
                  onClick={() =>
                    (
                      window as Window & {
                        JarvisAndroid?: { promptServerUrl?: () => void };
                      }
                    ).JarvisAndroid?.promptServerUrl?.()
                  }
                  className="text-sky-300 hover:text-sky-200 underline underline-offset-4 py-2 cursor-pointer"
                >
                  Server
                </button>
              </>
            )}
        </div>
      </header>

      {/* Action / Error Overlays */}
      <ActionPortalToast
        action={toolAction}
        onDismiss={() => setToolAction(null)}
      />

      {errorMessage && (
        <div
          role="alert"
          className="fixed top-16 left-1/2 -translate-x-1/2 z-50 w-[calc(100%-2rem)] max-w-md"
        >
          <div className="flex items-center justify-between gap-3 rounded-2xl border border-rose-500/30 bg-[#170d12]/95 backdrop-blur-xl px-4 py-3 text-sm text-rose-100 shadow-2xl">
            <div className="flex items-center gap-2.5 min-w-0">
              <AlertCircle className="h-4 w-4 shrink-0 text-rose-400" />
              <p className="truncate">{errorMessage}</p>
            </div>
            <button
              type="button"
              onClick={() => setErrorMessage(null)}
              aria-label="Dismiss error"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-rose-300 hover:bg-white/10 cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* Floating Vision PiP when Camera or Screen Eyes are active */}
      <VisionPip
        mode={visionMode}
        facingMode={facingMode}
        stream={visionStream}
        onFlipCamera={handleFlipCamera}
        onClose={() => sessionRef.current?.stopVision()}
      />

      {/* Dominant Focal Stage: Central Voice Core */}
      <main className="relative z-10 flex flex-1 items-center justify-center px-4">
        <VoiceCore
          state={state}
          isMuted={isMuted}
          levelsRef={levelsRef}
          onToggleSession={handleToggleSession}
        />
      </main>

      {/* Mobile-First Thumb Zone Dock */}
      <footer className="relative z-20 flex items-center justify-center px-4 pb-6 pt-2 sm:pb-8">
        <nav
          aria-label="Voice and vision controls"
          className="flex items-center gap-3 sm:gap-4 rounded-2xl border border-white/10 bg-[#0d1018]/85 backdrop-blur-xl p-2 shadow-2xl"
        >
          {/* Mute / Unmute Mic */}
          <button
            type="button"
            onClick={handleToggleMute}
            disabled={!isConnected}
            aria-label={isMuted ? "Unmute microphone" : "Mute microphone"}
            aria-pressed={isMuted}
            className={`flex h-12 min-w-[48px] items-center justify-center gap-2 rounded-xl px-4 text-xs font-medium transition-all duration-150 whitespace-nowrap cursor-pointer disabled:opacity-35 disabled:cursor-not-allowed ${
              isMuted && isConnected
                ? "bg-rose-500/20 text-rose-200 border border-rose-400/35"
                : "text-slate-200 hover:bg-white/8 hover:text-white border border-transparent"
            }`}
          >
            {isMuted ? (
              <MicOff className="h-5 w-5" />
            ) : (
              <Mic className="h-5 w-5" />
            )}
            <span className="hidden sm:inline">{isMuted ? "Unmute" : "Mute"}</span>
          </button>

          {/* Camera Vision Eyes */}
          <button
            type="button"
            onClick={handleToggleCamera}
            aria-label={
              visionMode === "camera"
                ? "Turn off camera vision"
                : "Turn on camera vision"
            }
            aria-pressed={visionMode === "camera"}
            className={`flex h-12 min-w-[48px] items-center justify-center gap-2 rounded-xl px-4 text-xs font-medium transition-all duration-150 whitespace-nowrap cursor-pointer ${
              visionMode === "camera"
                ? "bg-sky-400/20 text-sky-200 border border-sky-400/40"
                : "text-slate-200 hover:bg-white/8 hover:text-white border border-transparent"
            }`}
          >
            {visionMode === "camera" ? (
              <Camera className="h-5 w-5 text-sky-300" />
            ) : (
              <CameraOff className="h-5 w-5" />
            )}
            <span>Camera</span>
          </button>

          {/* Screen Vision Eyes */}
          <button
            type="button"
            onClick={handleToggleScreen}
            aria-label={
              visionMode === "screen"
                ? "Turn off screen vision"
                : "Turn on screen vision"
            }
            aria-pressed={visionMode === "screen"}
            className={`flex h-12 min-w-[48px] items-center justify-center gap-2 rounded-xl px-4 text-xs font-medium transition-all duration-150 whitespace-nowrap cursor-pointer ${
              visionMode === "screen"
                ? "bg-sky-400/20 text-sky-200 border border-sky-400/40"
                : "text-slate-200 hover:bg-white/8 hover:text-white border border-transparent"
            }`}
          >
            {visionMode === "screen" ? (
              <MonitorUp className="h-5 w-5 text-sky-300" />
            ) : (
              <MonitorOff className="h-5 w-5" />
            )}
            <span>Screen</span>
          </button>
        </nav>
      </footer>
    </div>
  );
}
