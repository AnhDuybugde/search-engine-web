from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, f1_score
from sklearn.pipeline import Pipeline

from seg_retrieval.types import Query


@dataclass
class RouterPrediction:
    label: str
    confidence: float
    probabilities: dict[str, float]


class TfidfLogRegRouter:
    def __init__(self, labels: tuple[str, ...] = ("bm25", "dense", "hybrid")) -> None:
        self.labels = labels
        self.pipeline = Pipeline(
            [
                ("tfidf", TfidfVectorizer(ngram_range=(1, 2), min_df=1)),
                ("clf", LogisticRegression(max_iter=1000, class_weight="balanced")),
            ]
        )

    def fit(self, queries: list[Query], labels: pd.Series | list[str]) -> None:
        query_map = {query.query_id: query.text for query in queries}
        if isinstance(labels, pd.Series):
            y = labels.tolist()
            x = [query_map[str(query_id)] for query_id in labels.index]
        else:
            y = list(labels)
            x = [query.text for query in queries]
        self.pipeline.fit(x, y)

    def predict_one(self, text: str) -> RouterPrediction:
        label = str(self.pipeline.predict([text])[0])
        if hasattr(self.pipeline[-1], "predict_proba"):
            proba = self.pipeline.predict_proba([text])[0]
            classes = list(self.pipeline[-1].classes_)
            probabilities = {str(cls): float(score) for cls, score in zip(classes, proba)}
            confidence = max(probabilities.values())
        else:
            probabilities = {label: 1.0}
            confidence = 1.0
        return RouterPrediction(label=label, confidence=confidence, probabilities=probabilities)

    def predict(self, queries: list[Query]) -> list[RouterPrediction]:
        return [self.predict_one(query.text) for query in queries]


def evaluate_router(y_true: list[str], y_pred: list[str]) -> dict[str, float]:
    return {
        "accuracy": float(accuracy_score(y_true, y_pred)),
        "macro_f1": float(f1_score(y_true, y_pred, average="macro")),
    }
