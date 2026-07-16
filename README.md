# search-engine-web

## Deploy target (current)

**Serverless Next.js app** lives in [`web/`](./web):

- Host on **Vercel** (no Docker, no GPU)
- Web Search: Tavily/Brave → BM25 → Groq LLM + citations
- Notebooks: upload PDF/TXT → BM25 → LLM + evidence
- Optional Neon Postgres for durable history

```bash
cd web
cp .env.example .env.local
npm install
npm run dev
```

See [`web/README.md`](./web/README.md) for env vars and Vercel deploy.

## Legacy

[`open-notebook/`](./open-notebook) is the previous Docker + Ollama + SurrealDB stack (reference only).  
Original product plan notes remain in [`plan.md`](./plan.md).
