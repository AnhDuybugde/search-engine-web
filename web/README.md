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

Without `DATABASE_URL`, history/notebooks use **in-memory** storage (lost on restart).

## Environment

| Variable | Required | Description |
|---|---|---|
| `LLM_API_KEY` | for answers | Groq/OpenRouter/OpenAI key |
| `LLM_BASE_URL` | no | default Groq OpenAI-compatible URL |
| `LLM_MODEL` | no | e.g. `llama-3.1-8b-instant` |
| `TAVILY_API_KEY` | for web search | or set `BRAVE_API_KEY` |
| `DATABASE_URL` | durable DB | Supabase Postgres URI (**no** `[]` around password) |
| `SUPABASE_PUBLIC_KEY` | optional | not used by SQL layer yet |
| `SUPABASE_SECRET_KEY` | optional | not used by SQL layer yet |

## Supabase schema

```bash
# with DATABASE_URL in .env.local
npm run db:init
```

Or paste `drizzle/0000_init.sql` into Supabase **SQL Editor** → Run.

## Deploy to Vercel

1. Import this repo (or only the `web` folder as root).
2. Set **Root Directory** = `web`.
3. Add env vars from `.env.example`.
4. Deploy.

No Docker services needed.

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
