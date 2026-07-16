## Plan chốt cho coding agent: Search Engine hoàn toàn miễn phí

> **Update 2026-07:** Target deployment is now **serverless on Vercel** (`web/`), not Docker/Ollama.  
> Free-tier cloud APIs (Tavily + Groq + optional Neon) replace SearXNG/Ollama/SurrealDB for production.  
> See `web/README.md` and the session plan for the serverless architecture.

### 1. Mục tiêu MVP

Xây dựng một web app dựa trên repo **Open Notebook**, gồm hai tab:

```text
Tab 1 — Web Search
SearXNG → tải tài liệu → chunking → BM25 → reranker
        ├── Hiển thị kết quả IR + thời gian
        └── Local LLM → câu trả lời có citation + thời gian

Tab 2 — Notebook
Upload tài liệu → chunking → BM25 → reranker
               ├── Hiển thị evidence
               └── Local LLM → câu trả lời có citation
```

Open Notebook dùng Next.js/React cho frontend, FastAPI cho backend và SurrealDB để lưu dữ liệu, nên agent cần mở rộng repo hiện tại thay vì tạo project mới. ([GitHub][1])

---

# 2. Stack hoàn toàn miễn phí

| Thành phần          | Công nghệ                                    |
| ------------------- | -------------------------------------------- |
| Frontend            | Next.js + React + Tailwind của Open Notebook |
| Backend             | FastAPI                                      |
| Database            | SurrealDB hiện có                            |
| Web search          | SearXNG self-host bằng Docker                |
| Tải trang web       | `httpx`                                      |
| Trích xuất nội dung | `trafilatura`                                |
| Chunking            | Token/word-based chunker                     |
| Retrieval           | BM25 bằng `rank-bm25`                        |
| Reranking           | `BAAI/bge-reranker-v2-m3` chạy local         |
| LLM                 | Ollama chạy local trên RTX 4060              |
| Streaming           | Server-Sent Events                           |
| Deployment          | Docker Compose                               |

SearXNG là metasearch engine mã nguồn mở, có HTTP Search API và có thể tự host mà không cần đăng ký API trả phí. ([SearXNG Documentation][2])

Ollama chạy model trên máy local và cung cấp API tương thích OpenAI, phù hợp để backend gọi model mà không cần dịch vụ trả phí. ([Ollama][3])

`bge-reranker-v2-m3` là reranker đa ngôn ngữ và có thể tải weight từ Hugging Face để chạy local. ([Hugging Face][4])

---

# 3. Cấu hình model mặc định

```yaml
search:
  provider: searxng
  max_results: 20
  max_pages_to_fetch: 15
  fetch_concurrency: 5
  timeout_seconds: 10

chunking:
  chunk_size_words: 350
  chunk_overlap_words: 60

retrieval:
  method: bm25
  retrieve_top_k: 40

reranking:
  model: BAAI/bge-reranker-v2-m3
  rerank_top_k: 10
  device: cuda

generation:
  provider: ollama
  context_top_k: 6
  temperature: 0.1
  max_output_tokens: 800
```

Model sinh câu trả lời nên là instruct model 3B–7B, quantized 4-bit. Model phải cấu hình qua `.env`, không hard-code.

---

# 4. Kiến trúc chung

```text
Next.js Frontend
│
├── /search
│   └── Giao diện kiểu Perplexity
│
├── /notebooks
│   └── Giao diện Open Notebook
│
└── /runs
    └── Lịch sử và metrics

FastAPI Backend
│
├── SearchProvider
│   └── SearXNGProvider
│
├── DocumentProcessor
│   ├── fetch
│   ├── extract
│   ├── clean
│   └── chunk
│
├── RetrievalPipeline
│   ├── BM25
│   ├── reranker
│   └── context packer
│
├── LocalGenerator
│   └── Ollama
│
└── MetricsLogger
```

Hai tab phải dùng chung một `RetrievalPipeline`. Chỉ khác nguồn dữ liệu:

```text
Web Search: dữ liệu lấy từ internet.
Notebook: dữ liệu lấy từ tài liệu người dùng upload.
```

---

# 5. Pipeline IR baseline

## Bước 1: Chunking

Mỗi document được chia thành:

```python
{
    "chunk_id": "...",
    "document_id": "...",
    "title": "...",
    "url": "...",
    "text": "...",
    "chunk_index": 0
}
```

Mặc định:

* 350 từ mỗi chunk.
* Overlap 60 từ.
* Không trộn nội dung giữa hai document.

## Bước 2: BM25

BM25 nhận toàn bộ chunk và query:

```text
Query + chunks → BM25 → top 40 chunks
```

Lưu:

* BM25 score.
* BM25 rank.
* Document ID.
* Chunk ID.

## Bước 3: Reranking

Cross-encoder nhận từng cặp:

```text
(query, chunk_text)
```

Sau đó rerank top 40 thành top 10.

Lưu:

* BM25 rank.
* Reranker rank.
* BM25 score.
* Reranker score.

## Bước 4: Context packing

Chọn khoảng 6 chunk tốt nhất:

* Không lấy quá nhiều chunk từ một website.
* Ưu tiên nhiều nguồn khác nhau.
* Không vượt giới hạn context của LLM.
* Gán citation ID `[1]`, `[2]`, `[3]`.

Pipeline phải có interface để sau này bạn của bạn thay BM25/reranker:

```python
class RetrievalPipeline:
    async def retrieve(
        self,
        query: str,
        chunks: list[Chunk],
        top_k: int,
    ) -> list[RankedChunk]:
        ...
```

---

# 6. Tab 1 — Web Search

## Giao diện

```text
┌────────────────────────────────────────────┐
│ Logo     Web Search | Notebook             │
├────────────────────────────────────────────┤
│                                            │
│        What do you want to research?       │
│       [____________________________]       │
│              [ Search ]                    │
│                                            │
└────────────────────────────────────────────┘
```

Sau khi tìm kiếm:

```text
┌───────────────────────────┬────────────────┐
│ Generated Answer          │ Sources        │
│                           │                │
│ Answer with [1], [2]      │ 1. Website A   │
│ citations                 │ 2. Website B   │
│                           │ 3. Website C   │
├───────────────────────────┴────────────────┤
│ Answer | Ranked Results | Evidence | Time  │
└────────────────────────────────────────────┘
```

Không sao chép logo, tên, icon hoặc asset của Perplexity; chỉ dùng bố cục và trải nghiệm tương tự.

## Luồng backend

```text
1. Nhận query.
2. Gọi SearXNG lấy top 20 URL.
3. Chuẩn hóa và loại URL trùng.
4. Tải tối đa 15 trang.
5. Trích xuất title và main text.
6. Chunking.
7. BM25 lấy top 40 chunk.
8. Reranker lấy top 10.
9. Trả nhánh kết quả IR.
10. Gửi top 6 chunk vào Ollama.
11. Stream câu trả lời về frontend.
```

## Hai kết quả riêng biệt

### Retrieval result

Hiển thị ngay khi reranking hoàn tất:

```text
Retrieval completed: 3.42 seconds

1. Document A
   BM25 rank: 8
   Final rank: 1
   Reranker score: 0.91

2. Document B
   BM25 rank: 2
   Final rank: 2
   Reranker score: 0.86
```

### Generated answer

```text
Answer generation: 6.18 seconds
Time to first token: 0.82 seconds
Sources used: 5
Chunks used: 6
```

Retrieval vẫn phải hiển thị nếu Ollama lỗi.

---

# 7. Tab 2 — Notebook

Giữ phần lớn giao diện và chức năng của Open Notebook.

## Luồng dữ liệu

```text
Upload PDF/TXT/DOCX/URL
        ↓
Extract text
        ↓
Chunk
        ↓
Lưu document và chunks
        ↓
BM25 index
```

## Luồng hỏi đáp

```text
Question
   ↓
BM25 trên tài liệu đã chọn
   ↓
Rerank
   ↓
Hiển thị evidence
   ↓
Ollama sinh answer có citation
```

Thêm một panel mới:

```text
Retrieved Evidence

1. source.pdf — page 4
   BM25: 8.42
   Reranker: 0.89

2. source.pdf — page 7
   BM25: 7.91
   Reranker: 0.84
```

Người dùng phải chọn được:

* Tất cả source trong notebook.
* Chỉ một vài source.
* Số lượng kết quả retrieval.
* Có hoặc không sử dụng LLM.

---

# 8. API cần tạo

## Web search

```http
POST /api/search/runs
GET  /api/search/runs/{run_id}
GET  /api/search/runs/{run_id}/events
POST /api/search/runs/{run_id}/cancel
```

Request:

```json
{
  "query": "What is retrieval augmented generation?",
  "search_limit": 20,
  "retrieve_top_k": 40,
  "rerank_top_k": 10,
  "context_top_k": 6,
  "generate_answer": true
}
```

## Notebook retrieval

```http
POST /api/notebooks/{notebook_id}/retrieve
POST /api/notebooks/{notebook_id}/answer
```

## Model health

```http
GET /api/health/searxng
GET /api/health/ollama
GET /api/health/reranker
```

---

# 9. SSE progress events

Frontend cần nhận các event:

```text
search_started
search_results_received
fetch_started
document_fetched
document_failed
chunking_completed
bm25_completed
reranking_completed
retrieval_ready
generation_started
generation_token
generation_completed
run_completed
run_failed
```

UI hiển thị:

```text
✓ Search completed
✓ 13/15 documents fetched
✓ 428 chunks created
✓ BM25 completed
✓ Reranking completed
● Generating answer...
```

---

# 10. Metrics MVP

## Metrics luôn hiển thị

```text
Search time
Document fetching time
Extraction time
Chunking time
BM25 time
Reranking time
LLM time
Total time
Time to first token
```

## Số lượng

```text
Search results returned
Documents fetched successfully
Documents failed
Duplicate URLs removed
Chunks created
Chunks retrieved
Chunks reranked
Sources used by LLM
```

## Metrics định tính

* BM25 rank so với reranker rank.
* Highlight đoạn evidence.
* Source nào được LLM sử dụng.
* Citation nào liên kết với chunk nào.
* Nút `Relevant` và `Not relevant`.

Các metric như Recall@k, MRR và nDCG để sang phase benchmark vì cần ground truth.

---

# 11. Cấu trúc code đề xuất

```text
backend/
├── app/
│   ├── api/
│   │   ├── search.py
│   │   ├── notebook_retrieval.py
│   │   └── health.py
│   ├── search/
│   │   ├── providers/
│   │   │   └── searxng.py
│   │   ├── fetcher.py
│   │   ├── extractor.py
│   │   └── normalizer.py
│   ├── retrieval/
│   │   ├── contracts.py
│   │   ├── chunker.py
│   │   ├── bm25.py
│   │   ├── reranker.py
│   │   ├── context_packer.py
│   │   └── pipeline.py
│   ├── generation/
│   │   └── ollama_client.py
│   └── metrics/
│       └── run_metrics.py

frontend/
├── src/app/
│   ├── search/page.tsx
│   ├── notebooks/
│   └── runs/[runId]/page.tsx
└── src/components/search/
    ├── SearchInput.tsx
    ├── SearchProgress.tsx
    ├── AnswerPanel.tsx
    ├── SourcePanel.tsx
    ├── RankedResults.tsx
    ├── EvidenceCard.tsx
    ├── MetricsPanel.tsx
    └── PipelineTimeline.tsx
```

Agent phải kiểm tra cấu trúc thật của repo trước khi tạo file, không được giả định đường dẫn trên hoàn toàn chính xác.

---

# 12. Docker Compose

```text
services:
  frontend
  backend
  worker
  surrealdb
  searxng
```

Ollama nên chạy trực tiếp trên máy host để sử dụng RTX 4060:

```text
Frontend/backend trong Docker
            ↓
http://host.docker.internal:11434
            ↓
Ollama trên máy local
```

Reranker có thể:

* Chạy trong FastAPI process ở MVP.
* Load một lần khi backend khởi động.
* Chuyển thành model worker riêng sau này.

---

# 13. Thứ tự triển khai

## Phase 1 — Chạy repo gốc

* Clone Open Notebook.
* Chạy frontend, backend, worker và SurrealDB.
* Xác nhận upload và notebook hiện tại hoạt động.
* Không sửa chức năng cũ.

## Phase 2 — Tạo giao diện Web Search

* Thêm navigation hai tab.
* Tạo `/search`.
* Dùng mock data trước.
* Hoàn thiện layout Answer, Sources, Results và Metrics.

## Phase 3 — SearXNG và web extraction

* Thêm SearXNG vào Docker Compose.
* Tạo search provider.
* Fetch và extract nội dung website.
* Xử lý URL lỗi mà không làm toàn bộ run thất bại.

## Phase 4 — BM25 và reranker

* Viết shared retrieval pipeline.
* BM25 top 40.
* Reranker top 10.
* Hiển thị rank và score trên frontend.

## Phase 5 — Ollama

* Tạo Ollama client.
* Stream token qua SSE.
* Citation phải liên kết đúng source.
* Nếu Ollama lỗi, kết quả IR vẫn giữ nguyên.

## Phase 6 — Tích hợp Notebook

* Dùng cùng chunker và retrieval pipeline.
* Cho phép chọn source.
* Thêm evidence panel và metrics.
* Không phá các chức năng Notebook hiện có.

## Phase 7 — Run history và export

* Lưu query, config, result và timing.
* Xem lại từng run.
* Export JSON và CSV.

---

# 14. Acceptance criteria

Agent chỉ được coi là hoàn thành MVP khi:

```text
[ ] Không cần API key trả phí.
[ ] SearXNG trả được kết quả tìm kiếm.
[ ] Có thể tải và trích xuất ít nhất 10 website.
[ ] BM25 trả top chunks.
[ ] Reranker thay đổi thứ tự BM25.
[ ] Kết quả IR xuất hiện trước câu trả lời LLM.
[ ] Ollama chạy bằng GPU local.
[ ] Answer có citation mở đúng evidence.
[ ] Hiển thị thời gian của từng stage.
[ ] Một website lỗi không làm cả query lỗi.
[ ] Tab Notebook dùng cùng retrieval pipeline.
[ ] Upload → retrieve → answer hoạt động end-to-end.
[ ] Có run history.
[ ] Có export JSON/CSV.
[ ] Chức năng Open Notebook cũ không bị hỏng.
```

## Phạm vi chưa làm trong MVP

```text
Không đăng nhập nhiều người dùng
Không thanh toán
Không dùng Google API
Không vector database riêng
Không embedding retrieval
Không fine-tuning
Không web crawler nhiều tầng
Không agent tự động tìm kiếm nhiều vòng
Không Recall@k/MRR nếu chưa có benchmark
```

Điểm quan trọng nhất agent phải tuân thủ là: **frontend có thể làm chi tiết ngay, nhưng backend retrieval phải được tách thành interface rõ ràng để sau này bạn của bạn thay BM25 bằng pipeline IR riêng mà không cần sửa giao diện hoặc API.**

[1]: https://github.com/lfnovo/open-notebook/blob/main/docs/7-DEVELOPMENT/architecture.md?utm_source=chatgpt.com "open-notebook/docs/7-DEVELOPMENT/architecture.md at ..."
[2]: https://docs.searxng.org/dev/search_api.html?utm_source=chatgpt.com "Search API"
[3]: https://docs.ollama.com/api/openai-compatibility?utm_source=chatgpt.com "OpenAI compatibility"
[4]: https://huggingface.co/BAAI/bge-reranker-v2-m3?utm_source=chatgpt.com "BAAI/bge-reranker-v2-m3"
