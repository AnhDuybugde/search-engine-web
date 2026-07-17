export type SessionEntity = {
  name: string;
  type?: string;
  aliases?: string[];
  salience?: number;
};

export type MemoryTurn = {
  role: "user" | "assistant";
  text: string;
};

export type SessionMemory = {
  entities: SessionEntity[];
  summary?: string | null;
  recentTurns: MemoryTurn[];
};

export type ExpandResult = {
  originalQuery: string;
  expandedQuery: string;
  usedContext: boolean;
  method: "raw" | "heuristic" | "llm";
  entitiesDelta: SessionEntity[];
  resolvedReferents?: string[];
};

export const CONTEXT_DEFAULTS = {
  recentTurnLimit: 4,
  maxEntities: 12,
  turnTextMaxChars: 300,
  expandTimeoutMs: 2500,
} as const;
