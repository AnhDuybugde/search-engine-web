export type Chunk = {
  chunkId: string;
  documentId: string;
  title: string;
  url?: string;
  text: string;
  chunkIndex: number;
};

export type ChunkWithEmbedding = Chunk & {
  embedding?: number[] | null;
  embeddingModel?: string | null;
};

export type RankedChunk = Chunk & {
  bm25Score: number;
  bm25Rank: number;
  denseScore?: number;
  denseRank?: number;
  finalScore?: number;
  finalRank: number;
  citationId: number;
  retrievalMode?: "bm25" | "adaptive_rrf" | "bm25_fallback";
  bm25Weight?: number;
};

export type Timing = {
  searchMs?: number;
  fetchMs?: number;
  chunkMs?: number;
  embeddingMs?: number;
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
  retrievalMode?: "bm25" | "adaptive_rrf" | "bm25_fallback";
  denseUsed?: boolean;
  denseSkippedReason?: string;
  embeddingProvider?: string;
  embeddingModel?: string;
  bm25Weight?: number;
  llmUsed?: boolean;
  llmSkippedReason?: string;
};

export type StreamEvent =
  | { type: "search_started"; query: string }
  | {
      type: "query_expanded";
      original: string;
      expanded: string;
      usedContext: boolean;
      method: string;
    }
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
      /** Present for session chat turns */
      messageIds?: { userId: string; assistantId: string };
      sessionId?: string;
      expandedQuery?: string;
    }
  | { type: "error"; message: string };
