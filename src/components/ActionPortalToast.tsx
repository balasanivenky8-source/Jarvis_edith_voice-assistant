import React from "react";
import { Check, ExternalLink, Eye, Search, X } from "lucide-react";
import { ToolActionFeedback } from "../types/assistant";

interface ActionPortalToastProps {
  action: ToolActionFeedback | null;
  onDismiss: () => void;
}

export const ActionPortalToast: React.FC<ActionPortalToastProps> = ({
  action,
  onDismiss,
}) => {
  if (!action) return null;

  const Icon =
    action.kind === "search"
      ? Search
      : action.kind === "clipboard"
        ? Check
        : action.kind === "vision"
          ? Eye
          : ExternalLink;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed top-16 left-1/2 -translate-x-1/2 z-40 w-[calc(100%-2rem)] max-w-md"
    >
      <div className="flex items-center justify-between gap-3 rounded-2xl border border-white/12 bg-[#0f131c]/95 backdrop-blur-xl px-4 py-2.5 shadow-2xl">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-sky-400/12 text-sky-300">
            <Icon className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-white truncate">
              {action.title}
            </p>
            {action.subtitle && (
              <p className="text-xs text-slate-400 truncate">
                {action.subtitle}
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {action.url && (
            <a
              href={action.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex h-11 items-center px-3.5 rounded-xl bg-white/10 hover:bg-white/16 text-xs font-medium text-white transition-colors whitespace-nowrap"
            >
              Open
            </a>
          )}
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss action notification"
            className="flex h-11 w-11 items-center justify-center rounded-xl text-slate-400 hover:text-white hover:bg-white/8 transition-colors cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
};
