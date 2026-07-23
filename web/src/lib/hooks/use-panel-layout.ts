"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";

export type PanelSide = "left" | "right";

export type PanelLayoutOptions = {
  /** localStorage key prefix, e.g. "dataset-chat" */
  storageKey: string;
  defaultLeftWidth?: number;
  defaultRightWidth?: number;
  minLeft?: number;
  maxLeft?: number;
  minRight?: number;
  maxRight?: number;
  defaultLeftOpen?: boolean;
  defaultRightOpen?: boolean;
};

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function readStoredNumber(key: string, fallback: number): number {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (raw == null) return fallback;
    const n = Number(raw);
    return Number.isFinite(n) ? n : fallback;
  } catch {
    return fallback;
  }
}

function readStoredBool(key: string, fallback: boolean): boolean {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (raw == null) return fallback;
    return raw === "1" || raw === "true";
  } catch {
    return fallback;
  }
}

/**
 * Collapsible + horizontally resizable left/right panels with localStorage persistence.
 */
export function usePanelLayout(opts: PanelLayoutOptions) {
  const {
    storageKey,
    defaultLeftWidth = 300,
    defaultRightWidth = 360,
    minLeft = 280,
    maxLeft = 360,
    minRight = 320,
    maxRight = 440,
    defaultLeftOpen = true,
    defaultRightOpen = true,
  } = opts;

  const leftWKey = `${storageKey}:leftWidth`;
  const rightWKey = `${storageKey}:rightWidth`;
  const leftOpenKey = `${storageKey}:leftOpen`;
  const rightOpenKey = `${storageKey}:rightOpen`;

  const [leftWidth, setLeftWidth] = useState(defaultLeftWidth);
  const [rightWidth, setRightWidth] = useState(defaultRightWidth);
  const [leftOpen, setLeftOpen] = useState(defaultLeftOpen);
  const [rightOpen, setRightOpen] = useState(defaultRightOpen);
  const [hydrated, setHydrated] = useState(false);

  /* eslint-disable react-hooks/set-state-in-effect -- hydrate persisted layout after browser mount. */
  useEffect(() => {
    setLeftWidth(
      clamp(readStoredNumber(leftWKey, defaultLeftWidth), minLeft, maxLeft),
    );
    setRightWidth(
      clamp(readStoredNumber(rightWKey, defaultRightWidth), minRight, maxRight),
    );
    setLeftOpen(readStoredBool(leftOpenKey, defaultLeftOpen));
    setRightOpen(readStoredBool(rightOpenKey, defaultRightOpen));
    setHydrated(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- hydrate once per storageKey
  }, [storageKey]);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    if (!hydrated || typeof window === "undefined") return;
    try {
      window.localStorage.setItem(leftWKey, String(leftWidth));
      window.localStorage.setItem(rightWKey, String(rightWidth));
      window.localStorage.setItem(leftOpenKey, leftOpen ? "1" : "0");
      window.localStorage.setItem(rightOpenKey, rightOpen ? "1" : "0");
    } catch {
      /* private mode */
    }
  }, [
    hydrated,
    leftWidth,
    rightWidth,
    leftOpen,
    rightOpen,
    leftWKey,
    rightWKey,
    leftOpenKey,
    rightOpenKey,
  ]);

  const dragRef = useRef<{
    side: PanelSide;
    startX: number;
    startWidth: number;
  } | null>(null);

  const onResizeStart = useCallback(
    (side: PanelSide, clientX: number) => {
      dragRef.current = {
        side,
        startX: clientX,
        startWidth: side === "left" ? leftWidth : rightWidth,
      };
    },
    [leftWidth, rightWidth],
  );

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      e.preventDefault();
      if (drag.side === "left") {
        const delta = e.clientX - drag.startX;
        setLeftWidth(clamp(drag.startWidth + delta, minLeft, maxLeft));
      } else {
        // Right handle: drag left to grow, right to shrink
        const delta = drag.startX - e.clientX;
        setRightWidth(clamp(drag.startWidth + delta, minRight, maxRight));
      }
    };
    const onUp = () => {
      dragRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [minLeft, maxLeft, minRight, maxRight]);

  const beginResize = useCallback(
    (side: PanelSide, e: ReactPointerEvent | PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      onResizeStart(side, e.clientX);
    },
    [onResizeStart],
  );

  const toggleLeft = useCallback(() => setLeftOpen((v) => !v), []);
  const toggleRight = useCallback(() => setRightOpen((v) => !v), []);
  const openLeft = useCallback(() => setLeftOpen(true), []);
  const closeLeft = useCallback(() => setLeftOpen(false), []);
  const openRight = useCallback(() => setRightOpen(true), []);
  const closeRight = useCallback(() => setRightOpen(false), []);

  const setLeftWidthClamped = useCallback(
    (w: number) => setLeftWidth(clamp(w, minLeft, maxLeft)),
    [minLeft, maxLeft],
  );
  const setRightWidthClamped = useCallback(
    (w: number) => setRightWidth(clamp(w, minRight, maxRight)),
    [minRight, maxRight],
  );

  return {
    leftWidth,
    rightWidth,
    leftOpen,
    rightOpen,
    setLeftOpen,
    setRightOpen,
    setLeftWidth: setLeftWidthClamped,
    setRightWidth: setRightWidthClamped,
    toggleLeft,
    toggleRight,
    openLeft,
    closeLeft,
    openRight,
    closeRight,
    beginResize,
    minLeft,
    maxLeft,
    minRight,
    maxRight,
    hydrated,
  };
}

/** Pure clamp helper exported for unit tests */
export function clampPanelWidth(n: number, min: number, max: number) {
  return clamp(n, min, max);
}

/**
 * Compute next width while dragging (shipped resize math).
 * Left: pointer moves right → width grows.
 * Right: pointer moves left → width grows.
 */
export function nextPanelWidth(
  side: PanelSide,
  startWidth: number,
  startX: number,
  clientX: number,
  min: number,
  max: number,
): number {
  if (side === "left") {
    return clamp(startWidth + (clientX - startX), min, max);
  }
  return clamp(startWidth + (startX - clientX), min, max);
}
