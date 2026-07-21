from __future__ import annotations

from dataclasses import dataclass

from seg_retrieval.types import Document, Query, Run


def _detect_device() -> str:
    """Detect available device for inference."""
    try:
        import torch
        if torch.cuda.is_available():
            return "cuda"
    except ImportError:
        pass
    return "cpu"


@dataclass
class CrossEncoderReranker:
    model_name: str
    device: str = None  # Auto-detect if None

    def __post_init__(self) -> None:
        if self.device is None:
            self.device = _detect_device()
        
        from sentence_transformers import CrossEncoder

        self.model = CrossEncoder(self.model_name, device=self.device)

    def rerank(
        self,
        query: Query,
        documents: dict[str, Document],
        hits: list[tuple[str, float]],
        top_k: int = 20,
    ) -> list[tuple[str, float]]:
        candidates = hits[:top_k]
        pairs = [(query.text, documents[doc_id].text) for doc_id, _ in candidates if doc_id in documents]
        doc_ids = [doc_id for doc_id, _ in candidates if doc_id in documents]
        scores = self.model.predict(pairs)
        reranked = sorted(zip(doc_ids, map(float, scores)), key=lambda item: item[1], reverse=True)
        untouched = [hit for hit in hits if hit[0] not in set(doc_ids)]
        return reranked + untouched


def apply_reranked_hits(run: Run, query_id: str, hits: list[tuple[str, float]]) -> Run:
    updated = dict(run)
    updated[query_id] = hits
    return updated
