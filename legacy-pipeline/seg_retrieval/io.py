from __future__ import annotations

import json
from pathlib import Path

import pandas as pd

from seg_retrieval.types import Document, Qrels, Query, Run


def read_jsonl(path: str | Path) -> list[dict]:
    with Path(path).open("r", encoding="utf-8") as file:
        return [json.loads(line) for line in file if line.strip()]


def write_jsonl(path: str | Path, rows: list[dict]) -> None:
    output = Path(path)
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("w", encoding="utf-8") as file:
        for row in rows:
            file.write(json.dumps(row, ensure_ascii=False) + "\n")


def save_run(path: str | Path, run: Run) -> None:
    rows = [
        {"query_id": query_id, "doc_id": doc_id, "rank": rank, "score": score}
        for query_id, hits in run.items()
        for rank, (doc_id, score) in enumerate(hits, start=1)
    ]
    pd.DataFrame(rows).to_csv(path, index=False)


def load_run(path: str | Path) -> Run:
    df = pd.read_csv(path)
    run: Run = {}
    for query_id, group in df.sort_values(["query_id", "rank"]).groupby("query_id"):
        run[str(query_id)] = [(str(row.doc_id), float(row.score)) for row in group.itertuples()]
    return run


def save_documents(path: str | Path, documents: list[Document]) -> None:
    write_jsonl(path, [doc.__dict__ for doc in documents])


def load_documents(path: str | Path) -> list[Document]:
    return [Document(**row) for row in read_jsonl(path)]


def save_queries(path: str | Path, queries: list[Query]) -> None:
    write_jsonl(path, [query.__dict__ for query in queries])


def load_queries(path: str | Path) -> list[Query]:
    return [Query(**row) for row in read_jsonl(path)]


def save_qrels(path: str | Path, qrels: Qrels) -> None:
    rows = [
        {"query_id": query_id, "doc_id": doc_id, "relevance": relevance}
        for query_id, labels in qrels.items()
        for doc_id, relevance in labels.items()
    ]
    pd.DataFrame(rows).to_csv(path, index=False)


def load_qrels(path: str | Path) -> Qrels:
    df = pd.read_csv(path)
    qrels: Qrels = {}
    for row in df.itertuples():
        qrels.setdefault(str(row.query_id), {})[str(row.doc_id)] = int(row.relevance)
    return qrels
