import type { KeyboardEvent } from "react";

/**
 * Enter submits; Shift+Enter inserts a newline (for textareas).
 * Single-line inputs: Enter always submits.
 */
export function handleSubmitOnEnter(
  e: KeyboardEvent<HTMLTextAreaElement | HTMLInputElement>,
  onSubmit: () => void,
  opts?: { allowShiftNewline?: boolean },
) {
  if (e.key !== "Enter") return;
  const allowShiftNewline = opts?.allowShiftNewline ?? true;
  if (allowShiftNewline && e.shiftKey) return; // newline
  e.preventDefault();
  onSubmit();
}
