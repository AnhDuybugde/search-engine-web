/**
 * Compare retrieval latency: cold (embed corpus at query) vs pre-indexed vectors.
 *
 *   npx tsx scripts/bench-retrieval.ts --title "SCIFACT Demo (raw)" --queries 3
 */
import { config } from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";
import { loadChunks } from "../src/lib/db/notebooks-repo";
import { retrieveEvidence } from "../src/lib/ir/adaptive-rrf";
import type { ChunkWithEmbedding } from "../src/lib/ir/types";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
config({ path: path.join(root, ".env.local") });

function parseArgs(argv: string[]) {
  const out = {
    title: "SCIFACT (raw)",
    queries: 3,
    topK: 20,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--title") out.title = argv[++i];
    else if (a === "--queries") out.queries = Number(argv[++i]) || 3;
    else if (a === "--top-k") out.topK = Number(argv[++i]) || 20;
  }
  return out;
}

const SAMPLE_QUERIES = [
  "What is the role of vitamin D in calcium absorption?",
  "How does BM25 ranking work in information retrieval?",
  "What treatments are used for melanoma and PD-1 blockade?",
  "stem cell nanotechnology applications",
  "educational games in online learning",
];

function stripEmbeddings(units: ChunkWithEmbedding[]): ChunkWithEmbedding[] {
  return units.map((u) => ({
    ...u,
    embedding: null,
    embeddingModel: null,
  }));
}

async function resolveNotebookId(title: string) {
  const sb = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { data, error } = await sb
    .from("notebooks")
    .select("id,title")
    .eq("title", title)
    .maybeSingle();
  if (error || !data) throw new Error(`Notebook not found: ${title}`);
  return data.id as string;
}

async function runOnce(
  label: string,
  query: string,
  units: ChunkWithEmbedding[],
  topK: number,
) {
  const t0 = performance.now();
  const result = await retrieveEvidence(query, units, topK, "adaptive_rrf");
  const wall = Math.round(performance.now() - t0);
  return {
    label,
    query: query.slice(0, 60),
    wallMs: wall,
    embeddingMs: result.diagnostics.embeddingMs ?? null,
    bm25Ms: result.diagnostics.bm25Ms ?? null,
    denseUsed: result.diagnostics.denseUsed,
    denseSkippedReason: result.diagnostics.denseSkippedReason ?? null,
    hits: result.results.length,
    preEmbeddedUnits: units.filter((u) => u.embedding && u.embedding.length > 0)
      .length,
    totalUnits: units.length,
  };
}

async function main() {
  const args = parseArgs(process.argv);
  const notebookId = await resolveNotebookId(args.title);
  console.log(`Notebook: ${args.title} (${notebookId})`);

  const units = await loadChunks(notebookId);
  const withEmb = units.filter((u) => u.embedding && u.embedding.length > 0).length;
  console.log(
    `Loaded units=${units.length}, withEmbedding=${withEmb}, without=${units.length - withEmb}`,
  );

  if (withEmb === 0) {
    console.warn(
      "\n⚠ No pre-stored embeddings. Run:\n  npx tsx scripts/index-embeddings.ts --title \"" +
        args.title +
        "\"\n",
    );
  }

  const coldUnits = stripEmbeddings(units);
  const queries = SAMPLE_QUERIES.slice(0, args.queries);
  const rows: Awaited<ReturnType<typeof runOnce>>[] = [];

  // Warm-up HF once (not counted in averages)
  try {
    await retrieveEvidence(queries[0], coldUnits.slice(0, 5), 5, "adaptive_rrf");
  } catch {
    /* ignore */
  }

  for (const q of queries) {
    // COLD: no vectors on units → re-embed corpus at query time
    rows.push(await runOnce("COLD_reembed_corpus", q, coldUnits, args.topK));
    // HOT: pre-indexed vectors → embed query only
    rows.push(await runOnce("HOT_preindexed", q, units, args.topK));
  }

  console.log("\n=== PER-QUERY ===");
  for (const r of rows) {
    console.log(
      `${r.label.padEnd(22)} emb=${String(r.embeddingMs).padStart(5)}ms  wall=${String(r.wallMs).padStart(5)}ms  hits=${r.hits}  preEmb=${r.preEmbeddedUnits}/${r.totalUnits}  | ${r.query}`,
    );
  }

  const cold = rows.filter((r) => r.label.startsWith("COLD"));
  const hot = rows.filter((r) => r.label.startsWith("HOT"));
  const avg = (xs: number[]) =>
    xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : 0;

  const coldWall = avg(cold.map((r) => r.wallMs));
  const hotWall = avg(hot.map((r) => r.wallMs));
  const coldEmb = avg(cold.map((r) => r.embeddingMs ?? 0));
  const hotEmb = avg(hot.map((r) => r.embeddingMs ?? 0));
  const speedupWall = hotWall > 0 ? (coldWall / hotWall).toFixed(2) : "n/a";
  const speedupEmb = hotEmb > 0 ? (coldEmb / hotEmb).toFixed(2) : "n/a";
  const savedMs = coldWall - hotWall;
  const savedPct =
    coldWall > 0 ? (((coldWall - hotWall) / coldWall) * 100).toFixed(1) : "n/a";

  const summary = {
    notebook: args.title,
    queries: queries.length,
    units: units.length,
    preEmbedded: withEmb,
    avgColdWallMs: coldWall,
    avgHotWallMs: hotWall,
    avgColdEmbeddingMs: coldEmb,
    avgHotEmbeddingMs: hotEmb,
    wallSpeedupX: Number(speedupWall),
    embedSpeedupX: Number(speedupEmb),
    wallSavedMs: savedMs,
    wallSavedPct: savedPct,
  };

  console.log("\n=== SUMMARY ===");
  console.log(JSON.stringify(summary, null, 2));
  console.log(
    `\n→ Retrieval wall-clock improved ~${speedupWall}× (saved ~${savedMs}ms / ${savedPct}%)`,
  );
  console.log(
    `→ Embedding stage alone improved ~${speedupEmb}× (${coldEmb}ms → ${hotEmb}ms)`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
