# Analysis: Quản lý document upload, chọn doc theo phiên, UI, và upload trùng

**Scope:** Active app `web/` (Next.js serverless). `open-notebook/` = legacy/reference only.  
**Date:** 2026-07-20  
**Kind:** Product analysis from code (no feature implementation in this goal).

---

## (a) Project overview

### Deploy surface

| Path | Role |
|------|------|
| `web/` | **Active product** — Vercel/serverless Next.js: Web Search + Dataset Notebooks |
| `open-notebook/` | **Legacy** Docker + FastAPI + SurrealDB + Ollama (reference only) |
| Root `plan.md` | Original free-stack MVP notes (outdated vs current deploy) |

### Main product routes (`web/`)

| UI route | Purpose |
|----------|---------|
| `/` | Redirect → `/notebooks` |
| `/notebooks`, `/notebooks/[id]` | Dataset list + chat shell (`DatasetChatLayout`) |
| `/search`, `/search/[sessionId]` | Multi-turn web search chats (`SearchChatLayout`) |
| `/login` | User accounts (scrypt + cookie/JWT-style session) |

| API (selected) | Purpose |
|----------------|---------|
| `POST /api/notebooks/:id/upload` | Multipart PDF/TXT/… → extract text → `addSource` (SSE optional) |
| `POST /api/notebooks/:id/ask` | SSE notebook Q&A over corpus |
| `GET /api/notebooks/:id` | Notebook + source list |
| `GET /api/notebooks/:id/sources/:sourceId` | Full source text for drawer |
| `GET/POST …/messages` | Flat chat history per (notebook, user) |
| `POST /api/search/sessions/:id/messages` | Multi-turn web search (Tavily/Brave → IR → LLM) |

### Data model (current)

```text
notebooks  1──*  sources     (full raw text; title/mime/charCount)
              └──* chunks    (legacy / optional; raw ingest writes 0 rows)

notebook_messages   (user_id + notebook_id + role + content + IR artifacts)
                    → ONE flat thread per user per notebook
                    → NOT multi-session; NO source_ids column

search_sessions  1──*  search_messages   (web chat only; no document corpus)
```

Schema proof (`web/drizzle/0000_init.sql`): `sources` has `notebook_id` only — **no session↔source join table**.  
`notebook_messages` (`0004_chat_history_owners.sql`) stores chat turns with evidence JSON — **no document selection field**.

### Pipelines (decision-relevant)

1. **Upload (dataset)**  
   File → extract text (`extractPdfText` / `extractPlainText`) → `addSource` stores **full text only** (`mode: "raw-sources-only"`). No chunk/embed at ingest.

2. **Notebook ask**  
   `loadChunks(notebookId, sourceIds?)` → units (raw sources as one unit each, or legacy chunks) → BM25 / adaptive RRF → pack context → Groq stream answer.  
   UI always loads **whole notebook** (see below).

3. **Web search**  
   Session entities + query expand → Tavily/Brave → chunk/fetch → retrieve → answer. **No uploaded document corpus.**

### UI shell (dataset)

`DatasetChatLayout` three columns:

- **Left:** `DatasetSidebar` — list/create/delete notebooks  
- **Center:** `ChatThread` + `DatasetComposer` (paperclip upload + ask)  
- **Right tabs:** Sources | Evidence | Process (+ `DocumentDetailDrawer` on rank click)

---

## (b) Current document lifecycle + ask scope

### Upload lifecycle

1. Client: `useUploadSse` → `POST /api/notebooks/:id/upload` with file.  
2. Server (`upload/route.ts`): size check (`maxUploadBytes` = 5MB) → extract → strip nulls → reject empty text.  
3. `addSource` (`notebooks-repo.ts`):
   - Ensures notebook exists  
   - Enforces **notebook-wide** char budget (`maxNotebookChars` = 200_000 across all sources)  
   - Inserts new row: new UUID, title = **filename**, mime, full text  
   - Returns `chunkCount: 0`, `mode: "raw-sources-only"`  
4. UI reloads source list; Sources tab shows title + char count + `raw` badge only (no checkbox, no delete, no rename).

### Ask / retrieval scope **today**

| Layer | Behavior |
|-------|----------|
| API | `POST …/ask` body allows optional `sourceIds: string[]` (`ask/route.ts`) and passes them to `loadChunks(id, sourceIds)`. |
| Repo | `loadChunks` filters by `sourceIds` **only when array is non-empty**; empty/omitted → **all sources in notebook**. |
| Pipeline | `runNotebookAskPipeline` ranks whatever `chunks` it receives — no further corpus filter. |
| **UI** | `DatasetChatLayout.onSend` posts `{ query, generateAnswer, contextTopK, documentTopK, retrieveTopK }` — **never `sourceIds`**. Grep: zero `sourceIds` in `DatasetChatLayout.tsx`. |

**Product truth:** Despite an unused API hook, the product behaves as **whole-notebook corpus for every turn**. There is no per-session document subset, no sticky selection, and no multi-chat-session model inside a notebook (contrast: web search has `search_sessions`).

Chat history is a **single chronological stream** per `(userId, notebookId)` via `notebook_messages` — closer to “one ongoing conversation on this dataset” than “many named sessions each with their own corpus subset.”

### Limits that affect “library” scale

- 5 MB per file  
- 200k characters total per notebook (sum of source texts)  
- Upload always full-text store; query-time IR builds units from full sources (can be heavy with many/large docs)

---

## (c) Duplicate upload behavior (code-backed)

### What happens if you upload the same document again?

**Every upload creates a new source row.** There is:

- No filename uniqueness check  
- No content hash / checksum  
- No “replace existing” / “skip if identical” branch  
- No unique index on `(notebook_id, title)` or content

`addSource` always does `const sourceId = randomUUID()` then insert.  
`upload/route.ts` never looks up existing sources before insert.

**Effects of duplicates:**

1. **Two (or N) rows** with the same title and same/similar text, different IDs.  
2. **Corpus doubles** for retrieval: `loadChunks` returns both; BM25/dense can rank both; metrics `chunkCount` / `sourcesUsed` inflate.  
3. **Char budget** counts both toward `maxNotebookChars` — duplicate uploads can hit the notebook limit faster.  
4. **Evidence UI** may show near-duplicate “Top documents” with the same title.  
5. **No automatic merge** of chat history or source list.

### Proof (shipped path tests)

File: `web/src/lib/db/raw-ingest-retrieve.test.ts`

- `duplicate same title+text creates two distinct sources (no content/filename dedup)`  
- `loadChunks without sourceIds uses whole notebook; with sourceIds filters subset`

Run (captured): 5/5 passed (see `verification-run.txt` in scratch).

### Quote-level anchors

```text
// notebooks-repo.ts addSource — always new id, insert only
const sourceId = randomUUID();
// … insert into sources / memSources — no SELECT for existing title/text

// ask/route.ts
sourceIds: z.array(z.string()).optional(),
const chunks = await loadChunks(id, parsed.data.sourceIds);

// DatasetChatLayout onSend — no sourceIds
await run(`/api/notebooks/${notebookId}/ask`, {
  query, generateAnswer: true, contextTopK: 4, documentTopK: 10, retrieveTopK: 40,
});
```

Schema: `sources (id, notebook_id, title, mime, text, …)` — no hash column, no session_id.

---

## (d) Feature recommendations — “quản lý doc + chọn dùng theo phiên”

Gaps proven above drive priorities. **“Phiên”** here = one dataset chat thread (and, if you add multi-thread later, each thread).

### Must-have (P0)

| Feature | Gap it closes | Notes |
|---------|---------------|--------|
| **1. Include/exclude sources for ask (per turn or sticky)** | UI never sends `sourceIds`; always whole corpus | Wire checkboxes in Sources tab → pass `sourceIds` already accepted by API. Default: all selected. Empty selection → block send with clear error. |
| **2. Delete source** | Only whole-notebook delete; no `deleteSource` API/UI | Soft or hard delete + cascade any future chunks; refresh corpus. Critical hygiene when duplicates exist. |
| **3. Source list actions (open preview, copy meta)** | List is display-only | Reuse `GET …/sources/:id` + drawer already used for ranked docs. |
| **4. Duplicate warning on upload (soft)** | Silent multi-insert of same filename/text | On upload: if same `title` or same content hash exists, prompt: *Skip / Add anyway / Replace*. Do **not** auto-skip without UX — silent skip is worse for users who meant a new version. |
| **5. Visible “active corpus” chip strip** | User cannot see which docs will be searched | Above composer: “Searching N of M sources” + quick edit. |

### Should-have (P1)

| Feature | Gap | Notes |
|---------|-----|--------|
| **6. Rename source / notebook title** | Titles fixed to upload filename; no PATCH source | Helps disambiguate `report.pdf` × 3. |
| **7. Content hash column + optional hard dedup policy** | No hash in schema | Store `sha256(text)` or file bytes; policy: warn-only (default) or reject-duplicate. |
| **8. Multi-session inside a dataset** | Flat `notebook_messages` only | Mirror web search: `notebook_sessions` + messages + **session_source_ids** (or JSON array). Each session remembers its doc set. |
| **9. Persist selected source set on session/message** | Ask history does not record which docs were in scope | Store `source_ids` on user message or session so replay/audit is honest. |
| **10. Bulk upload + multi-select delete** | One file at a time; no bulk | Efficiency for corpora > ~5 docs. |

### Nice-to-have (P2)

| Feature | Gap | Notes |
|---------|-----|--------|
| **11. Tags / folders inside notebook** | Flat list | Only after multi-session + selection exist. |
| **12. Replace-file versioning** | Duplicate versions pollute corpus | Keep version history optional; default replace updates text in place. |
| **13. Cross-notebook library / share source** | Sources bound to one `notebook_id` | Bigger data-model change; not needed for per-session selection. |
| **14. Per-doc status (processing / failed extract)** | Binary success/fail SSE | Useful when extract is flaky. |
| **15. Global user library outside notebooks** | N/A today | Defer until multi-notebook reuse is a real need. |

### Explicit non-recommendations (for now)

- **Do not** invent a second parallel corpus API while `sourceIds` already exists on ask.  
- **Do not** auto-dedupe without confirmation (user may want two similar contracts).  
- **Do not** require chunk-at-upload for selection UX — selection is at **source** granularity; current raw model is fine.

### Suggested delivery order

1. UI multi-select + pass `sourceIds` (uses existing backend)  
2. Delete source API + UI  
3. Soft duplicate detect on upload  
4. Persist selection on messages / optional multi-session  
5. Hash column + policy settings  

---

## (e) UI redesign — specific to `DatasetChatLayout`

Goal: efficient + clean, not a greenfield design system. Keep AppShell, resizable panels, Sources / Evidence / Process tabs.

### Layout outcomes

```text
┌─────────────┬──────────────────────────────┬────────────────────┐
│ Datasets    │ Toolbar: title · N/M sources │ [Corpus] Evidence  │
│ (as today)  │ ● Active: 3 docs selected    │  Process           │
│             ├──────────────────────────────┤                    │
│             │ Chat thread                  │ ☑ Select all      │
│             │                              │ ☑ report.pdf  12k  │
│             │                              │ ☐ notes.txt    2k  │
│             │                              │ ⚠ Dup: report.pdf  │
│             ├──────────────────────────────┤ [Delete] [Preview] │
│             │ Chips: report.pdf × notes…   │                    │
│             │ Composer  📎  Send           │                    │
└─────────────┴──────────────────────────────┴────────────────────┘
```

### Interaction details

1. **Sources tab → “Corpus picker”**  
   - Checkbox per source; header “Select all / none”.  
   - Meta: chars, mime icon, relative time, optional `dup` badge if same title/hash as sibling.  
   - Row actions: Preview (drawer), Rename (inline), Delete (confirm).  
   - Footer: “Used in next ask: N sources · ~X chars”.

2. **Sticky selection**  
   - Selection lives in client state keyed by `notebookId` (localStorage ok for MVP).  
   - When multi-session lands: selection owned by session row, not only localStorage.

3. **Composer affordance**  
   - Chip strip of selected titles (collapse after 3: “+2 more”).  
   - Click chip → jump to Sources tab / unselect.  
   - Paperclip stays for upload; after upload, **auto-select** the new source (and optionally warn if filename already exists).

4. **Toolbar subtitle**  
   Today: `"{n} raw sources · full-text search · no pre-index"`.  
   Better: `"{selected}/{total} sources in scope · {chars} chars"` so scope is always visible without opening the right panel.

5. **Evidence tab remains post-run**  
   - Show only docs that ranked; add filter “From selected corpus” is automatic if ask used `sourceIds`.  
   - If user had excluded a source but it still appears — that would be a bug; selection should make this impossible.

6. **Duplicate UX**  
   - After upload of same filename: toast/dialog with three actions (Skip / Keep both / Replace).  
   - In list: group or badge “2 copies” rather than two silent identical rows.

7. **Mobile**  
   - Keep left dataset drawer.  
   - Corpus picker as bottom sheet from “N/M sources” chip (don’t force right panel on small screens).

8. **Visual hierarchy (aesthetic, product-specific)**  
   - Primary surface = chat (already).  
   - Corpus controls secondary but always one glance away (toolbar count + chips).  
   - Avoid burying selection only inside Process tab.  
   - Reuse existing tokens (`--primary`, `chat-sidebar`, chips) — no new brand system required.

### What not to redesign now

- Web Search shell can stay separate (no doc corpus).  
- StepRail / ProcessExplainPanel stay diagnostic; don’t merge corpus management into Process.  
- Full “Notion-like” page-per-document editor is out of scope; this product is RAG chat over raw sources.

---

## Answers to the three user questions (concise)

### 1. Nên bổ sung chức năng gì để quản lý document và chọn dùng theo phiên?

**P0:** multi-select sources → gửi `sourceIds` (API đã có), xóa source, cảnh báo upload trùng, chip “đang search N/M docs”.  
**P1:** rename, content hash, multi-session trong dataset + persist selection, bulk ops.  
**P2:** tags, versioning, library dùng chung nhiều notebook.

### 2. Giao diện nên làm lại thế nào cho hiệu quả và tốt nhất có thể?

Giữ 3 cột `DatasetChatLayout`; biến tab **Sources** thành **Corpus picker** (checkbox + preview + delete); toolbar + chip strip hiển thị scope; sau upload auto-select + soft-dedup dialog; mobile dùng bottom sheet cho picker. Không redesign web search; không nhét quản lý doc vào tab Process.

### 3. Upload document trùng lặp thì điều gì xảy ra?

**Hiện tại:** luôn tạo source mới (UUID mới), không so tên/file/hash. Retrieval thấy **nhiều bản copy**, tốn char budget, evidence có thể trùng title. Không merge, không chặn. Đã khóa bằng unit test trên `addSource` + `loadChunks`.

---

## Verification checklist (plan criteria)

| Criterion | Status |
|-----------|--------|
| 1 Project map web vs open-notebook, routes, model, pipelines | Covered §(a) |
| 2 Upload store, whole-corpus ask, no UI session filter | Covered §(b) |
| 3 Feature recs tied to gaps, prioritized | Covered §(d) |
| 4 UI specific to DatasetChatLayout | Covered §(e) |
| 5 Prose only for product features (tests only prove current behavior) | This document |

Spot-check paths:

- `web/src/app/api/notebooks/[id]/upload/route.ts`  
- `web/src/lib/db/notebooks-repo.ts` (`addSource`, `loadChunks`)  
- `web/drizzle/0000_init.sql`, `0004_chat_history_owners.sql`  
- `web/src/lib/pipeline/notebook-ask.ts`  
- `web/src/app/api/notebooks/[id]/ask/route.ts`  
- `web/src/components/dataset/DatasetChatLayout.tsx`  
- `web/src/lib/db/raw-ingest-retrieve.test.ts` (dedup + scope)
