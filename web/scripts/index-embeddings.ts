/**
 * Pre-embed notebook sources into chunks.embedding_json
 *
 *   npx tsx scripts/index-embeddings.ts --all-raw-demos
 *   npx tsx scripts/index-embeddings.ts --title "SCIFACT Demo (raw)"
 *   npx tsx scripts/index-embeddings.ts --notebook-id <uuid>
 */
import { config } from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";
import { indexNotebookEmbeddings } from "../src/lib/ir/index-embeddings";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
config({ path: path.join(root, ".env.local") });
config({ path: path.join(root, ".env") });

function parseArgs(argv: string[]) {
  const out = {
    title: null as string | null,
    notebookId: null as string | null,
    allRawDemos: false,
    maxUnits: 800,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--all-raw-demos") out.allRawDemos = true;
    else if (a === "--title") out.title = argv[++i];
    else if (a === "--notebook-id") out.notebookId = argv[++i];
    else if (a === "--max-units") out.maxUnits = Number(argv[++i]) || 800;
  }
  return out;
}

async function resolveIds(args: ReturnType<typeof parseArgs>) {
  if (args.notebookId) return [args.notebookId];

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL + SUPABASE_SECRET_KEY required");
  const sb = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const titles = args.allRawDemos || !args.title
    ? ["SCIFACT (raw)", "SCIDOCS (raw)", "SCIFACT Demo (raw)", "SCIDOCS Demo (raw)"]
    : [args.title];

  const ids: string[] = [];
  for (const title of titles) {
    const { data, error } = await sb
      .from("notebooks")
      .select("id,title")
      .eq("title", title);
    if (error) throw new Error(error.message);
    if (!data?.length) console.warn(`No notebook: ${title}`);
    for (const row of data || []) ids.push(row.id as string);
  }
  return ids;
}

async function main() {
  const args = parseArgs(process.argv);
  const ids = await resolveIds(args);
  if (!ids.length) {
    console.error("No notebooks found to index");
    process.exit(1);
  }

  console.log("Pre-embedding into chunks (query path will only embed the query)\n");
  const results = [];
  for (const id of ids) {
    console.log(`=== ${id} ===`);
    const r = await indexNotebookEmbeddings(id, { maxUnits: args.maxUnits });
    console.log(JSON.stringify(r, null, 2));
    results.push(r);
  }
  console.log("\n=== SUMMARY ===");
  console.log(JSON.stringify(results, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
