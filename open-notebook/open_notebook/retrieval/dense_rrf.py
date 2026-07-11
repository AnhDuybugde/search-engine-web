import os
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import torch
import torch.nn.functional as F
from loguru import logger
from transformers import AutoModel, AutoTokenizer

from open_notebook.retrieval.bm25 import BM25Retriever
from open_notebook.retrieval.contracts import Chunk, RankedChunk


class DenseRrfRetriever:
    _model = None
    _tokenizer = None
    _load_failed = False

    def __init__(
        self,
        model_path: Optional[str] = None,
        device: str = "cpu",
        rrf_k: int = 60,
        batch_size: int = 16,
    ):
        self.model_path = model_path or self._default_model_path()
        self.device = "cuda" if device == "cuda" and torch.cuda.is_available() else "cpu"
        self.rrf_k = rrf_k
        self.batch_size = batch_size
        self.bm25_retriever = BM25Retriever()

    @staticmethod
    def _default_model_path() -> str:
        env_path = os.getenv("OUR_METHOD_MODEL_PATH")
        if env_path:
            return env_path

        current = Path(__file__).resolve()
        candidates = [
            Path("/app/models/bge-small-scifact-rrf"),
            current.parents[3] / "bge-small-scifact-rrf" / "bge-small-scifact-rrf",
            current.parents[4] / "bge-small-scifact-rrf" / "bge-small-scifact-rrf",
        ]
        for candidate in candidates:
            if candidate.exists():
                return str(candidate)
        return str(candidates[0])

    def _load_model(self) -> bool:
        if DenseRrfRetriever._load_failed:
            return False

        if DenseRrfRetriever._model is None:
            try:
                logger.info(f"Loading our-method retriever model from {self.model_path} on {self.device}")
                DenseRrfRetriever._tokenizer = AutoTokenizer.from_pretrained(
                    self.model_path,
                    local_files_only=True,
                )
                DenseRrfRetriever._model = AutoModel.from_pretrained(
                    self.model_path,
                    local_files_only=True,
                ).to(self.device)
                DenseRrfRetriever._model.eval()
            except Exception as e:
                logger.error(f"Failed to load our-method retriever model: {e}")
                logger.warning("Falling back to BM25 retrieval.")
                DenseRrfRetriever._load_failed = True
                return False
        return True

    def _encode(self, texts: List[str]) -> torch.Tensor:
        embeddings = []
        tokenizer = DenseRrfRetriever._tokenizer
        model = DenseRrfRetriever._model
        if tokenizer is None or model is None:
            raise RuntimeError("our-method model is not loaded")

        with torch.no_grad():
            for start in range(0, len(texts), self.batch_size):
                batch = texts[start : start + self.batch_size]
                inputs = tokenizer(
                    batch,
                    padding=True,
                    truncation=True,
                    max_length=512,
                    return_tensors="pt",
                ).to(self.device)
                output = model(**inputs)
                cls_embeddings = output.last_hidden_state[:, 0]
                embeddings.append(F.normalize(cls_embeddings, p=2, dim=1).cpu())

        return torch.cat(embeddings, dim=0)

    def _dense_rank(self, query: str, chunks: List[Chunk]) -> List[Tuple[int, float]]:
        texts = [chunk.text for chunk in chunks]
        query_embedding = self._encode([query])
        doc_embeddings = self._encode(texts)
        scores = torch.matmul(doc_embeddings, query_embedding[0]).tolist()
        return sorted(enumerate(scores), key=lambda item: item[1], reverse=True)

    def retrieve(self, query: str, chunks: List[Chunk], top_k: int = 40) -> List[RankedChunk]:
        if not chunks:
            return []

        bm25_results = self.bm25_retriever.retrieve(query, chunks, top_k=len(chunks))
        if not self._load_model():
            return bm25_results[:top_k]

        try:
            dense_ranked = self._dense_rank(query, chunks)
        except Exception as e:
            logger.error(f"Error during our-method dense retrieval: {e}")
            logger.warning("Falling back to BM25 retrieval.")
            return bm25_results[:top_k]

        chunk_by_id: Dict[str, RankedChunk] = {rc.chunk.chunk_id: rc for rc in bm25_results}

        for dense_rank, (chunk_index, dense_score) in enumerate(dense_ranked, start=1):
            chunk = chunks[chunk_index]
            rc = chunk_by_id.get(chunk.chunk_id)
            if rc is None:
                rc = RankedChunk(chunk=chunk)
                chunk_by_id[chunk.chunk_id] = rc
            rc.dense_score = float(dense_score)
            rc.dense_rank = dense_rank

        for rc in chunk_by_id.values():
            score = 0.0
            if rc.bm25_rank:
                score += 1.0 / (self.rrf_k + rc.bm25_rank)
            if rc.dense_rank:
                score += 1.0 / (self.rrf_k + rc.dense_rank)
            rc.rrf_score = score

        reranked = sorted(chunk_by_id.values(), key=lambda rc: rc.rrf_score, reverse=True)
        for rank, rc in enumerate(reranked, start=1):
            rc.rrf_rank = rank
        return reranked[:top_k]
