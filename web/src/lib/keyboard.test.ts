import { describe, expect, it, vi } from "vitest";
import { handleSubmitOnEnter } from "./keyboard";
import type { KeyboardEvent } from "react";

function keyEvent(
  key: string,
  opts: { shiftKey?: boolean } = {},
): KeyboardEvent<HTMLTextAreaElement> {
  return {
    key,
    shiftKey: opts.shiftKey ?? false,
    preventDefault: vi.fn(),
  } as unknown as KeyboardEvent<HTMLTextAreaElement>;
}

describe("handleSubmitOnEnter", () => {
  it("submits on Enter without Shift", () => {
    const onSubmit = vi.fn();
    const e = keyEvent("Enter");
    handleSubmitOnEnter(e, onSubmit, { allowShiftNewline: true });
    expect(onSubmit).toHaveBeenCalledOnce();
    expect(e.preventDefault).toHaveBeenCalledOnce();
  });

  it("allows Shift+Enter as newline when enabled", () => {
    const onSubmit = vi.fn();
    const e = keyEvent("Enter", { shiftKey: true });
    handleSubmitOnEnter(e, onSubmit, { allowShiftNewline: true });
    expect(onSubmit).not.toHaveBeenCalled();
    expect(e.preventDefault).not.toHaveBeenCalled();
  });

  it("submits on Enter even with Shift when shift newline disabled", () => {
    const onSubmit = vi.fn();
    const e = keyEvent("Enter", { shiftKey: true });
    handleSubmitOnEnter(e, onSubmit, { allowShiftNewline: false });
    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it("ignores non-Enter keys", () => {
    const onSubmit = vi.fn();
    handleSubmitOnEnter(keyEvent("a"), onSubmit);
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
