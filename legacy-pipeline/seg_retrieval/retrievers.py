from __future__ import annotations

import os
import re
from dataclasses import dataclass
from collections import Counter

import numpy as np

from seg_retrieval.types import Document, Query, Run


TOKEN_PATTERN = re.compile(r"[A-Za-z0-9_]+")

# Keep SentenceTransformers on the PyTorch path in environments that also have
# TensorFlow/Keras 3 installed. Transformers may otherwise import TF modules.
os.environ.setdefault("TRANSFORMERS_NO_TF", "1")
os.environ.setdefault("USE_TF", "0")


def tokenize(text: str) -> list[str]:
    return [token.lower() for token in TOKEN_PATTERN.findall(text)]


@dataclass
class BM25Retriever:
    documents: list[Document]

    def __post_init__(self) -> None:
        self.doc_ids = [doc.doc_id for doc in self.documents]
        self.tokenized_documents = [tokenize(doc.text) for doc in self.documents]
        try:
            from rank_bm25 import BM25Okapi

            self.index = BM25Okapi(self.tokenized_documents)
        except ImportError:
            self.index = None

    def search(self, queries: list[Query], top_k: int = 100) -> Run:
        run: Run = {}
        for query in queries:
            query_tokens = tokenize(query.text)
            if self.index is None:
                query_counts = Counter(query_tokens)
                scores = np.array(
                    [
                        sum(query_counts[token] * Counter(doc_tokens)[token] for token in query_counts)
                        for doc_tokens in self.tokenized_documents
                    ],
                    dtype=float,
                )
            else:
                scores = self.index.get_scores(query_tokens)
            order = np.argsort(scores)[::-1][:top_k]
            run[query.query_id] = [(self.doc_ids[index], float(scores[index])) for index in order]
        return run


@dataclass
class DenseRetriever:
    documents: list[Document]
    model_name: str
    batch_size: int = 32

    def __post_init__(self) -> None:
        from sentence_transformers import SentenceTransformer

        self.doc_ids = [doc.doc_id for doc in self.documents]
        self.model = SentenceTransformer(self.model_name)
        self.document_embeddings = self.model.encode(
            [doc.text for doc in self.documents],
            batch_size=self.batch_size,
            normalize_embeddings=True,
            show_progress_bar=True,
        )

    def search(self, queries: list[Query], top_k: int = 100) -> Run:
        query_embeddings = self.model.encode(
            [query.text for query in queries],
            batch_size=self.batch_size,
            normalize_embeddings=True,
            show_progress_bar=True,
        )
        scores = np.matmul(query_embeddings, self.document_embeddings.T)
        run: Run = {}
        for query, query_scores in zip(queries, scores):
            order = np.argsort(query_scores)[::-1][:top_k]
            run[query.query_id] = [(self.doc_ids[index], float(query_scores[index])) for index in order]
        return run
