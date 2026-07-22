# Serverless Search Engine (`web/`)

MVP **Web Search + Notebooks** chạy **100% serverless trên Vercel**.

- Không Docker / GPU / Ollama
- Không SurrealDB / FastAPI / SearXNG cho production
- Free-tier: **Tavily** (search) + **Groq** (LLM) + **Supabase Postgres** (DB + embeddings)

Repo gốc: xem [README.md](../README.md) cho overview + luồng sản phẩm.

Sản phẩm runtime **chỉ** là thư mục `web/`. Thư mục `open-notebook/` (nếu còn trên máy) là clone legacy Docker/FastAPI, đã gitignore — **không** tham gia build/deploy và **không** ảnh hưởng Web Search / Notebooks.

---

## Architecture

```text
Browser → Next.js (Vercel)
            ├─ /search                   session chat UI
            ├─ POST /api/search/sessions/.../messages  SSE + query expansion
            ├─ POST /api/web-search      one-shot SSE (stateless)
            ├─ POST /api/notebooks/...   upload (SSE progress) + ask SSE
            ├─ Context engine            entities + coref + expand query
            ├─ Tavily / Brave            web results
            ├─ BM25 + BGE + Adaptive RRF retrieve/rerank
            ├─ Groq (OpenAI-compatible)  generate
            └─ Supabase Postgres         sessions + notebooks + chunk embeddings
```

**Storage:** documents + vectors in **Postgres** (`sources`, `chunks.embedding_json`) — not MongoDB.

### Multi-turn web search sessions

1. Mỗi conversation = một `search_sessions` + messages.
2. `expandQuery` rewrite follow-up bằng entities + recent turns.
3. Heuristic trước, LLM rewrite khi cần.
4. Context **cô lập theo session** — New chat xóa memory phiên đó.

### Notebook sessions (dataset)

1. Mỗi notebook = corpus riêng (`sources` / `chunks`).
2. Upload SSE: receive → extract → store → **embed** → persist (success/fail hiển thị).
3. Ask: load corpus → BM25 / adaptive_rrf → pack → LLM.
4. Chat history: `notebook_messages` theo `(user, notebook)`.
5. **Lock** notebook: chặn xóa (demo SCIFACT/SCIDOCS).

Web search sessions và notebook datasets **không dùng chung** ID/table.

---

## Quick start (local)

```bash
cd web
cp .env.example .env.local
# điền keys (LLM, search, Supabase, optional embeddings)
npm install
npm run db:init
npm run dev
```

Mở http://localhost:3001 (port **3001**).

- Có user auth: đăng ký/đăng nhập tại `/login`.
- Không Supabase: fallback **in-memory** (mất data khi restart). Production fail-closed trừ khi `ALLOW_MEMORY_DB=1`.

---

## Environment

| Variable | Required | Description |
|---|---|---|
| `LLM_API_KEY` | for answers | Groq/OpenRouter/OpenAI key |
| `LLM_BASE_URL` | no | default Groq OpenAI-compatible URL |
| `LLM_MODEL` | no | e.g. `llama-3.1-8b-instant` |
| `RETRIEVAL_MODE` | no | `bm25` default, or `adaptive_rrf` |
| `EMBEDDING_PROVIDER` | for adaptive RRF | `tei`, `openai`, or `huggingface` |
| `EMBEDDING_API_URL` | for `tei`/`openai` | embedding endpoint |
| `EMBEDDING_API_KEY` | often yes | bearer; required for Hugging Face |
| `EMBEDDING_MODEL` | no | default `BAAI/bge-base-en-v1.5` |
| `TAVILY_API_KEY` | for web search | or set `BRAVE_API_KEY` |
| `SUPABASE_URL` | **yes on Vercel** | `https://PROJECT.supabase.co` |
| `SUPABASE_SECRET_KEY` | **yes on Vercel** | secret / service_role key |
| `SUPABASE_STORAGE_BUCKET` | for large uploads | private Storage bucket, default `notebook-uploads` |
| `NEXT_PUBLIC_SUPABASE_URL` | for direct uploads | public project URL exposed to the browser |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | for direct uploads | public anon/publishable key only |
| `DIRECT_STORAGE_UPLOADS` | no | server flag: `0` keeps multipart fallback, `1` enables Storage uploads |
| `NEXT_PUBLIC_DIRECT_STORAGE_UPLOADS` | no | client flag; keep equal to the server flag |
| `DATABASE_URL` | optional | SQL fallback; prefer pooler `:6543` |
| `APP_SESSION_SECRET` | prod multi-user | HMAC for session cookies |
| `APP_PASSWORD` | optional | ops / health |
| `HEALTH_SECRET` | optional | detailed `/api/health` |
| `ALLOW_MEMORY_DB` | dev only | allow ephemeral DB in prod-like mode |

**Vercel:** history + notebooks cần `SUPABASE_URL` + `SUPABASE_SECRET_KEY`.  
Hybrid retrieval + auto-index upload cần embedding env; thiếu → index **skipped**, ask vẫn BM25.

---

## Supabase schema

```bash
npm run db:init
```

Migrations trong `drizzle/`:

| File | Nội dung |
|------|----------|
| `0000_init.sql` | Core |
| `0001_search_sessions.sql` | Web sessions |
| `0002_chunk_embeddings.sql` | Vectors |
| `0003_users.sql` | Users |
| `0004_chat_history_owners.sql` | Chat owners |
| `0005_notebook_lock_index.sql` | Lock + index status |

Hoặc paste lần lượt trong Supabase **SQL Editor**.

---

## Deploy to Vercel

1. **Root Directory** = `web`.
2. Env (Production + Preview): LLM, search, Supabase, session secret, optional embeddings.
3. Chạy migrations trên Supabase, bao gồm `drizzle/0006_notebook_uploads.sql`.
4. Tạo private Supabase Storage bucket trùng với `SUPABASE_STORAGE_BUCKET`.
5. Giữ `DIRECT_STORAGE_UPLOADS=0` và `NEXT_PUBLIC_DIRECT_STORAGE_UPLOADS=0` trong lần deploy đầu để rollback-safe.
6. Sau khi kiểm thử signed upload trên Preview, bật cả hai biến thành `1` rồi redeploy.
4. Redeploy.
5. Health:
   - Public: `GET /api/health` → `{ ok, status: { search, llm, db } }`
   - Diagnostics: `GET /api/health?token=YOUR_SECRET`

App dùng **Supabase REST** (secret key); TCP Postgres thuần dễ fail trên serverless.

---

## Scripts

```bash
npm run dev               # local :3001
npm run build && npm start
npm test
npm run db:init
npm run seed:scifact      # demo locked corpus (khi có data)
npm run seed:scidocs
npm run index:embeddings  # pre-index demos
npm run bench:retrieval
```

---

## API

| Endpoint | Role |
|----------|------|
| `GET /api/health` | Provider status |
| `GET/POST /api/search/sessions` | Web chat sessions |
| `POST /api/search/sessions/:id/messages` | Multi-turn SSE web Q&A |
| `POST /api/web-search` | One-shot SSE |
| `GET/POST /api/notebooks` | Datasets |
| `GET/PATCH/DELETE /api/notebooks/:id` | Meta / lock / delete |
| `POST /api/notebooks/:id/upload` | Multipart + SSE index progress |
| `POST /api/notebooks/:id/ask` | SSE notebook Q&A |
| `GET/POST /api/notebooks/:id/messages` | Notebook chat history |

---

## Notes

- Reranker GPU đã bỏ; serverless dùng BM25 + domain packing / adaptive RRF.
- Adaptive RRF = BM25 + dense. Thiếu embedding → fallback BM25.
- Upload có pre-index embeddings khi cấu hình đủ; UI hiện success/fail.
- Notebook **locked** không xóa được (bảo vệ demo).
- Vercel hobby timeout ngắn — giữ `searchLimit` thấp (default 8).
- LLM thiếu key: retrieval vẫn chạy (IR-only).
