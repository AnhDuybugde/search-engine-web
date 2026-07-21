from __future__ import annotations

import math

from seg_retrieval.types import Qrels, Run


def dcg(relevances: list[int]) -> float:
    return sum((2**rel - 1) / math.log2(rank + 1) for rank, rel in enumerate(relevances, start=1))


def ndcg_at_k(run: Run, qrels: Qrels, k: int = 10) -> float:
    scores: list[float] = []
    for query_id, labels in qrels.items():
        hits = run.get(query_id, [])[:k]
        gains = [labels.get(doc_id, 0) for doc_id, _ in hits]
        ideal = sorted(labels.values(), reverse=True)[:k]
        ideal_dcg = dcg(ideal)
        scores.append(0.0 if ideal_dcg == 0 else dcg(gains) / ideal_dcg)
    return sum(scores) / len(scores) if scores else 0.0


def recall_at_k(run: Run, qrels: Qrels, k: int = 10) -> float:
    scores: list[float] = []
    for query_id, labels in qrels.items():
        relevant = {doc_id for doc_id, rel in labels.items() if rel > 0}
        if not relevant:
            continue
        retrieved = {doc_id for doc_id, _ in run.get(query_id, [])[:k]}
        scores.append(len(relevant & retrieved) / len(relevant))
    return sum(scores) / len(scores) if scores else 0.0


def mrr_at_k(run: Run, qrels: Qrels, k: int = 10) -> float:
    scores: list[float] = []
    for query_id, labels in qrels.items():
        reciprocal_rank = 0.0
        for rank, (doc_id, _) in enumerate(run.get(query_id, [])[:k], start=1):
            if labels.get(doc_id, 0) > 0:
                reciprocal_rank = 1.0 / rank
                break
        scores.append(reciprocal_rank)
    return sum(scores) / len(scores) if scores else 0.0


def evaluate_run(run: Run, qrels: Qrels, *, include_map: bool = False) -> dict[str, float]:
    metrics = {
        "ndcg@10": ndcg_at_k(run, qrels, 10),
        "recall@10": recall_at_k(run, qrels, 10),
        "recall@100": recall_at_k(run, qrels, 100),
        "mrr@10": mrr_at_k(run, qrels, 10),
    }
    if include_map:
        map_scores = list(per_query_map(run, qrels, 10).values())
        metrics["map@10"] = sum(map_scores) / len(map_scores) if map_scores else 0.0
    return metrics


def per_query_ndcg(run: Run, qrels: Qrels, k: int = 10) -> dict[str, float]:
    return {
        query_id: ndcg_at_k({query_id: run.get(query_id, [])}, {query_id: labels}, k)
        for query_id, labels in qrels.items()
    }


def per_query_map(run: Run, qrels: Qrels, k: int = 10) -> dict[str, float]:
    """Per-query MAP@k (binary relevance)."""
    result: dict[str, float] = {}
    for query_id, labels in qrels.items():
        hits = run.get(query_id, [])[:k]
        R = sum(1 for rel in labels.values() if rel > 0)
        if R == 0:
            result[query_id] = 0.0
            continue
        num_rel = 0
        sum_prec = 0.0
        for rank, (doc_id, _) in enumerate(hits, start=1):
            if labels.get(doc_id, 0) > 0:
                num_rel += 1
                sum_prec += num_rel / rank
        result[query_id] = sum_prec / min(R, k)
    return result
