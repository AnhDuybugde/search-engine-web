/**
 * In-memory store for local dev when DATABASE_URL is missing.
 * Not durable across cold starts on Vercel — production should use Neon.
 */

import type { RankedChunk, Metrics, Timing } from "@/lib/ir/types";

export type MemNotebook = {
  id: string;
  title: string;
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

const g = globalThis as unknown as {
  __memNotebooks?: Map<string, MemNotebook>;
  __memSources?: Map<string, MemSource>;
  __memChunks?: Map<string, MemChunk>;
  __memRuns?: Map<string, MemSearchRun>;
};

export const memNotebooks = g.__memNotebooks ?? new Map<string, MemNotebook>();
export const memSources = g.__memSources ?? new Map<string, MemSource>();
export const memChunks = g.__memChunks ?? new Map<string, MemChunk>();
export const memRuns = g.__memRuns ?? new Map<string, MemSearchRun>();

g.__memNotebooks = memNotebooks;
g.__memSources = memSources;
g.__memChunks = memChunks;
g.__memRuns = memRuns;
