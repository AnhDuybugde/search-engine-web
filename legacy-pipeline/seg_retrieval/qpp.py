"""Unsupervised post-retrieval query performance prediction (QPP) signals.

All predictors are computed from retrieval scores only (no relevance labels), so
they can be used at inference time to decide routing / reranking. References:
- Cronen-Townsend et al. (clarity), Zhou & Croft (WIG), Shtok et al. (NQC),
- Faggioli et al., ICTIR 2023 (QPP for neural IR).
"""
from __future__ import annotations

import math

Hits = list[tuple[str, float]]


def _scores(hits: Hits, k: int) -> list[float]:
    return [score for _, score in hits[:k]]


def corpus_mean(run: dict[str, Hits], k: int = 100) -> float:
    """Global mean score across all queries' top-k, used as the WIG/NQC baseline."""
    vals = [s for hits in run.values() for s in _scores(hits, k)]
    return sum(vals) / len(vals) if vals else 0.0


def wig(hits: Hits, mu_corpus: float, k: int = 10) -> float:
    """Weighted Information Gain: how far the top-k mean sits above the corpus mean."""
    s = _scores(hits, k)
    if not s:
        return 0.0
    return sum(s) / len(s) - mu_corpus


def nqc(hits: Hits, mu_corpus: float, k: int = 10) -> float:
    """Normalized Query Commitment: std of top-k scores normalized by corpus mean."""
    s = _scores(hits, k)
    if len(s) < 2:
        return 0.0
    mean = sum(s) / len(s)
    std = math.sqrt(sum((x - mean) ** 2 for x in s) / len(s))
    denom = abs(mu_corpus) if abs(mu_corpus) > 1e-9 else 1.0
    return std / denom


def std_topk(hits: Hits, k: int = 10) -> float:
    s = _scores(hits, k)
    if len(s) < 2:
        return 0.0
    mean = sum(s) / len(s)
    return math.sqrt(sum((x - mean) ** 2 for x in s) / len(s))


def max_score(hits: Hits) -> float:
    return hits[0][1] if hits else 0.0


def score_gap(hits: Hits) -> float:
    if len(hits) < 2:
        return 1.0
    return abs(hits[0][1] - hits[1][1])


def qpp_features(hits: Hits, mu_corpus: float, prefix: str, k: int = 10) -> dict[str, float]:
    return {
        f"{prefix}_wig": wig(hits, mu_corpus, k),
        f"{prefix}_nqc": nqc(hits, mu_corpus, k),
        f"{prefix}_std": std_topk(hits, k),
        f"{prefix}_max": max_score(hits),
        f"{prefix}_gap": score_gap(hits),
    }
