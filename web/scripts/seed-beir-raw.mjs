/**
 * Seed BEIR SciFact / SciDocs as RAW documents only.
 *
 * RULE (strict):
 * - Store full document text in `sources` only
 * - NO chunking at seed time
 * - NO embedding at seed time
 * - NO other IR preprocessing
 *
 * Usage:
 *   node scripts/seed-beir-raw.mjs --dataset scifact --max-docs 400
 *   node scripts/seed-beir-raw.mjs --dataset scidocs --max-docs 250
 *   node scripts/seed-beir-raw.mjs --all
 *   node scripts/seed-beir-raw.mjs --all --replace
 */
import { config } from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";
import { createClient } from "@supabase/supabase-js";
import postgres from "postgres";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
config({ path: path.join(root, ".env.local") });
config({ path: path.join(root, ".env") });

const DATA_ROOT = path.join(root, "data", "datasets");

function parseArgs(argv) {
  const out = { dataset: null, maxDocs: 400, all: false, replace: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--all") out.all = true;
    else if (a === "--replace") out.replace = true;
    else if (a === "--dataset") out.dataset = argv[++i];
    else if (a === "--max-docs") out.maxDocs = Number(argv[++i]) || 400;
  }
  return out;
}

function readJsonl(filePath) {
  const lines = fs.readFileSync(filePath, "utf8").split("\n");
  const rows = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      rows.push(JSON.parse(line));
    } catch {
      /* skip */
    }
  }
  return rows;
}

function pickDocIds(datasetDir, maxDocs) {
  const qrelsDir = path.join(datasetDir, "qrels");
  const ids = new Set();
  if (!fs.existsSync(qrelsDir)) return ids;
  for (const f of fs.readdirSync(qrelsDir)) {
    if (!f.endsWith(".tsv")) continue;
    const text = fs.readFileSync(path.join(qrelsDir, f), "utf8");
    for (const line of text.split("\n")) {
      if (!line.trim() || line.startsWith("query")) continue;
      const parts = line.trim().split(/[\t\s]+/);
      let docId = null;
      if (parts.length >= 4 && parts[1] === "0") docId = parts[2];
      else if (parts.length >= 3) docId = parts[1];
      else if (parts.length === 2) docId = parts[1];
      if (docId && docId !== "corpus-id") ids.add(String(docId));
      if (ids.size >= maxDocs * 4) break;
    }
  }
  return ids;
}

function docToText(doc) {
  const title = (doc.title || "").trim();
  const body = (doc.text || doc.contents || "").trim();
  if (title && body) return `${title}\n\n${body}`;
  return body || title;
}

async function makeStores() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  const databaseUrl = process.env.DATABASE_URL;

  let sb = null;
  if (supabaseUrl && secret) {
    sb = createClient(supabaseUrl, secret, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  let sql = null;
  if (databaseUrl && !/db\.[^.]+\.supabase\.co/.test(databaseUrl)) {
    const local =
      /@(localhost|127\.0\.0\.1)/i.test(databaseUrl) ||
      process.env.DB_SSL === "disable";
    sql = postgres(databaseUrl, {
      prepare: false,
      max: 1,
      ssl: local ? false : "require",
    });
  }

  return { sb, sql };
}

async function deleteNotebookByTitlePrefix(sb, sql, title) {
  if (sb) {
    const { data } = await sb
      .from("notebooks")
      .select("id")
      .eq("title", title);
    for (const row of data || []) {
      const id = row.id;
      await sb.from("chunks").delete().eq("notebook_id", id);
      await sb.from("sources").delete().eq("notebook_id", id);
      await sb.from("notebooks").delete().eq("id", id);
      console.log(`removed previous notebook ${id} (${title})`);
    }
  }
  if (sql) {
    const rows = await sql`select id from notebooks where title = ${title}`;
    for (const row of rows) {
      await sql`delete from chunks where notebook_id = ${row.id}`;
      await sql`delete from sources where notebook_id = ${row.id}`;
      await sql`delete from notebooks where id = ${row.id}`;
      console.log(`removed previous SQL notebook ${row.id}`);
    }
  }
}

/**
 * RAW seed only: notebook + sources rows.
 * No chunks. No embeddings. No IR preprocessing.
 */
async function seedDataset({ name, maxDocs, replace, sb, sql }) {
  const dir = path.join(DATA_ROOT, name);
  const corpusPath = path.join(dir, "corpus.jsonl");
  if (!fs.existsSync(corpusPath)) {
    throw new Error(`Missing ${corpusPath}`);
  }

  const title = `${name.toUpperCase()} Demo (raw)`;
  console.log(`\n=== RAW seed ${name} (sources only, no chunk/embed) maxDocs=${maxDocs} ===`);

  if (replace) {
    await deleteNotebookByTitlePrefix(sb, sql, title);
  }

  const preferred = pickDocIds(dir, maxDocs);
  const all = readJsonl(corpusPath);
  console.log(`corpus: ${all.length}, qrels ids: ${preferred.size}`);

  let selected = [];
  if (preferred.size) {
    const byId = new Map(all.map((d) => [String(d._id), d]));
    for (const id of preferred) {
      const d = byId.get(id);
      if (d) selected.push(d);
      if (selected.length >= maxDocs) break;
    }
  }
  if (selected.length < maxDocs) {
    for (const d of all) {
      if (selected.some((s) => String(s._id) === String(d._id))) continue;
      selected.push(d);
      if (selected.length >= maxDocs) break;
    }
  }

  const MAX_CHARS = 1_500_000;
  let totalChars = 0;
  const docs = [];
  for (const d of selected) {
    const text = docToText(d).replace(/\u0000/g, "").trim();
    if (!text || text.length < 40) continue;
    if (totalChars + text.length > MAX_CHARS) break;
    docs.push({
      title: (d.title || String(d._id)).slice(0, 240),
      text: text.slice(0, 50_000),
    });
    totalChars += Math.min(text.length, 50_000);
  }
  console.log(`raw docs to store: ${docs.length}, chars=${totalChars}`);

  const notebookId = randomUUID();
  const now = new Date().toISOString();

  if (sb) {
    const { error: nErr } = await sb.from("notebooks").insert({
      id: notebookId,
      title,
      created_at: now,
      updated_at: now,
    });
    if (nErr) throw new Error(`notebook: ${nErr.message}`);

    const rows = docs.map((doc) => ({
      id: randomUUID(),
      notebook_id: notebookId,
      title: doc.title,
      mime: "text/plain",
      text: doc.text,
      created_at: now,
    }));

    const BS = 40;
    for (let i = 0; i < rows.length; i += BS) {
      const slice = rows.slice(i, i + BS);
      const { error } = await sb.from("sources").insert(slice);
      if (error) throw new Error(`sources ${i}: ${error.message}`);
      process.stdout.write(
        `sources ${Math.min(i + BS, rows.length)}/${rows.length}\r`,
      );
    }
    console.log(`\nRAW sources only: ${rows.length} (0 chunks, 0 embeddings)`);
    console.log(`notebook: ${notebookId} — ${title}`);
    return {
      notebookId,
      title,
      docs: rows.length,
      chunks: 0,
      embeddings: 0,
      backend: "supabase-rest",
      mode: "raw-sources-only",
    };
  }

  if (sql) {
    await sql`
      insert into notebooks (id, title, created_at, updated_at)
      values (${notebookId}, ${title}, ${now}, ${now})
    `;
    for (const doc of docs) {
      await sql`
        insert into sources (id, notebook_id, title, mime, text, created_at)
        values (${randomUUID()}, ${notebookId}, ${doc.title}, ${"text/plain"}, ${doc.text}, ${now})
      `;
    }
    console.log(`SQL RAW sources only: ${docs.length}`);
    return {
      notebookId,
      title,
      docs: docs.length,
      chunks: 0,
      embeddings: 0,
      backend: "postgres",
      mode: "raw-sources-only",
    };
  }

  throw new Error("No database backend");
}

async function main() {
  const args = parseArgs(process.argv);
  const datasets = args.all
    ? ["scifact", "scidocs"]
    : args.dataset
      ? [args.dataset]
      : ["scifact", "scidocs"];

  const { sb, sql } = await makeStores();
  if (!sb && !sql) {
    console.error("Need SUPABASE_* or local DATABASE_URL");
    process.exit(1);
  }

  console.log("Mode: RAW sources only | chunking: NO | embedding: NO");
  console.log("Backend:", sb ? "supabase-rest" : "postgres");

  const results = [];
  for (const name of datasets) {
    try {
      results.push(
        await seedDataset({
          name,
          maxDocs: name === "scidocs" ? Math.min(args.maxDocs, 250) : args.maxDocs,
          replace: args.replace,
          sb,
          sql,
        }),
      );
    } catch (err) {
      console.error(`FAIL ${name}:`, err.message);
      results.push({ name, error: err.message });
    }
  }

  if (sql) await sql.end({ timeout: 2 });
  console.log("\n=== DONE (raw sources only) ===");
  console.log(JSON.stringify(results, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
