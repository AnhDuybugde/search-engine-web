"use client";

import type { PointerEvent as ReactPointerEvent } from "react";
import { cn } from "@/lib/utils";

/**
 * Vertical drag handle between resizable panels.
 * Place on the inner edge of a panel (right edge of left panel, left edge of right panel).
 */
export function ResizeHandle({
  side,
  onResizeStart,
  label,
  className,
}: {
  side: "left" | "right";
  onResizeStart: (e: ReactPointerEvent) => void;
  label: string;
  className?: string;
}) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      tabIndex={0}
      onPointerDown={onResizeStart}
      onKeyDown={(e) => {
        // Keyboard nudge is handled by parent if needed; Enter not used.
        if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
          e.preventDefault();
        }
      }}
      className={cn(
        "panel-resize-handle group",
        side === "left" && "panel-resize-handle--left",
        side === "right" && "panel-resize-handle--right",
        className,
      )}
    >
      <span className="panel-resize-grip" aria-hidden />
    </div>
  );
}
