from __future__ import annotations

from dataclasses import dataclass

from seg_retrieval.fusion import top_doc_overlap
from seg_retrieval.router import RouterPrediction
from seg_retrieval.types import Run


@dataclass(frozen=True)
class UncertaintyDecision:
    should_rerank: bool
    reasons: tuple[str, ...]
    signals: dict[str, float]


def score_gap(hits: list[tuple[str, float]]) -> float:
    if len(hits) < 2:
        return 1.0
    return abs(hits[0][1] - hits[1][1])


def decide_uncertainty(
    query_id: str,
    prediction: RouterPrediction,
    selected_run: Run,
    bm25_run: Run,
    dense_run: Run,
    router_confidence_threshold: float,
    score_gap_threshold: float,
    disagreement_threshold: float,
) -> UncertaintyDecision:
    reasons: list[str] = []
    selected_hits = selected_run.get(query_id, [])
    gap = score_gap(selected_hits)
    overlap = top_doc_overlap(bm25_run.get(query_id, []), dense_run.get(query_id, []), k=10)
    disagreement = 1.0 - overlap

    if prediction.confidence < router_confidence_threshold:
        reasons.append("low_router_confidence")
    if gap < score_gap_threshold:
        reasons.append("small_score_gap")
    if disagreement > disagreement_threshold:
        reasons.append("retriever_disagreement")

    return UncertaintyDecision(
        should_rerank=bool(reasons),
        reasons=tuple(reasons),
        signals={
            "router_confidence": prediction.confidence,
            "score_gap": gap,
            "retriever_disagreement": disagreement,
        },
    )
