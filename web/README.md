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
            ├─ POST /api/web-search      SSE
            ├─ POST /api/notebooks/...   upload + ask SSE
            ├─ Tavily / Brave            web results
            ├─ BM25 (pure TS)            retrieve
            ├─ Groq (OpenAI-compatible)  generate
            └─ Supabase Postgres         history + notebooks
```

## Quick start (local)

```bash
cd web
# put secrets in web/.env.local (or repo root .env + copy)
npm install
npm run db:init   # create tables on Supabase
npm run dev
```

Open http://localhost:3000

Without Supabase REST keys (or `DATABASE_URL`), history/notebooks use **in-memory** storage (lost on restart / cold start).

## Environment

| Variable | Required | Description |
|---|---|---|
| `LLM_API_KEY` | for answers | Groq/OpenRouter/OpenAI key |
| `LLM_BASE_URL` | no | default Groq OpenAI-compatible URL |
| `LLM_MODEL` | no | e.g. `llama-3.1-8b-instant` |
| `TAVILY_API_KEY` | for web search | or set `BRAVE_API_KEY` |
| `SUPABASE_URL` | **yes on Vercel** | `https://PROJECT.supabase.co` |
| `SUPABASE_SECRET_KEY` | **yes on Vercel** | secret / service_role key (Dashboard → API Keys) |
| `DATABASE_URL` | optional | SQL fallback; prefer pooler `:6543` if used |
| `SUPABASE_PUBLIC_KEY` | optional | not required by this app |

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
| `SUPABASE_URL` | **yes on Vercel** e.g. `https://xxxx.supabase.co` |
| `SUPABASE_SECRET_KEY` | **yes on Vercel** (service/secret key) |
| `DATABASE_URL` | optional if REST keys set; if used, prefer **pooler :6543** |

3. In Supabase **SQL Editor**, run `drizzle/0000_init.sql` once (create tables).
4. Redeploy after setting env.
5. Check `https://YOUR_APP.vercel.app/api/health` → `db: "supabase-rest"`, `dbProbe.ok: true`.

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
- `POST /api/web-search` — SSE search pipeline
- `GET /api/web-search/history` — past runs
- `GET /api/web-search/:id` — one run
- `GET/POST /api/notebooks`
- `GET/DELETE /api/notebooks/:id`
- `POST /api/notebooks/:id/upload` — multipart file
- `POST /api/notebooks/:id/ask` — SSE notebook Q&A

## Notes

- Reranker GPU is intentionally removed; BM25 + domain packing keeps it fast on serverless.
- If LLM key is missing, retrieval still works (IR-only).
- Vercel hobby timeout is short; keep `searchLimit` low (default 8).
