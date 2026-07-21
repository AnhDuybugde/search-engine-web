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

### Core (bắt buộc trên Vercel)

| Variable | Required | Description |
|---|---|---|
| `LLM_API_KEY` | for answers | Groq/OpenRouter/OpenAI key |
| `LLM_BASE_URL` | no | default Groq OpenAI-compatible URL |
| `LLM_MODEL` | no | e.g. `llama-3.1-8b-instant` |
| `TAVILY_API_KEY` | for web search | or set `BRAVE_API_KEY` |
| `SUPABASE_URL` | **yes on Vercel** | `https://PROJECT.supabase.co` |
| `SUPABASE_SECRET_KEY` | **yes on Vercel** | secret / service_role key |
| `DATABASE_URL` | optional | SQL fallback; prefer pooler `:6543` |
| `APP_SESSION_SECRET` | prod multi-user | HMAC for session cookies |
| `APP_PASSWORD` | optional | ops / health |
| `HEALTH_SECRET` | optional | detailed `/api/health` |
| `ALLOW_MEMORY_DB` | dev only | allow ephemeral DB in prod-like mode |

### Retrieval — Paper mode (thay Adaptive)

Nhập các biến này trong **Vercel → Project → Settings → Environment Variables**
(Production + Preview), rồi **Redeploy**.

| Variable | Required for Paper | Example / default | Description |
|---|---|---|---|
| `RETRIEVAL_MODE` | recommended | `paper` | `bm25` \| `paper` \| `sgaf` (`adaptive_rrf` vẫn map → paper) |
| `EMBEDDING_PROVIDER` | **yes** | `huggingface` | `huggingface` \| `tei` \| `openai` |
| `EMBEDDING_API_KEY` | **yes** (HF) | `hf_...` | Hugging Face token (cũng dùng cho SciNCL + CE nếu không set key riêng) |
| `EMBEDDING_API_URL` | for `tei`/`openai` | TEI URL | endpoint embedding |
| `EMBEDDING_MODEL` | no | `BAAI/bge-base-en-v1.5` | generalist / index model |
| `SCINCL_EMBEDDING_MODEL` | no | `malteos/scincl` | dense model cho Paper hybrid |
| `SCINCL_EMBEDDING_API_URL` | optional | (empty) | endpoint SciNCL riêng; mặc định HF router + key |
| `RERANK_MODEL` | no | `cross-encoder/ms-marco-MiniLM-L-6-v2` | cross-encoder query↔document |
| `RERANK_API_KEY` | optional | (empty) | fallback = `EMBEDDING_API_KEY` |
| `RERANK_API_URL` | optional | (empty) | endpoint rerank riêng (TEI/custom) |

**Checklist paste lên Vercel (Paper đầy đủ):**

```
RETRIEVAL_MODE=paper
EMBEDDING_PROVIDER=huggingface
EMBEDDING_API_KEY=hf_xxxxxxxx
EMBEDDING_MODEL=BAAI/bge-base-en-v1.5
SCINCL_EMBEDDING_MODEL=malteos/scincl
RERANK_MODEL=cross-encoder/ms-marco-MiniLM-L-6-v2
```

Thiếu embedding/rerank key → Paper vẫn chạy nhưng fallback BM25 hoặc hybrid không CE (không crash).

**Index sẵn (nhanh khi ask):** mỗi lần upload, app embed toàn corpus bằng `SCINCL_EMBEDDING_MODEL` (Paper) và ghi `chunks.embedding_json`.  
Ask chỉ embed **query** + RRF + CE. Dataset cũ chưa index → upload lại file hoặc đợi cold embed lần đầu.

### SGAF (optional)

| Variable | Description |
|---|---|
| `SPECIALIST_EMBEDDING_MODEL` | specialist embed model (e.g. fine-tuned BGE) |
| `SPECIALIST_EMBEDDING_API_URL` | optional dedicated endpoint |
| `SGAF_SHIFT_THRESHOLD` | default `2.0` |
| `P3_WINDOW` | default `20` |
| `P3_ALPHA` | default `0.10` |

**Vercel:** history + notebooks cần `SUPABASE_URL` + `SUPABASE_SECRET_KEY`.  
Paper mode cần `EMBEDDING_*` (+ HF key cho SciNCL/CE).

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
2. Env (Production + Preview) — xem bảng trên. Tối thiểu:
   - `LLM_API_KEY`, `TAVILY_API_KEY` (hoặc Brave)
   - `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `APP_SESSION_SECRET`
   - Paper: `RETRIEVAL_MODE=paper`, `EMBEDDING_PROVIDER=huggingface`, `EMBEDDING_API_KEY`
   - Optional Paper: `SCINCL_EMBEDDING_MODEL`, `RERANK_MODEL`, `RERANK_API_KEY`
3. Chạy migrations trên Supabase (gồm `0005_notebook_lock_index.sql` để lock SCIFACT/SCIDOCS).
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
