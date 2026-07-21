from __future__ import annotations

import pandas as pd

from seg_retrieval.metrics import per_query_ndcg
from seg_retrieval.types import Qrels, Run


def create_oracle_labels(
    runs: dict[str, Run],
    qrels: Qrels,
    tie_break_order: tuple[str, ...] = ("bm25", "dense", "hybrid"),
    metric_k: int = 10,
) -> pd.DataFrame:
    per_method = {name: per_query_ndcg(run, qrels, metric_k) for name, run in runs.items()}
    rows: list[dict] = []
    for query_id in qrels:
        best_label = tie_break_order[0]
        best_score = -1.0
        for label in tie_break_order:
            score = per_method[label].get(query_id, 0.0)
            if score > best_score:
                best_label = label
                best_score = score
        row = {"query_id": query_id, "oracle_label": best_label, f"best_ndcg@{metric_k}": best_score}
        row.update({f"{name}_ndcg@{metric_k}": scores.get(query_id, 0.0) for name, scores in per_method.items()})
        rows.append(row)
    return pd.DataFrame(rows)
