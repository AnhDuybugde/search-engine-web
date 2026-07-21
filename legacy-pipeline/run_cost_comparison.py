"""Computational cost comparison of retrieval pipelines.

Measures for each pipeline stage:
  - Setup Time (s): one-time initialization (index build, model load, doc encode)
  - Avg Retrieval Latency (ms/query): per-query online serving time
  - CPU Usage (%): average CPU utilization during retrieval
  - GPU Usage (%): average GPU utilization during retrieval
  - n_queries: number of queries processed

Pipelines evaluated:
  - BM25 (lexical)
  - Dense / SciNCL (neural)
  - Hybrid RRF (BM25 + Dense + fusion)
  - Cross-Encoder rerank (top-20)
  - Always-Rerank (Hybrid + CE, all queries)
  - CRC Selective Rerank (Hybrid + CE, selected queries only)

Outputs:
  - runs/scifact/test_cost_comparison.json
  - reports/tables/table_cost_comparison.md
  - reports/tables/table_cost_comparison.csv

Usage:
  python scripts/run_cost_comparison.py
"""
from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

import _bootstrap  # noqa: F401

import numpy as np
import pandas as pd
import psutil

from seg_retrieval.config import load_config
from seg_retrieval.fusion import reciprocal_rank_fusion
from seg_retrieval.io import load_documents, load_queries, load_run
from seg_retrieval.rerank import CrossEncoderReranker
from seg_retrieval.retrievers import BM25Retriever, DenseRetriever


# ---------------------------------------------------------------------------
# GPU monitoring utilities
# ---------------------------------------------------------------------------

def get_gpu_usage() -> float:
    """Get current GPU utilization %. Returns 0.0 if no GPU or pynvml unavailable."""
    try:
        import pynvml
        pynvml.nvmlInit()
        handle = pynvml.nvmlDeviceGetHandleByIndex(0)
        util = pynvml.nvmlDeviceGetUtilizationRates(handle)
        return float(util.gpu)
    except Exception:
        pass
    # Fallback: try torch
    try:
        import torch
        if torch.cuda.is_available():
            # No direct util API in torch, return -1 to indicate "used but unknown %"
            return -1.0
    except Exception:
        pass
    return 0.0


def measure_stage(func, queries, warmup=10, label="stage"):
    """Run func(query) for all queries, measuring latency + CPU/GPU usage.

    Returns dict with: latency_ms_per_query, cpu_pct, gpu_pct, n_queries
    """
    # Warm-up
    for q in queries[:warmup]:
        func(q)

    cpu_samples = []
    gpu_samples = []
    times_ms = []

    for q in queries:
        cpu_before = psutil.cpu_percent(interval=None)
        gpu_before = get_gpu_usage()

        t = time.perf_counter()
        func(q)
        elapsed_ms = (time.perf_counter() - t) * 1000.0

        cpu_after = psutil.cpu_percent(interval=None)
        gpu_after = get_gpu_usage()

        times_ms.append(elapsed_ms)
        cpu_samples.append((cpu_before + cpu_after) / 2)
        if gpu_before >= 0 and gpu_after >= 0:
            gpu_samples.append((gpu_before + gpu_after) / 2)

    return {
        "latency_ms_per_query": float(np.mean(times_ms)),
        "latency_std_ms": float(np.std(times_ms)),
        "cpu_pct": float(np.mean(cpu_samples)) if cpu_samples else 0.0,
        "gpu_pct": float(np.mean(gpu_samples)) if gpu_samples else 0.0,
        "n_queries": len(queries),
    }


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Computational cost comparison of retrieval pipelines."
    )
    parser.add_argument("--config", default="configs/scifact.yaml")
    parser.add_argument("--split", default="test")
    parser.add_argument("--alpha", type=float, default=0.02)
    parser.add_argument("--warmup", type=int, default=10)
    args = parser.parse_args()

    config = load_config(args.config)
    run_dir = Path(config.outputs.run_dir)
    data_dir = Path(config.dataset.data_dir)
    reports = Path("reports") / "tables"
    reports.mkdir(parents=True, exist_ok=True)

    documents = load_documents(data_dir / f"{args.split}_documents.jsonl")
    queries = load_queries(data_dir / f"{args.split}_queries.jsonl")
    doc_map = {doc.doc_id: doc for doc in documents}
    top_k = config.retrieval.top_k

    print("=" * 70)
    print("  COMPUTATIONAL COST COMPARISON")
    print(f"  {len(queries)} queries, {len(documents)} documents")
    print("=" * 70)

    # Initialize psutil CPU measurement
    psutil.cpu_percent(interval=None)

    rows = []  # For final table

    # ------------------------------------------------------------------
    # 1. BM25
    # ------------------------------------------------------------------
    print("\n[1/6] BM25 (lexical)...")
    t0 = time.perf_counter()
    bm25 = BM25Retriever(documents)
    bm25_setup_s = time.perf_counter() - t0

    stats = measure_stage(
        lambda q: bm25.search([q], top_k=top_k), queries, args.warmup, "BM25"
    )
    rows.append({
        "Pipeline": "BM25 (lexical)",
        "Setup Time (s)": round(bm25_setup_s, 2),
        "Avg Latency (ms/query)": round(stats["latency_ms_per_query"], 2),
        "CPU Usage (%)": round(stats["cpu_pct"], 1),
        "GPU Usage (%)": round(stats["gpu_pct"], 1),
        "n_queries": stats["n_queries"],
    })
    print(f"  Setup: {bm25_setup_s:.2f}s | Latency: {stats['latency_ms_per_query']:.2f} ms/q")

    # ------------------------------------------------------------------
    # 2. Dense (SciNCL)
    # ------------------------------------------------------------------
    print("\n[2/6] Dense / SciNCL (neural)...")
    t0 = time.perf_counter()
    dense = DenseRetriever(
        documents, model_name=config.retrieval.dense_model,
        batch_size=config.retrieval.dense_batch_size,
    )
    dense_setup_s = time.perf_counter() - t0
    device = str(getattr(dense.model, "device", "unknown"))

    stats = measure_stage(
        lambda q: dense.search([q], top_k=top_k), queries, args.warmup, "Dense"
    )
    rows.append({
        "Pipeline": f"Dense / SciNCL ({device})",
        "Setup Time (s)": round(dense_setup_s, 2),
        "Avg Latency (ms/query)": round(stats["latency_ms_per_query"], 2),
        "CPU Usage (%)": round(stats["cpu_pct"], 1),
        "GPU Usage (%)": round(stats["gpu_pct"], 1),
        "n_queries": stats["n_queries"],
    })
    print(f"  Setup: {dense_setup_s:.2f}s | Latency: {stats['latency_ms_per_query']:.2f} ms/q | Device: {device}")


    # ------------------------------------------------------------------
    # 3. Hybrid RRF (BM25 + Dense + fusion)
    # ------------------------------------------------------------------
    print("\n[3/6] Hybrid RRF (BM25 + Dense + fusion)...")

    def hybrid_one(q):
        b = bm25.search([q], top_k=top_k)
        d = dense.search([q], top_k=top_k)
        reciprocal_rank_fusion([b, d], k=config.retrieval.rrf_k, top_k=top_k)

    hybrid_setup_s = bm25_setup_s + dense_setup_s  # combined setup
    stats = measure_stage(hybrid_one, queries, args.warmup, "Hybrid")
    rows.append({
        "Pipeline": "Hybrid RRF (BM25+Dense)",
        "Setup Time (s)": round(hybrid_setup_s, 2),
        "Avg Latency (ms/query)": round(stats["latency_ms_per_query"], 2),
        "CPU Usage (%)": round(stats["cpu_pct"], 1),
        "GPU Usage (%)": round(stats["gpu_pct"], 1),
        "n_queries": stats["n_queries"],
    })
    hybrid_latency = stats["latency_ms_per_query"]
    print(f"  Setup: {hybrid_setup_s:.2f}s | Latency: {hybrid_latency:.2f} ms/q")

    # ------------------------------------------------------------------
    # 4. Cross-Encoder rerank only (top-20)
    # ------------------------------------------------------------------
    print("\n[4/6] Cross-Encoder rerank (top-20)...")
    t0 = time.perf_counter()
    reranker = CrossEncoderReranker(config.rerank.model)
    ce_setup_s = time.perf_counter() - t0
    hybrid_run = load_run(run_dir / f"{args.split}_hybrid.csv")

    stats = measure_stage(
        lambda q: reranker.rerank(q, doc_map, hybrid_run.get(q.query_id, []), top_k=config.rerank.top_k),
        queries, args.warmup, "CE",
    )
    ce_latency = stats["latency_ms_per_query"]
    rows.append({
        "Pipeline": "CE rerank only (top-20)",
        "Setup Time (s)": round(ce_setup_s, 2),
        "Avg Latency (ms/query)": round(ce_latency, 2),
        "CPU Usage (%)": round(stats["cpu_pct"], 1),
        "GPU Usage (%)": round(stats["gpu_pct"], 1),
        "n_queries": stats["n_queries"],
    })
    print(f"  Setup: {ce_setup_s:.2f}s | Latency: {ce_latency:.2f} ms/q")

    # ------------------------------------------------------------------
    # 5. Always-Rerank (Hybrid + CE, all queries)
    # ------------------------------------------------------------------
    print("\n[5/6] Always-Rerank (Hybrid + CE)...")
    always_latency = hybrid_latency + ce_latency
    always_setup = hybrid_setup_s + ce_setup_s
    rows.append({
        "Pipeline": "Always-Rerank (Hybrid+CE)",
        "Setup Time (s)": round(always_setup, 2),
        "Avg Latency (ms/query)": round(always_latency, 2),
        "CPU Usage (%)": round((rows[2]["CPU Usage (%)"] + rows[3]["CPU Usage (%)"]) / 2, 1),
        "GPU Usage (%)": round((rows[2]["GPU Usage (%)"] + rows[3]["GPU Usage (%)"]) / 2, 1),
        "n_queries": len(queries),
    })
    print(f"  Total: {always_latency:.2f} ms/q (hybrid {hybrid_latency:.2f} + CE {ce_latency:.2f})")

    # ------------------------------------------------------------------
    # 6. CRC Selective Rerank
    # ------------------------------------------------------------------
    print(f"\n[6/6] CRC Selective Rerank (α={args.alpha})...")

    # Calibrate threshold from train set
    train_feats = pd.read_csv(run_dir / "train_qpp_features.csv")
    train_feats["query_id"] = train_feats["query_id"].astype(str)
    train_ids = train_feats["query_id"].tolist()
    signal_train = dict(zip(train_feats["query_id"], train_feats["hybrid_max"]))
    loss_train = {
        q: max(0.0, r - b)
        for q, b, r in zip(train_feats["query_id"], train_feats["base_ndcg"], train_feats["rerank_ndcg"])
    }
    n = len(train_ids)
    candidates = [float("-inf")] + sorted({signal_train[q] for q in train_ids})
    lam = candidates[-1]
    for c in candidates:
        skipped = [q for q in train_ids if signal_train[q] > c]
        rhat = sum(loss_train[q] for q in skipped) / n
        if (n * rhat + 1.0) / (n + 1) <= args.alpha:
            lam = c
            break

    test_feats = pd.read_csv(run_dir / f"{args.split}_qpp_features.csv")
    test_feats["query_id"] = test_feats["query_id"].astype(str)
    signal_test = dict(zip(test_feats["query_id"], test_feats["hybrid_max"]))

    # Measure selective reranking
    def selective_one(q):
        if signal_test.get(q.query_id, 0) <= lam:
            reranker.rerank(q, doc_map, hybrid_run.get(q.query_id, []), top_k=config.rerank.top_k)

    stats = measure_stage(selective_one, queries, args.warmup, "CRC")
    rerank_count = sum(1 for q in queries if signal_test.get(q.query_id, 0) <= lam)
    coverage = rerank_count / len(queries)
    selective_total = hybrid_latency + stats["latency_ms_per_query"]
    saving_pct = (1 - selective_total / always_latency) * 100

    rows.append({
        "Pipeline": f"CRC Selective (α={args.alpha})",
        "Setup Time (s)": round(always_setup, 2),
        "Avg Latency (ms/query)": round(selective_total, 2),
        "CPU Usage (%)": round(stats["cpu_pct"], 1),
        "GPU Usage (%)": round(stats["gpu_pct"], 1),
        "n_queries": len(queries),
    })
    print(f"  Coverage: {coverage:.1%} | Total: {selective_total:.2f} ms/q | Save: {saving_pct:.1f}%")


    # ------------------------------------------------------------------
    # Output
    # ------------------------------------------------------------------
    table = pd.DataFrame(rows)
    print("\n" + "=" * 70)
    print("  RESULTS")
    print("=" * 70)
    print(table.to_string(index=False))

    # Save CSV
    csv_path = reports / "table_cost_comparison.csv"
    table.to_csv(csv_path, index=False)

    # Save JSON (detailed)
    json_data = {
        "split": args.split,
        "n_queries": len(queries),
        "n_documents": len(documents),
        "device": device,
        "alpha": args.alpha,
        "crc_lambda": lam,
        "crc_coverage": coverage,
        "crc_saving_pct": saving_pct,
        "pipelines": rows,
    }

    # Save Markdown
    md_lines = [
        "# Computational Cost Comparison",
        "",
        f"SciFact {args.split}: {len(queries)} queries, {len(documents)} docs. "
        f"Device: {device}. Warm-up: {args.warmup} queries.",
        "",
        "## Measured (current setup)",
        "",
        "| Pipeline | Setup Time (s) | Avg Latency (ms/query) | CPU (%) | GPU (%) | n_queries |",
        "|----------|---------------|----------------------|---------|---------|-----------|",
    ]
    for r in rows:
        md_lines.append(
            f"| {r['Pipeline']} | {r['Setup Time (s)']} | {r['Avg Latency (ms/query)']} | "
            f"{r['CPU Usage (%)']} | {r['GPU Usage (%)']} | {r['n_queries']} |"
        )
    md_lines.extend([
        "",
        f"**CRC Selective** reranks only {coverage:.0%} of queries, "
        f"saving **{saving_pct:.1f}%** latency vs Always-Rerank.",
    ])

    # ------------------------------------------------------------------
    # 7. Projected cost with optimized BM25 (Lucene/Elasticsearch)
    # ------------------------------------------------------------------
    print(f"\n[7/7] Projected costs with optimized BM25 (Lucene ~2ms)...")

    LUCENE_BM25_MS = 2.0
    RRF_FUSION_MS = 1.0
    dense_ms = rows[1]["Avg Latency (ms/query)"]
    ce_ms = rows[3]["Avg Latency (ms/query)"]

    proj_hybrid = LUCENE_BM25_MS + dense_ms + RRF_FUSION_MS
    proj_always = proj_hybrid + ce_ms
    proj_selective_ce = coverage * ce_ms
    proj_selective = proj_hybrid + proj_selective_ce
    proj_saving_pct = (1 - proj_selective / proj_always) * 100

    proj_rows = [
        {"Pipeline": "BM25 (Lucene/ES)", "Avg Latency (ms/query)": round(LUCENE_BM25_MS, 2), "Notes": "estimated"},
        {"Pipeline": "Dense / SciNCL (GPU)", "Avg Latency (ms/query)": round(dense_ms, 2), "Notes": "measured"},
        {"Pipeline": "Hybrid RRF (Lucene+Dense+fuse)", "Avg Latency (ms/query)": round(proj_hybrid, 2), "Notes": "projected"},
        {"Pipeline": "CE rerank (top-20)", "Avg Latency (ms/query)": round(ce_ms, 2), "Notes": "measured"},
        {"Pipeline": "Always-Rerank (projected)", "Avg Latency (ms/query)": round(proj_always, 2), "Notes": "hybrid + CE all"},
        {"Pipeline": f"CRC Selective α={args.alpha} (projected)", "Avg Latency (ms/query)": round(proj_selective, 2), "Notes": f"{coverage:.0%} CE, save {proj_saving_pct:.1f}%"},
    ]

    proj_table = pd.DataFrame(proj_rows)
    print("\n  --- Projected with Lucene BM25 ---")
    print(proj_table.to_string(index=False))
    print(f"\n  CRC saves {proj_saving_pct:.1f}% total latency with optimized BM25")

    # Append projected to JSON
    json_data["projected_lucene"] = {
        "bm25_ms": LUCENE_BM25_MS,
        "dense_ms": dense_ms,
        "hybrid_ms": proj_hybrid,
        "ce_ms": ce_ms,
        "always_rerank_ms": proj_always,
        "crc_selective_ms": proj_selective,
        "saving_pct": proj_saving_pct,
        "coverage": coverage,
    }

    # Append projected to markdown
    md_lines.extend([
        "",
        "## Projected with Optimized BM25 (Lucene/Elasticsearch)",
        "",
        f"If BM25 uses Lucene (~{LUCENE_BM25_MS}ms) instead of Python rank_bm25 (~{rows[0]['Avg Latency (ms/query)']}ms):",
        "",
        "| Pipeline | Avg Latency (ms/query) | Notes |",
        "|----------|----------------------|-------|",
    ])
    for r in proj_rows:
        md_lines.append(f"| {r['Pipeline']} | {r['Avg Latency (ms/query)']} | {r['Notes']} |")
    md_lines.extend([
        "",
        f"**CRC Selective saves {proj_saving_pct:.1f}% total latency** when BM25 is not the bottleneck.",
        f"CE dominates ({ce_ms:.1f}ms out of {proj_always:.1f}ms = {ce_ms/proj_always*100:.0f}% of pipeline),",
        f"so skipping {1-coverage:.0%} CE calls yields substantial wall-clock savings.",
    ])

    # Write files
    json_path = run_dir / f"{args.split}_cost_comparison.json"
    json_path.write_text(json.dumps(json_data, indent=2), encoding="utf-8")
    md_path = reports / "table_cost_comparison.md"
    md_path.write_text("\n".join(md_lines) + "\n", encoding="utf-8")

    print(f"\n  Saved: {csv_path}")
    print(f"  Saved: {json_path}")
    print(f"  Saved: {md_path}")


if __name__ == "__main__":
    main()
