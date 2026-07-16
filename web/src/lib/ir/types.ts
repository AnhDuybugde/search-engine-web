export type Chunk = {
  chunkId: string;
  documentId: string;
  title: string;
  url?: string;
  text: string;
  chunkIndex: number;
};

export type RankedChunk = Chunk & {
  bm25Score: number;
  bm25Rank: number;
  finalRank: number;
  citationId: number;
};

export type Timing = {
  searchMs?: number;
  fetchMs?: number;
  chunkMs?: number;
  retrieveMs?: number;
  generateMs?: number;
  totalMs?: number;
};

export type Metrics = {
  resultCount?: number;
  pageCount?: number;
  chunkCount?: number;
  contextCount?: number;
  sourcesUsed?: number;
  llmUsed?: boolean;
  llmSkippedReason?: string;
};

export type StreamEvent =
  | { type: "search_started"; query: string }
  | { type: "search_completed"; count: number; ms: number }
  | { type: "fetch_completed"; pages: number; ms: number }
  | { type: "chunk_completed"; chunks: number; ms: number }
  | { type: "retrieve_completed"; results: RankedChunk[]; ms: number }
  | { type: "generation_started" }
  | { type: "generation_token"; token: string }
  | {
      type: "run_completed";
      answer: string;
      timing: Timing;
      metrics: Metrics;
      results: RankedChunk[];
    }
  | { type: "error"; message: string };
