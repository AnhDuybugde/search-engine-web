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

/** Document-level hit for Top-10 title list + drawer */
export type RankedDocument = {
  documentId: string;
  title: string;
  finalScore: number;
  finalRank: number;
  /**
   * Display confidence proxy in [0,1] from this query's ranked scores
   * (absolute BM25/dense/final + relative margin). Not a calibrated ML probability.
   */
  confidence: number;
  bm25Best?: number;
  denseBest?: number;
  chunkHits: number;
  topChunkIds: string[];
  snippet?: string;
};

export type Timing = {
  searchMs?: number;
  fetchMs?: number;
  chunkMs?: number;
  embeddingMs?: number;
  retrieveMs?: number;
  generateMs?: number;
  totalMs?: number;
  /** Query normalize / expand */
  queryProcessMs?: number;
  bm25Ms?: number;
  denseMs?: number;
  fusionMs?: number;
  packMs?: number;
  /** bm25 + dense + fusion wall (excludes pack when split) */
  rankMs?: number;
  ttftMs?: number;
  extractMs?: number;
  /** Dense embed stage during notebook index */
  embedMs?: number;
  indexEmbedMs?: number;
  storeMs?: number;
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
  documentsRanked?: number;
  topKDocuments?: number;
  confidenceMean?: number;
  confidenceMax?: number;
  /** (top1 - top2) / top1 on finalScore (retrieval signal) */
  scoreMargin?: number;
  eval?: {
    dataset?: "scifact" | "scidocs" | string;
    recallAt10?: number;
    mrr?: number;
    ndcgAt10?: number;
    map?: number;
  };
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
  /** Notebook-native query path */
  | { type: "query_started"; query: string }
  | { type: "query_processed"; query: string; ms: number }
  | {
      type: "retrieve_started";
      mode: string;
      corpusChunks: number;
    }
  | { type: "bm25_completed"; ms: number; candidates: number }
  | {
      type: "embedding_completed";
      ms: number;
      denseUsed: boolean;
      reason?: string;
      provider?: string;
      model?: string;
    }
  | {
      type: "fusion_completed";
      ms: number;
      bm25Weight?: number;
      method: string;
    }
  | { type: "pack_completed"; ms: number; packed: number }
  | {
      type: "rank_completed";
      documents: RankedDocument[];
      chunks: RankedChunk[];
      ms: number;
    }
  | { type: "retrieve_completed"; results: RankedChunk[]; ms: number }
  | { type: "generation_started" }
  | { type: "generation_token"; token: string }
  | {
      type: "run_completed";
      answer: string;
      timing: Timing;
      metrics: Metrics;
      /** Packed LLM evidence (contextTopK) — not the full ranking list */
      results: RankedChunk[];
      /**
       * Full retrieval ranking hits for document drawer score breakdown.
       * Must not be collapsed to packed context only.
       */
      rankedChunks?: RankedChunk[];
      documents?: RankedDocument[];
      /** Present for session chat turns */
      messageIds?: { userId: string; assistantId: string };
      sessionId?: string;
      expandedQuery?: string;
    }
  | { type: "error"; message: string };

/**
 * Upload persistence progress (SSE).
 * Raw-only path: receive → extract → store (no chunk/embed index steps).
 */
export type UploadStreamEvent =
  | { type: "upload_started"; filename: string; bytes: number }
  | { type: "extract_completed"; chars: number; ms: number }
  | { type: "store_completed"; sourceId: string; ms: number }
  | {
      type: "index_started";
      unitCount: number;
      message: string;
    }
  | {
      type: "index_progress";
      done: number;
      total: number;
      message: string;
    }
  | {
      type: "index_completed";
      unitCount: number;
      embeddedCount: number;
      model: string;
      provider: string;
      embedMs: number;
      totalMs: number;
      storage: "supabase-postgres";
      message: string;
    }
  | {
      type: "index_failed";
      message: string;
    }
  | {
      type: "index_skipped";
      message: string;
      reason: string;
    }
  | {
      type: "upload_completed";
      source: {
        id: string;
        title: string;
        chunkCount: number;
        charCount: number;
        mode?: "raw-sources-only" | "indexed";
      };
      timing: Timing;
      metrics: {
        chunkCount: number;
        charCount: number;
        embeddedCount: number;
        mode?: "raw-sources-only" | "indexed" | "index-failed" | "index-skipped";
        indexStatus?: string;
        storage?: string;
      };
    }
  | { type: "error"; message: string };
