/**
 * In-memory store for local dev when DATABASE_URL is missing.
 * Not durable across cold starts on Vercel — production should use Neon.
 */

import type { SessionEntity } from "@/lib/context/types";
import type { RankedChunk, Metrics, Timing } from "@/lib/ir/types";

export type MemNotebook = {
  id: string;
  title: string;
  locked: boolean;
  indexStatus: string;
  indexMessage: string | null;
  unitCount: number;
  embeddedCount: number;
  indexedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type MemSource = {
  id: string;
  notebookId: string;
  title: string;
  mime: string | null;
  text: string;
  createdAt: string;
};

export type MemChunk = {
  id: string;
  sourceId: string;
  notebookId: string;
  chunkIndex: number;
  text: string;
  embedding: number[] | null;
  embeddingModel: string | null;
};

export type MemSearchRun = {
  id: string;
  query: string;
  status: string;
  results: RankedChunk[] | null;
  answer: string | null;
  timing: Timing | null;
  metrics: Metrics | null;
  createdAt: string;
  completedAt: string | null;
};

export type MemSearchSession = {
  id: string;
  userId: string | null;
  title: string;
  summary: string | null;
  entities: SessionEntity[];
  createdAt: string;
  updatedAt: string;
};

export type MemNotebookMessage = {
  id: string;
  notebookId: string;
  userId: string;
  role: "user" | "assistant";
  content: string;
  results: unknown;
  timing: unknown;
  metrics: unknown;
  documents: unknown;
  status: string;
  createdAt: string;
};

export type MemSearchMessage = {
  id: string;
  sessionId: string;
  role: "user" | "assistant";
  content: string;
  expandedQuery: string | null;
  results: RankedChunk[] | null;
  timing: Timing | null;
  metrics: Metrics | null;
  status: string;
  createdAt: string;
};

export type MemUser = {
  id: string;
  email: string;
  passwordHash: string;
  displayName: string;
  createdAt: string;
  updatedAt: string;
};

const g = globalThis as unknown as {
  __memNotebooks?: Map<string, MemNotebook>;
  __memSources?: Map<string, MemSource>;
  __memChunks?: Map<string, MemChunk>;
  __memRuns?: Map<string, MemSearchRun>;
  __memSessions?: Map<string, MemSearchSession>;
  __memMessages?: Map<string, MemSearchMessage>;
  __memNotebookMessages?: Map<string, MemNotebookMessage>;
  __memUsers?: Map<string, MemUser>;
};

export const memNotebooks = g.__memNotebooks ?? new Map<string, MemNotebook>();
export const memSources = g.__memSources ?? new Map<string, MemSource>();
export const memChunks = g.__memChunks ?? new Map<string, MemChunk>();
export const memRuns = g.__memRuns ?? new Map<string, MemSearchRun>();
export const memSessions = g.__memSessions ?? new Map<string, MemSearchSession>();
export const memMessages = g.__memMessages ?? new Map<string, MemSearchMessage>();
export const memNotebookMessages =
  g.__memNotebookMessages ?? new Map<string, MemNotebookMessage>();
export const memUsers = g.__memUsers ?? new Map<string, MemUser>();

g.__memNotebooks = memNotebooks;
g.__memSources = memSources;
g.__memChunks = memChunks;
g.__memRuns = memRuns;
g.__memSessions = memSessions;
g.__memMessages = memMessages;
g.__memNotebookMessages = memNotebookMessages;
g.__memUsers = memUsers;
