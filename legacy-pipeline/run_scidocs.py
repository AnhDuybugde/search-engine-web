"""Run full SEG pipeline on SciDocs (25K docs, 1K queries, citation prediction).

Produces: BM25, SciNCL, BGE-base, Hybrid RRF, Adaptive RRF, CE rerank.
"""

from __future__ import annotations

import os
import sys
import time
from collections import defaultdict
from pathlib import Path

os.environ["TF_USE_LEGACY_KERAS"] = "1"
os.environ["TRANSFORMERS_NO_TF"] = "1"

import _bootstrap  # noqa: F401

import numpy as np

from seg_retrieval.datasets import load_beir_split_direct
from seg_retrieval.fusion import reciprocal_rank_fusion
from seg_retrieval.io import load_run, save_run
from seg_retrieval.metrics import evaluate_run
from seg_retrieval.retrievers import BM25Retriever, DenseRetriever
from seg_retrieval.rerank import CrossEncoderReranker
from seg_retrieval.types import Query

DATA_DIR = Path("data/scidocs")
RUN_DIR = Path("runs/scidocs")

# Adaptive RRF implementation borrowed from run_adaptive_rrf.py
from seg_retrieval.retrievers import tokenize as _tokenize
import math
import re
from collections import Counter


def _porter_stem(word: str) -> str:
    w = word.lower()
    if w.endswith("ies") and len(w) > 3: w = w[:-3] + "y"
    elif w.endswith("es") and len(w) > 3: w = w[:-2]
    elif w.endswith("s") and not w.endswith("ss") and len(w) > 2: w = w[:-1]
    if w.endswith("ing") and len(w) > 5: w = w[:-3]
    if w.endswith("ed") and len(w) > 4: w = w[:-2]
    if w.endswith("tion") and len(w) > 5: w = w[:-4] + "t"
    return w


def _build_idf_vocab(documents, min_df=2):
    N = len(documents)
    df = Counter()
    for doc in documents:
        terms = set(_tokenize(doc.text))
        for t in terms:
            s = _porter_stem(t)
            if len(s) >= 3: df[s] += 1
    return {t: math.log(N / c) for t, c in df.items() if c >= min_df}


def _query_mean_idf(text: str, idf_vocab: dict, default: float = 0.0) -> float:
    stems = [_porter_stem(t) for t in _tokenize(text) if len(t) >= 3]
    if not stems: return default
    idfs = [idf_vocab.get(s, default) for s in stems]
    return sum(idfs) / len(idfs)


def adaptive_rrf_fuse(bm25_run, dense_run, queries, idf_vocab,
                      scale=1.0, max_w=0.9, k=60, top_k=100):
    idfs = [_query_mean_idf(q.text, idf_vocab) for q in queries]
    center = np.median(idfs)
    fused = {}
    for query in queries:
        midf = _query_mean_idf(query.text, idf_vocab)
        w_bm25 = 0.05 + (1.0 / (1.0 + math.exp(-scale * (midf - center)))) * (max_w - 0.05)
        scores = defaultdict(float)
        for rank, (did, _) in enumerate(bm25_run.get(query.query_id, []), 1):
            scores[did] += w_bm25 / (k + rank)
        for rank, (did, _) in enumerate(dense_run.get(query.query_id, []), 1):
            scores[did] += 1.0 / (k + rank)
        fused[query.query_id] = sorted(scores.items(), key=lambda x: x[1], reverse=True)[:top_k]
    return fused


def main() -> None:
    RUN_DIR.mkdir(parents=True, exist_ok=True)

    print("Loading SciDocs dataset...")
    documents, queries, qrels = load_beir_split_direct(DATA_DIR, "test")
    print(f"  Docs: {len(documents)}, Queries: {len(queries)}, Judged queries: {len(qrels)}")
    doc_lookup = {d.doc_id: d for d in documents}

    # ==== BM25 ====
    print("\n[1/6] BM25 retrieval...")
    t0 = time.perf_counter()
    bm25 = BM25Retriever(documents)
    bm25_run = bm25.search(queries, 100)
    save_run(RUN_DIR / "test_bm25.csv", bm25_run)
    bm25_m = evaluate_run(bm25_run, qrels)
    print(f"  nDCG@10={bm25_m['ndcg@10']:.4f} MAP@10={bm25_m.get('map@10', 0):.4f}  "
          f"R@100={bm25_m['recall@100']:.4f}  ({time.perf_counter()-t0:.0f}s)")

    # ==== BGE-base ====
    print("\n[2/6] BGE-base dense retrieval...")
    t0 = time.perf_counter()
    bge = DenseRetriever(documents, "BAAI/bge-base-en-v1.5", 32)
    bge_run = bge.search(queries, 100)
    save_run(RUN_DIR / "test_dense_bge_base.csv", bge_run)
    bge_m = evaluate_run(bge_run, qrels)
    print(f"  nDCG@10={bge_m['ndcg@10']:.4f} MAP@10={bge_m.get('map@10', 0):.4f}  "
          f"R@100={bge_m['recall@100']:.4f}  ({time.perf_counter()-t0:.0f}s)")

    # ==== SciNCL ====
    print("\n[3/6] SciNCL dense retrieval...")
    t0 = time.perf_counter()
    scincl = DenseRetriever(documents, "malteos/scincl", 32)
    scincl_run = scincl.search(queries, 100)
    save_run(RUN_DIR / "test_dense_scincl.csv", scincl_run)
    scincl_m = evaluate_run(scincl_run, qrels)
    print(f"  nDCG@10={scincl_m['ndcg@10']:.4f} MAP@10={scincl_m.get('map@10', 0):.4f}  "
          f"R@100={scincl_m['recall@100']:.4f}  ({time.perf_counter()-t0:.0f}s)")

    # ==== Hybrid RRF (BM25 + BGE-base, equal weights) ====
    print("\n[4/6] Hybrid RRF (k=60)...")
    rrf_run = reciprocal_rank_fusion([bm25_run, bge_run], k=60, top_k=100)
    save_run(RUN_DIR / "test_hybrid_rrf.csv", rrf_run)
    rrf_m = evaluate_run(rrf_run, qrels)
    print(f"  nDCG@10={rrf_m['ndcg@10']:.4f} MAP@10={rrf_m.get('map@10', 0):.4f}  "
          f"R@100={rrf_m['recall@100']:.4f}")

    # ==== SciNCL Hybrid RRF (for old pipeline comparison) ====
    rrf_scincl_run = reciprocal_rank_fusion([bm25_run, scincl_run], k=60, top_k=100)
    save_run(RUN_DIR / "test_hybrid_scincl.csv", rrf_scincl_run)
    rrf_scincl_m = evaluate_run(rrf_scincl_run, qrels)
    print(f"  SciNCL RRF nDCG@10={rrf_scincl_m['ndcg@10']:.4f}")

    # ==== Adaptive RRF ====
    print("\n[5/6] Adaptive RRF...")
    idf_vocab = _build_idf_vocab(documents)
    print(f"  IDF vocab: {len(idf_vocab)} terms")
    arf_run = adaptive_rrf_fuse(bm25_run, bge_run, queries, idf_vocab)
    save_run(RUN_DIR / "test_hybrid_arf.csv", arf_run)
    arf_m = evaluate_run(arf_run, qrels)
    print(f"  nDCG@10={arf_m['ndcg@10']:.4f} MAP@10={arf_m.get('map@10', 0):.4f}  "
          f"R@100={arf_m['recall@100']:.4f}")

    # ==== CE Rerank ====
    print("\n[6/6] Cross-encoder reranking...")
    reranker = CrossEncoderReranker("cross-encoder/ms-marco-MiniLM-L-6-v2")
    ce_arf_run: dict = {}
    ce_scincl_run: dict = {}
    t0 = time.perf_counter()
    for i, q in enumerate(queries, 1):
        ce_arf_run[q.query_id] = reranker.rerank(q, doc_lookup, arf_run.get(q.query_id, []), 20)
        ce_scincl_run[q.query_id] = reranker.rerank(q, doc_lookup, rrf_scincl_run.get(q.query_id, []), 20)
        if i % 200 == 0:
            print(f"  Reranked {i}/{len(queries)} queries...")
    elapsed = time.perf_counter() - t0

    save_run(RUN_DIR / "test_always_rerank_arf.csv", ce_arf_run)
    save_run(RUN_DIR / "test_always_rerank_scincl.csv", ce_scincl_run)
    ce_arf_m = evaluate_run(ce_arf_run, qrels)
    ce_scincl_m = evaluate_run(ce_scincl_run, qrels)
    print(f"  CE on ARF:    nDCG@10={ce_arf_m['ndcg@10']:.4f}  "
          f"R@100={ce_arf_m['recall@100']:.4f}  ({elapsed/len(queries)*1000:.0f}ms/q)")
    print(f"  CE on SciNCL: nDCG@10={ce_scincl_m['ndcg@10']:.4f}")

    # ==== Summary ====
    print("\n" + "=" * 60)
    print("SCIDOCS RESULTS")
    print("=" * 60)
    print(f"  {'Method':<20} {'nDCG@10':>8} {'MAP@10':>8} {'R@10':>8} {'R@100':>8}")
    print(f"  {'-'*20} {'-'*8} {'-'*8} {'-'*8} {'-'*8}")
    for name, m in [("BM25", bm25_m), ("SciNCL", scincl_m), ("BGE-base", bge_m),
                     ("Hybrid RRF", rrf_m), ("Adaptive RRF", arf_m),
                     ("CE on ARF", ce_arf_m), ("CE on SciNCL RRF", ce_scincl_m)]:
        print(f"  {name:<20} {m['ndcg@10']:>8.4f} {m.get('map@10', 0):>8.4f} "
              f"{m['recall@10']:>8.4f} {m['recall@100']:>8.4f}")

    print(f"\n  BGE-base vs SciNCL: +{bge_m['ndcg@10']-scincl_m['ndcg@10']:.4f}")
    print(f"  Adaptive RRF vs BGE-base: {arf_m['ndcg@10']-bge_m['ndcg@10']:+.4f}")
    print(f"  CE on ARF vs ARF: {ce_arf_m['ndcg@10']-arf_m['ndcg@10']:+.4f}")
    print(f"\n  All outputs in {RUN_DIR}/")


if __name__ == "__main__":
    main()
