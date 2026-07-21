# Legacy Pipeline: BM25 + SciNCL + RRF + Cross-Encoder

Pipeline goc danh cho SciFact retrieval - Phase 1 cua SEG project.

## Pipeline

```
BM25 (lexical)
    \
     → Reciprocal Rank Fusion (RRF, k=60) → Cross-Encoder (MiniLM MS MARCO) → Final Ranking
    /
SciNCL (malteos/scincl, 564M params, 768d)
```

## Cach chay

```bash
# Cai dat
pip install sentence-transformers rank-bm25 numpy pandas scikit-learn pyyaml

# Tai BEIR SciFact dataset va dat vao data/beir/scifact/
# Cau truc: data/beir/scifact/corpus.jsonl, queries.jsonl, qrels/test.tsv

# Chay pipeline
cd legacy-pipeline
python run_scidocs.py
```

## Ket qua tham khao (SciFact test)

| Pipeline | nDCG@10 |
|---|---|
| BM25 | 0.6909 |
| SciNCL | 0.5640 |
| BM25 + SciNCL RRF (k=60) | 0.6630 |
| + Cross-Encoder rerank | 0.6939 |
| BGE-base (reference) | 0.7376 |

## Files

| File | Vai tro |
|---|---|
| `seg_retrieval/` | Core library: BM25Retriever, DenseRetriever, CrossEncoderReranker, RRF, metrics |
| `run_scidocs.py` | Pipeline chinh: BM25 + SciNCL + BGE-base + RRF + CE |
| `run_cost_comparison.py` | Benchmark latency/cost cac pipeline |
| `scifact.yaml` | Config dataset paths |
