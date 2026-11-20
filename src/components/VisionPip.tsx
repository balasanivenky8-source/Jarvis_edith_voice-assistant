import React, { useEffect, useRef, useState } from "react";
import { Eye, Minimize2, Maximize2, SwitchCamera, X } from "lucide-react";
import { CameraFacingMode, VisionMode } from "../types/assistant";

interface VisionPipProps {
  mode: VisionMode;
  facingMode: CameraFacingMode;
  stream: MediaStream | null;
  onFlipCamera: () => void;
  onClose: () => void;
}

export const VisionPip: React.FC<VisionPipProps> = ({
  mode,
  facingMode,
  stream,
  onFlipCamera,
  onClose,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [minimized, setMinimized] = useState(false);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    if (stream) {
      el.srcObject = stream;
      void el.play().catch(() => {});
    } else {
      el.srcObject = null;
    }
  }, [stream, minimized]);

  if (mode === "off" || !stream) return null;

  return (
    <aside
      aria-label={mode === "camera" ? "Camera vision feed" : "Screen vision feed"}
      className="fixed top-16 right-4 sm:top-20 sm:right-6 z-30 transition-all duration-200"
    >
      {minimized ? (
        <div className="flex items-center gap-1 rounded-2xl border border-white/12 bg-[#0e1118]/90 backdrop-blur-xl px-2 py-1 shadow-xl">
          <button
            type="button"
            onClick={() => setMinimized(false)}
            className="flex items-center gap-2 min-h-[44px] px-2.5 text-xs font-medium text-slate-200 hover:text-white cursor-pointer"
          >
            <Eye className="h-4 w-4 text-sky-400" />
            <span>{mode === "camera" ? "Camera Eyes" : "Screen Eyes"}</span>
            <Maximize2 className="h-3.5 w-3.5 text-slate-400" />
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Stop vision"
            className="flex h-11 w-11 items-center justify-center rounded-xl text-slate-400 hover:text-white hover:bg-white/8 cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <div className="w-40 sm:w-56 overflow-hidden rounded-2xl border border-white/12 bg-[#0d1017]/95 backdrop-blur-xl shadow-2xl">
          <div className="relative aspect-[4/3] bg-black">
            <video
              ref={videoRef}
              muted
              playsInline
              autoPlay
              className={`h-full w-full object-cover ${
                mode === "camera" && facingMode === "user" ? "scale-x-[-1]" : ""
              }`}
            />
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-black/80 to-transparent" />
            <div className="absolute bottom-2 left-2.5 right-2.5 flex items-center justify-between text-[11px] font-medium text-slate-200">
              <span>{mode === "camera" ? "Camera Eyes" : "Screen Eyes"}</span>
            </div>
          </div>

          <div className="flex items-center justify-between border-t border-white/8 px-1.5 py-1">
            <div className="flex items-center">
              {mode === "camera" && (
                <button
                  type="button"
                  onClick={onFlipCamera}
                  aria-label="Flip camera lens"
                  className="flex h-11 w-11 items-center justify-center rounded-xl text-slate-300 hover:bg-white/8 hover:text-white transition-colors cursor-pointer"
                >
                  <SwitchCamera className="h-4 w-4" />
                </button>
              )}
              <button
                type="button"
                onClick={() => setMinimized(true)}
                aria-label="Minimize vision preview"
                className="flex h-11 w-11 items-center justify-center rounded-xl text-slate-300 hover:bg-white/8 hover:text-white transition-colors cursor-pointer"
              >
                <Minimize2 className="h-4 w-4" />
              </button>
            </div>

            <button
              type="button"
              onClick={onClose}
              aria-label="Turn off vision"
              className="flex h-11 w-11 items-center justify-center rounded-xl text-rose-300 hover:bg-rose-500/15 hover:text-rose-200 transition-colors cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </aside>
  );
};
