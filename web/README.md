# Serverless Search Engine (`web/`)

MVP **Web Search + Notebooks** chạy **100% serverless trên Vercel**.

- Không Docker
- Không GPU / Ollama
- Không SurrealDB / FastAPI / SearXNG
- Free-tier APIs: **Tavily** (search) + **Groq** (LLM) + **Supabase Postgres** (DB)

Repo `open-notebook/` bên cạnh chỉ còn là **reference** (stack Docker cũ).

## Architecture

```text
Browser → Next.js (Vercel)
            ├─ /search                   session chat UI (ChatGPT-style)
            ├─ POST /api/search/sessions/.../messages  SSE + query expansion
            ├─ POST /api/web-search      one-shot SSE (stateless)
            ├─ POST /api/notebooks/...   upload + ask SSE
            ├─ Context engine            entities + coref + expand query
            ├─ Tavily / Brave            web results
            ├─ BM25 + BGE + Adaptive RRF retrieve/rerank
            ├─ Groq (OpenAI-compatible)  generate
            └─ Supabase Postgres         sessions + notebooks
```

### Multi-turn search sessions

Web Search is a **chat session**, not a single-shot form:

1. Each conversation is a `search_sessions` row with messages.
2. Before retrieval, `expandQuery` rewrites follow-ups using session entities + recent turns  
   (e.g. “ông ấy bao nhiêu tuổi?” → “Lionel Messi bao nhiêu tuổi?”).
3. Hybrid expansion: heuristics first, cheap LLM rewrite when needed.
4. Context is **isolated per session** — New chat clears memory.

## Quick start (local)

```bash
cd web
# put secrets in web/.env.local (or repo root .env + copy)
npm install
npm run db:init   # create tables on Supabase
npm run dev
```

Open http://localhost:3001 (scripts bind port **3001**).

If `APP_PASSWORD` is set, open `/login` first (or send `Authorization: Bearer <APP_PASSWORD>` to APIs).

Without Supabase REST keys (or `DATABASE_URL`), history/notebooks use **in-memory** storage (lost on restart / cold start). Production/Vercel without durable DB is fail-closed unless `ALLOW_MEMORY_DB=1`.

## Environment

| Variable | Required | Description |
|---|---|---|
| `LLM_API_KEY` | for answers | Groq/OpenRouter/OpenAI key |
| `LLM_BASE_URL` | no | default Groq OpenAI-compatible URL |
| `LLM_MODEL` | no | e.g. `llama-3.1-8b-instant` |
| `RETRIEVAL_MODE` | no | `bm25` default, or `adaptive_rrf` |
| `EMBEDDING_PROVIDER` | for adaptive RRF | `tei`, `openai`, or `huggingface` |
| `EMBEDDING_API_URL` | for `tei`/`openai` | self-host embedding endpoint or OpenAI-compatible base URL; optional override for Hugging Face |
| `EMBEDDING_API_KEY` | optional/required | bearer token; required for Hugging Face |
| `EMBEDDING_MODEL` | no | default `BAAI/bge-base-en-v1.5` |
| `TAVILY_API_KEY` | for web search | or set `BRAVE_API_KEY` |
| `SUPABASE_URL` | **yes on Vercel** | `https://PROJECT.supabase.co` |
| `SUPABASE_SECRET_KEY` | **yes on Vercel** | secret / service_role key (Dashboard → API Keys) |
| `DATABASE_URL` | optional | SQL fallback; prefer pooler `:6543` if used |
| `SUPABASE_PUBLIC_KEY` | optional | not required by this app |
| `APP_PASSWORD` | **required on Vercel/production** | Shared-secret gate for all product APIs/pages (Bearer or `/login` cookie) |
| `HEALTH_SECRET` | optional | unlocks detailed `/api/health` diagnostics (falls back to `APP_PASSWORD`) |

**Critical on Vercel:** search can work without DB, but **history + notebooks need** `SUPABASE_URL` + `SUPABASE_SECRET_KEY`.  
If `/api/health` shows `"db": "postgres"` and `hasSecretKey: false`, history/notebooks will fail.

## Supabase schema

```bash
# with DATABASE_URL in .env.local
npm run db:init
```

Or paste `drizzle/0000_init.sql` into Supabase **SQL Editor** → Run.

## Deploy to Vercel

1. Root Directory = `web`.
2. Add env vars (Production + Preview):

| Env | Required |
|-----|----------|
| `TAVILY_API_KEY` | yes (search) |
| `LLM_API_KEY` + `LLM_BASE_URL` + `LLM_MODEL` | yes (answers) |
| `RETRIEVAL_MODE=adaptive_rrf` + embedding env | for BGE dense retrieval |
| `SUPABASE_URL` | **yes on Vercel** e.g. `https://xxxx.supabase.co` |
| `SUPABASE_SECRET_KEY` | **yes on Vercel** (service/secret key) |
| `DATABASE_URL` | optional if REST keys set; if used, prefer **pooler :6543** |

3. In Supabase **SQL Editor**, run `drizzle/0000_init.sql` once (create tables).
4. Redeploy after setting env.
5. Health check:
   - Public: `GET /api/health` → only booleans `{ ok, status: { search, llm, db } }` (no stack leaks).
   - Diagnostics (optional): set `HEALTH_SECRET` or `APP_PASSWORD`, then  
     `GET /api/health?token=YOUR_SECRET`  
     Expect `providers.db: "supabase-rest"`, `dbProbe.ok: true`.

**Why notebooks failed on Vercel:** direct Postgres `db.*.supabase.co:5432` is unreliable from serverless. This app now uses **Supabase REST** with the secret key.

## Scripts

```bash
npm run dev      # local
npm run build    # production build
npm test         # BM25/chunk unit tests
npm run db:init  # create tables on Supabase
```

## API

- `GET /api/health` — provider status
- `GET/POST /api/search/sessions` — list / create chat sessions
- `GET/PATCH/DELETE /api/search/sessions/:id` — session + messages / rename / delete
- `POST /api/search/sessions/:id/messages` — multi-turn SSE (expand → search → answer)
- `POST /api/web-search` — one-shot SSE search pipeline (no session)
- `GET /api/web-search/history` — legacy flat runs
- `GET /api/web-search/:id` — one legacy run
- `GET/POST /api/notebooks`
- `GET/DELETE /api/notebooks/:id`
- `POST /api/notebooks/:id/upload` — multipart file
- `POST /api/notebooks/:id/ask` — SSE notebook Q&A

### DB migration

```bash
npm run db:init   # applies drizzle/0000_init.sql (+ 0001_search_sessions)
```

Or run `drizzle/0001_search_sessions.sql` in Supabase SQL Editor if tables already exist.

## Notes

- Reranker GPU is intentionally removed; BM25 + domain packing keeps it fast on serverless.
- Adaptive RRF uses BM25 plus dense embeddings. On Vercel, run BGE through a managed
  embedding API or a separate self-hosted embedding service; if it is missing or
  fails, retrieval falls back to BM25.
- For quick Hugging Face dev mode, set `EMBEDDING_PROVIDER=huggingface` and
  `EMBEDDING_API_KEY`; the app uses the HF Inference Providers router by default.
- Notebook uploads cache chunk embeddings in Supabase when adaptive retrieval is
  configured. Existing chunks without embeddings still work and are embedded
  on demand, or fall back to BM25.
- If LLM key is missing, retrieval still works (IR-only).
- Vercel hobby timeout is short; keep `searchLimit` low (default 8).
