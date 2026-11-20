import React, { useEffect, useRef } from "react";
import { Mic, MicOff, Power } from "lucide-react";
import { AssistantState, AudioLevels } from "../types/assistant";

interface VoiceCoreProps {
  state: AssistantState;
  isMuted: boolean;
  levelsRef: React.RefObject<AudioLevels>;
  onToggleSession: () => void;
}

const STATE_COPY: Record<
  AssistantState,
  { label: string; hint: string }
> = {
  disconnected: {
    label: "Standby",
    hint: "Tap the core to wake Jarvis",
  },
  connecting: {
    label: "Connecting",
    hint: "Opening live voice channel",
  },
  listening: {
    label: "Listening",
    hint: "Speak naturally — interrupt anytime",
  },
  speaking: {
    label: "Speaking",
    hint: "Tap anytime to interrupt or end",
  },
};

export const VoiceCore: React.FC<VoiceCoreProps> = ({
  state,
  isMuted,
  levelsRef,
  onToggleSession,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stateRef = useRef<AssistantState>(state);
  const mutedRef = useRef<boolean>(isMuted);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    mutedRef.current = isMuted;
  }, [isMuted]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let rafId = 0;
    let phase = 0;
    let smoothLevel = 0;

    const prefersReducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;

    const render = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const size = 340;
      if (canvas.width !== size * dpr || canvas.height !== size * dpr) {
        canvas.width = size * dpr;
        canvas.height = size * dpr;
      }

      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, size, size);

      const cx = size / 2;
      const cy = size / 2;
      const currentState = stateRef.current;
      const muted = mutedRef.current;
      const levels = levelsRef.current;

      const targetLevel =
        currentState === "speaking"
          ? levels.outputLevel
          : currentState === "listening" && !muted
            ? levels.inputLevel
            : currentState === "connecting"
              ? 0.22
              : 0.04;

      smoothLevel += (targetLevel - smoothLevel) * 0.22;
      if (!prefersReducedMotion) {
        phase += currentState === "speaking" ? 0.055 : currentState === "connecting" ? 0.045 : 0.018;
      }

      const rgb =
        currentState === "speaking"
          ? "251, 113, 133" // Warm coral-rose
          : currentState === "listening"
            ? muted
              ? "148, 163, 184" // Muted slate
              : "56, 189, 248" // Luminous ice-cyan
            : currentState === "connecting"
              ? "125, 211, 252"
              : "148, 163, 184";

      // Outer subtle acoustic rings
      const baseRadius = 86 + smoothLevel * 18;
      for (let ring = 0; ring < 2; ring++) {
        const ringRadius = baseRadius + ring * 22 + Math.sin(phase + ring) * 3;
        ctx.beginPath();
        ctx.arc(cx, cy, ringRadius, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(${rgb}, ${ring === 0 ? 0.22 + smoothLevel * 0.25 : 0.09})`;
        ctx.lineWidth = ring === 0 ? 1.5 : 1;
        ctx.stroke();
      }

      // Radial spectrum / harmonic bars
      const bars = 48;
      const spectrum = levels.spectrum;
      for (let i = 0; i < bars; i++) {
        const angle = (i / bars) * Math.PI * 2 - Math.PI / 2;
        const specIndex = Math.floor((i / bars) * spectrum.length);
        const bin = spectrum[specIndex] || 0;
        const harmonic =
          Math.sin(phase * 2 + i * 0.45) * 0.5 + 0.5;

        const barHeight =
          currentState === "disconnected"
            ? 3 + harmonic * 3
            : currentState === "connecting"
              ? 6 + Math.sin(phase * 3 - i * 0.28) * 8 + 8
              : 5 + bin * 34 + smoothLevel * 14 + harmonic * 4;

        const innerR = 72 + smoothLevel * 6;
        const outerR = innerR + barHeight;

        const x1 = cx + Math.cos(angle) * innerR;
        const y1 = cy + Math.sin(angle) * innerR;
        const x2 = cx + Math.cos(angle) * outerR;
        const y2 = cy + Math.sin(angle) * outerR;

        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        const alpha =
          currentState === "disconnected"
            ? 0.16
            : Math.min(0.92, 0.28 + bin * 0.65 + smoothLevel * 0.35);
        ctx.strokeStyle = `rgba(${rgb}, ${alpha})`;
        ctx.lineWidth = 2.2;
        ctx.lineCap = "round";
        ctx.stroke();
      }

      ctx.restore();
      rafId = requestAnimationFrame(render);
    };

    rafId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(rafId);
  }, [levelsRef]);

  const isActive = state !== "disconnected";
  const copy =
    state === "listening" && isMuted
      ? { label: "Mic Muted", hint: "Unmute below so Jarvis can hear you" }
      : STATE_COPY[state];

  const glowClass =
    state === "speaking"
      ? "bg-rose-500/20"
      : state === "listening" && !isMuted
        ? "bg-sky-400/20"
        : state === "connecting"
          ? "bg-sky-300/15"
          : "bg-slate-400/8";

  const buttonRingClass =
    state === "speaking"
      ? "border-rose-400/50 bg-gradient-to-b from-rose-500/25 to-rose-950/60 shadow-[0_0_48px_-8px_rgba(251,113,133,0.45)]"
      : state === "listening"
        ? isMuted
          ? "border-slate-500/40 bg-gradient-to-b from-slate-700/35 to-slate-950/80"
          : "border-sky-400/55 bg-gradient-to-b from-sky-400/22 to-slate-950/85 shadow-[0_0_48px_-8px_rgba(56,189,248,0.42)]"
        : state === "connecting"
          ? "border-sky-300/45 bg-gradient-to-b from-sky-400/15 to-slate-950/85"
          : "border-white/15 bg-gradient-to-b from-white/8 to-slate-950/90 hover:border-white/30 hover:from-white/12";

  return (
    <div className="relative flex flex-col items-center justify-center select-none">
      {/* Ambient radial glow */}
      <div
        aria-hidden="true"
        className={`pointer-events-none absolute h-72 w-72 sm:h-88 sm:w-88 rounded-full blur-3xl transition-colors duration-500 ${glowClass} ${
          isActive ? "animate-core-breathe" : ""
        }`}
      />

      {/* Reactive orb & canvas container */}
      <div className="relative flex items-center justify-center w-[300px] h-[300px] sm:w-[340px] sm:h-[340px]">
        <canvas
          ref={canvasRef}
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 w-full h-full"
        />

        {/* Subtle orbital reticle rings */}
        <div
          aria-hidden="true"
          className={`pointer-events-none absolute w-[204px] h-[204px] rounded-full border border-dashed transition-colors duration-500 ${
            state === "speaking"
              ? "border-rose-400/25 animate-orbit-slow"
              : state === "listening" || state === "connecting"
                ? "border-sky-400/25 animate-orbit-slow"
                : "border-white/10"
          }`}
        />

        {state === "connecting" && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute w-[124px] h-[124px] rounded-full border-2 border-transparent border-t-sky-300/80 border-r-sky-400/30 animate-orbit-reverse"
          />
        )}

        {/* Central Power / Mic Trigger */}
        <button
          type="button"
          onClick={onToggleSession}
          aria-label={
            isActive ? "Disconnect Jarvis voice session" : "Connect Jarvis voice session"
          }
          className={`group relative z-10 flex h-28 w-28 sm:h-32 sm:w-32 items-center justify-center rounded-full border backdrop-blur-xl transition-all duration-200 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 focus-visible:ring-offset-4 focus-visible:ring-offset-[#06070b] cursor-pointer ${buttonRingClass}`}
        >
          <span className="sr-only">
            {isActive ? "Stop voice session" : "Start voice session"}
          </span>

          {state === "disconnected" ? (
            <Power className="h-9 w-9 sm:h-10 sm:w-10 text-slate-200 transition-transform duration-200 group-hover:scale-105 group-hover:text-white" />
          ) : state === "connecting" ? (
            <div className="flex items-center gap-1.5" aria-hidden="true">
              <span className="h-2 w-2 rounded-full bg-sky-300 animate-bounce [animation-delay:-0.2s]" />
              <span className="h-2 w-2 rounded-full bg-sky-300 animate-bounce [animation-delay:-0.1s]" />
              <span className="h-2 w-2 rounded-full bg-sky-300 animate-bounce" />
            </div>
          ) : state === "listening" && isMuted ? (
            <MicOff className="h-9 w-9 sm:h-10 sm:w-10 text-slate-300 transition-transform duration-200 group-hover:scale-105" />
          ) : (
            <Mic
              className={`h-9 w-9 sm:h-10 sm:w-10 transition-transform duration-200 group-hover:scale-105 ${
                state === "speaking" ? "text-rose-200" : "text-sky-200"
              }`}
            />
          )}
        </button>
      </div>

      {/* Clean unboxed state label & hint */}
      <div className="mt-2 flex flex-col items-center text-center px-6">
        <h1 className="font-display text-2xl sm:text-3xl font-semibold tracking-tight text-white">
          {copy.label}
        </h1>
        <p className="mt-1.5 text-sm text-slate-400 max-w-xs">
          {copy.hint}
        </p>
      </div>
    </div>
  );
};
