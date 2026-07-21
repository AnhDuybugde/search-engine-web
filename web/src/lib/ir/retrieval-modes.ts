/**
 * Registry of retrieval methods exposed in the UI and APIs.
 * Add a new entry here when shipping another ranker — wire it in retrieveEvidence.
 */
export const RETRIEVAL_MODES = [
  {
    id: "paper",
    label: "Paper",
    shortLabel: "Paper",
    description:
      "Hybrid SciNCL + BM25 then cross-encoder rerank (query ↔ document)",
  },
  {
    id: "bm25",
    label: "BM25",
    shortLabel: "BM25",
    description: "Lexical bag-of-words only",
  },
  {
    id: "sgaf",
    label: "SGAF B5+P3",
    shortLabel: "SGAF",
    description: "Specialist-Generalist Adaptive Fusion with mode-switch + smoothing",
  },
] as const;

export type RetrievalModeId = (typeof RETRIEVAL_MODES)[number]["id"];

/**
 * Modes accepted on wire / env (includes legacy Adaptive ids).
 * Always normalize with parseRetrievalMode before branching on product modes.
 */
export type RetrievalModeInput =
  | RetrievalModeId
  | "adaptive_rrf"
  | "rrf"
  | "adaptive";

export const DEFAULT_RETRIEVAL_MODE: RetrievalModeId = "paper";

const MODE_IDS = new Set<string>(RETRIEVAL_MODES.map((m) => m.id));

/** Legacy ids still accepted from env / localStorage / old clients. */
const MODE_ALIASES: Record<string, RetrievalModeId> = {
  adaptive_rrf: "paper",
  rrf: "paper",
  adaptive: "paper",
};

export function isRetrievalModeId(value: unknown): value is RetrievalModeId {
  return typeof value === "string" && MODE_IDS.has(value);
}

export function parseRetrievalMode(
  value: unknown,
  fallback: RetrievalModeId = DEFAULT_RETRIEVAL_MODE,
): RetrievalModeId {
  if (typeof value !== "string") return fallback;
  if (isRetrievalModeId(value)) return value;
  const alias = MODE_ALIASES[value];
  return alias ?? fallback;
}

export function retrievalModeLabel(mode?: string | null): string {
  if (mode === "adaptive_rrf" || mode === "rrf") return "Paper (legacy Adaptive)";
  const found = RETRIEVAL_MODES.find((m) => m.id === mode);
  if (found) return found.label;
  if (mode === "bm25_fallback") return "BM25 fallback";
  return mode || "—";
}

/** localStorage key for the last method chosen in the composer. */
export const RETRIEVAL_MODE_STORAGE_KEY = "sew.retrievalMode";

export function readStoredRetrievalMode(): RetrievalModeId {
  if (typeof window === "undefined") return DEFAULT_RETRIEVAL_MODE;
  try {
    return parseRetrievalMode(
      window.localStorage.getItem(RETRIEVAL_MODE_STORAGE_KEY),
    );
  } catch {
    return DEFAULT_RETRIEVAL_MODE;
  }
}

export function storeRetrievalMode(mode: RetrievalModeId): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(RETRIEVAL_MODE_STORAGE_KEY, mode);
  } catch {
    /* ignore quota / private mode */
  }
}
