from __future__ import annotations

from collections import defaultdict

from seg_retrieval.types import Run


def reciprocal_rank_fusion(runs: list[Run], k: int = 60, top_k: int = 100) -> Run:
    query_ids = set().union(*(run.keys() for run in runs))
    fused: Run = {}
    for query_id in query_ids:
        scores: dict[str, float] = defaultdict(float)
        for run in runs:
            for rank, (doc_id, _) in enumerate(run.get(query_id, []), start=1):
                scores[doc_id] += 1.0 / (k + rank)
        fused[query_id] = sorted(scores.items(), key=lambda item: item[1], reverse=True)[:top_k]
    return fused


def weighted_rrf(
    runs: list[Run],
    weights: list[float],
    k: int = 60,
    top_k: int = 100,
) -> Run:
    if len(runs) != len(weights):
        raise ValueError(f"Mismatched runs ({len(runs)}) and weights ({len(weights)})")
    query_ids = set().union(*(run.keys() for run in runs))
    fused: Run = {}
    for query_id in query_ids:
        scores: dict[str, float] = defaultdict(float)
        for run, w in zip(runs, weights):
            for rank, (doc_id, _) in enumerate(run.get(query_id, []), start=1):
                scores[doc_id] += w / (k + rank)
        fused[query_id] = sorted(scores.items(), key=lambda item: item[1], reverse=True)[:top_k]
    return fused


def top_doc_overlap(left: list[tuple[str, float]], right: list[tuple[str, float]], k: int = 10) -> float:
    left_ids = {doc_id for doc_id, _ in left[:k]}
    right_ids = {doc_id for doc_id, _ in right[:k]}
    if not left_ids and not right_ids:
        return 1.0
    return len(left_ids & right_ids) / len(left_ids | right_ids)
