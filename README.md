# Search Engine Web

Serverless **Web Search + Dataset Notebooks** app — deploy on **Vercel**, store data in **Supabase Postgres**, free-tier APIs for search / LLM / embeddings.

| Surface | What it does |
|--------|----------------|
| **Web Search** (`/search`) | Multi-turn chat: expand query → Tavily/Brave → retrieve → Groq answer + citations |
| **Notebooks** (`/notebooks`) | Upload docs → embed & index → ask over **your corpus** with evidence |

Active product lives in [`web/`](./web). That is the only runtime path (Next.js → Vercel + Supabase).

The old Docker stack (upstream [Open Notebook](https://github.com/lfnovo/open-notebook) style) is **not part of the product**: it is gitignored as `open-notebook/` if you keep a local clone for reference. It is never imported by `web/`, never built on Vercel, and does not affect search or notebook flows.

---

## Table of contents

1. [Architecture](#architecture)
2. [Product flows](#product-flows)
3. [Repo layout](#repo-layout)
4. [Quick start (local)](#quick-start-local)
5. [Environment variables](#environment-variables)
6. [Database & migrations](#database--migrations)
7. [Deploy to Vercel](#deploy-to-vercel)
8. [Scripts](#scripts)
9. [API overview](#api-overview)
10. [Troubleshooting](#troubleshooting)

---

## Architecture

```text
Browser ──► Next.js 16 (Vercel / local :3001)
              │
              ├─ /search /search/[sessionId]
              │     multi-turn web sessions (isolated memory per session)
              │
              ├─ /notebooks /notebooks/[id]
              │     dataset workspace: upload → index → ask
              │
              ├─ IR: BM25  |  Adaptive RRF (BM25 + dense BGE)
              ├─ LLM: Groq (OpenAI-compatible)
              └─ DB: Supabase Postgres (REST + optional DATABASE_URL)
                    notebooks · sources · chunks(+embedding_json)
                    notebook_messages · search_sessions · search_messages · users
```

**Not MongoDB.** Vectors and documents are stored in **Postgres** (`chunks.embedding_json` and related tables).

### Two session types (keep them separate)

| | Web Search | Notebook dataset |
|--|------------|------------------|
| Route | `/search/[sessionId]` | `/notebooks/[id]` |
| Corpus | Live web results | Your uploaded sources |
| Chat history | `search_sessions` + `search_messages` | `notebook_messages` (per user × notebook) |
| Isolation | Each search session has its own context | Each notebook has its own corpus + chat |

Do **not** mix web-search session IDs with notebook IDs — different tables and pipelines.

---

## Product flows

### A) Upload → extract → store → embed → DB (Notebooks)

```text
1. Client  POST /api/notebooks/:id/upload  (multipart, optional SSE)
2. Server  size check → extract PDF/TXT → store full text in `sources`
3. Index   (when embedding configured)
           · split units / chunks
           · call embedding API
           · write vectors to `chunks.embedding_json` (Postgres)
           · update notebook index_status (ready / failed / skipped)
4. UI      UploadPipelinePanel shows steps:
           receive → extract → store → embed → persist
           success / fail are visible end-to-end
```

**Lock:** Notebooks can be **locked** so they cannot be deleted (demo corpora like SCIFACT / SCIDOCS are locked by migration). Unlock only if product policy allows.

### B) Ask over a notebook (answer quality depends on this)

```text
1. UI      user question → POST /api/notebooks/:id/ask (SSE)
2. Load    loadChunks(notebookId) — whole corpus (optional sourceIds in API)
3. Retrieve
           · BM25 only, or
           · adaptive_rrf = BM25 + dense (pre-indexed embeddings preferred)
4. Pack    top evidence units → context window
5. LLM     Groq streams answer grounded on evidence
6. Persist notebook_messages + IR artifacts for the thread
```

**Why answers can be wrong/slow**

| Cause | Effect |
|-------|--------|
| Query not in the uploaded text | LLM may hallucinate names/facts not present in corpus |
| No `EMBEDDING_*` keys | Index skipped → BM25 only (OK, but weaker hybrid) |
| Embed at query time for unindexed chunks | Extra latency on first asks |
| Whole-notebook scope always | Noisy corpus if many unrelated docs |
| Vercel timeout / large files | Partial steps or slow upload indexing |

### C) Web search multi-turn

```text
New session → expandQuery (entities + recent turns)
           → Tavily/Brave → fetch/chunk → retrieve → LLM + citations
Context is isolated per search session (“New chat” clears memory).
```

---

## Repo layout

```text
search-engine-web/
├── web/                    ← ACTIVE product (deploy this)
│   ├── src/app/            Next.js App Router + API routes
│   ├── src/components/     Dataset + Search UI
│   ├── src/lib/ir/         BM25, adaptive RRF, embeddings index
│   ├── src/lib/db/         schema, repos, memory fallback
│   ├── drizzle/            SQL migrations 0000…0005
│   ├── scripts/            db-init, seed BEIR, index embeddings
│   └── README.md           Web-focused env / API detail
├── README.md               ← you are here
└── .gitignore
```

Local-only / ignored (not in git): `venv/`, `ui-ux-pro-max-skill/`, `open-notebook/` (legacy reference clone), scratch notes like `plan.md`.

---

## Quick start (local)

### Prerequisites

- **Node.js 20+**
- A free **Supabase** project (recommended)  
  — or leave DB unset for **in-memory** mode (data lost on restart)
- API keys: **Groq** (answers), **Tavily** or **Brave** (web search), optional **Hugging Face / TEI** (embeddings)

### Steps

```bash
# 1) Enter app
cd web

# 2) Env
cp .env.example .env.local
# edit .env.local — at least LLM + search + Supabase for full UX

# 3) Install
npm install

# 4) Schema (needs DATABASE_URL or Supabase SQL Editor — see below)
npm run db:init

# 5) Dev server (port 3001)
npm run dev
```

Open **http://localhost:3001**

| Path | Purpose |
|------|---------|
| `/login` | Register / login (multi-user) |
| `/notebooks` | Dataset workspaces |
| `/search` | Web search chats |

Optional demo corpora (needs DB + seed data files under `web/data/` when prepared):

```bash
npm run seed:scifact
npm run seed:scidocs
# then, with embeddings configured:
npm run index:embeddings
```

---

## Environment variables

Copy from [`web/.env.example`](./web/.env.example). Summary:

| Variable | Required | Role |
|----------|----------|------|
| `LLM_API_KEY` | For answers | Groq / OpenRouter / OpenAI-compatible |
| `LLM_BASE_URL` | No | Default Groq |
| `LLM_MODEL` | No | e.g. `llama-3.1-8b-instant` |
| `TAVILY_API_KEY` or `BRAVE_API_KEY` | For web search | Search provider |
| `RETRIEVAL_MODE` | No | `bm25` (default) or `adaptive_rrf` |
| `EMBEDDING_PROVIDER` | For hybrid | `huggingface` \| `openai` \| `tei` |
| `EMBEDDING_API_KEY` | Often yes | HF / OpenAI-style bearer |
| `EMBEDDING_API_URL` | TEI / custom | Embedding endpoint |
| `EMBEDDING_MODEL` | No | Default `BAAI/bge-base-en-v1.5` |
| `SUPABASE_URL` | **Prod / durable** | `https://PROJECT.supabase.co` |
| `SUPABASE_SECRET_KEY` | **Prod / durable** | Service / secret key |
| `DATABASE_URL` | Optional | Postgres URL (pooler `:6543` preferred) |
| `APP_SESSION_SECRET` | Prod | HMAC secret for user session cookies |
| `APP_PASSWORD` | Optional | Ops / shared gate / health |
| `HEALTH_SECRET` | Optional | Detailed `/api/health` diagnostics |
| `ALLOW_MEMORY_DB` | Dev only | `1` allows ephemeral DB in “prod-like” modes |

**Recommended local hybrid setup**

```env
RETRIEVAL_MODE=adaptive_rrf
EMBEDDING_PROVIDER=huggingface
EMBEDDING_API_KEY=hf_...
EMBEDDING_MODEL=BAAI/bge-base-en-v1.5
```

Without embedding keys, upload still stores text; index status becomes **skipped** and ask uses **BM25**.

---

## Database & migrations

SQL lives in [`web/drizzle/`](./web/drizzle/):

| File | Purpose |
|------|---------|
| `0000_init.sql` | Core tables |
| `0001_search_sessions.sql` | Web search sessions |
| `0002_chunk_embeddings.sql` | Embedding storage |
| `0003_users.sql` | Multi-user auth |
| `0004_chat_history_owners.sql` | Chat ownership |
| `0005_notebook_lock_index.sql` | Dataset **lock** + **index progress** fields |

Apply:

```bash
cd web
npm run db:init
```

Or paste migrations in order in Supabase **SQL Editor**.

Storage reminder: embeddings are in **Postgres**, not MongoDB.

---

## Deploy to Vercel

1. Import the GitHub repo.
2. Set **Root Directory** = `web`.
3. Add env vars (Production + Preview) — at minimum:

   - `LLM_*`, `TAVILY_API_KEY` (or Brave)
   - `SUPABASE_URL`, `SUPABASE_SECRET_KEY`
   - `APP_SESSION_SECRET` (strong random)
   - For hybrid: `RETRIEVAL_MODE=adaptive_rrf` + embedding vars

4. Run all `drizzle/*.sql` migrations once on Supabase.
5. Deploy. Check:

   - `GET /api/health` → booleans for search / llm / db  
   - With secret: `GET /api/health?token=...` for detailed probe

**Monorepo note:** tracing roots point at the repo root so Vercel does not hit `.next` path `ENOENT` when the app dir is `web/`.

**Why not raw `db.*.supabase.co:5432` only?** Serverless → Postgres TCP is flaky; the app prefers **Supabase REST** with the secret key.

---

## Scripts

Run from `web/`:

| Command | Description |
|---------|-------------|
| `npm run dev` | Dev server on **:3001** |
| `npm run build` / `start` | Production build & serve |
| `npm test` | Vitest unit tests |
| `npm run db:init` | Apply SQL migrations |
| `npm run seed:scifact` / `seed:scidocs` | Seed demo notebooks |
| `npm run index:embeddings` | Pre-index raw demos |
| `npm run bench:retrieval` | Quick retrieval bench |

---

## API overview

| Method | Path | Notes |
|--------|------|--------|
| `GET` | `/api/health` | Provider status |
| `GET/POST` | `/api/search/sessions` | List / create web chats |
| `POST` | `/api/search/sessions/:id/messages` | Multi-turn SSE web Q&A |
| `POST` | `/api/web-search` | One-shot SSE (no session) |
| `GET/POST` | `/api/notebooks` | List / create datasets |
| `GET/PATCH/DELETE` | `/api/notebooks/:id` | Meta, **lock**, delete (blocked if locked) |
| `POST` | `/api/notebooks/:id/upload` | Multipart + **SSE progress** (embed → DB) |
| `POST` | `/api/notebooks/:id/ask` | SSE notebook Q&A |
| `GET/POST` | `/api/notebooks/:id/messages` | Notebook chat history |

More detail: [`web/README.md`](./web/README.md).

---

## Troubleshooting

| Symptom | What to check |
|---------|----------------|
| Notebooks empty after deploy | `SUPABASE_URL` + `SUPABASE_SECRET_KEY`; `/api/health` db probe |
| Upload OK but “index skipped” | Set `EMBEDDING_API_KEY` / provider; redeploy |
| Slow first ask | Pre-index on upload failed or embeddings missing → embed on demand |
| Wrong factual answer | Confirm the fact exists in **Sources** tab; model cannot invent from empty extract |
| Cannot delete SCIFACT/SCIDOCS | Expected if **locked** — protect demos |
| Vercel build `ENOENT .next/package.json` | Ensure latest main (monorepo tracing roots) |
| Auth loop | Set `APP_SESSION_SECRET`; register a user at `/login` |

---

## License & credits

- Product path: `web/` (Next.js serverless).
- Optional local reference: clone [lfnovo/open-notebook](https://github.com/lfnovo/open-notebook) into `open-notebook/` (gitignored; no runtime effect).
- Free-tier oriented: Tavily/Brave + Groq + Supabase + optional HF embeddings.

---

**Maintainers:** work on feature branches (`debug/…`), merge to `main` when verified.  
For app-only docs and env tables, see [`web/README.md`](./web/README.md).
