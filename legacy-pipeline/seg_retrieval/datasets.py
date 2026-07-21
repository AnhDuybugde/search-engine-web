from __future__ import annotations

import csv
import json
import urllib.request
import zipfile
from pathlib import Path

from seg_retrieval.types import Document, Qrels, Query


def load_beir_split(data_dir: str | Path, split: str = "test") -> tuple[list[Document], list[Query], Qrels]:
    data_path = Path(data_dir)
    try:
        from beir.datasets.data_loader import GenericDataLoader

        corpus, queries, qrels = GenericDataLoader(str(data_path)).load(split=split)
        documents = [
            Document(
                doc_id=str(doc_id),
                title=str(payload.get("title", "") or ""),
                abstract=str(payload.get("text", "") or ""),
            )
            for doc_id, payload in corpus.items()
        ]
        query_rows = [Query(query_id=str(query_id), text=str(text)) for query_id, text in queries.items()]
        qrel_rows: Qrels = {
            str(query_id): {str(doc_id): int(score) for doc_id, score in labels.items()}
            for query_id, labels in qrels.items()
        }
        return documents, query_rows, qrel_rows
    except ModuleNotFoundError:
        return load_beir_split_direct(data_path, split=split)


def load_beir_split_direct(data_dir: str | Path, split: str = "test") -> tuple[list[Document], list[Query], Qrels]:
    data_path = Path(data_dir)
    corpus_path = data_path / "corpus.jsonl"
    queries_path = data_path / "queries.jsonl"
    qrels_path = data_path / "qrels" / f"{split}.tsv"
    missing = [path for path in (corpus_path, queries_path, qrels_path) if not path.exists()]
    if missing:
        missing_list = ", ".join(str(path) for path in missing)
        raise FileNotFoundError(f"Missing BEIR files: {missing_list}")

    documents: list[Document] = []
    with corpus_path.open("r", encoding="utf-8") as file:
        for line in file:
            if not line.strip():
                continue
            row = json.loads(line)
            documents.append(
                Document(
                    doc_id=str(row["_id"]),
                    title=str(row.get("title", "") or ""),
                    abstract=str(row.get("text", "") or ""),
                )
            )

    queries_by_id: dict[str, str] = {}
    with queries_path.open("r", encoding="utf-8") as file:
        for line in file:
            if not line.strip():
                continue
            row = json.loads(line)
            queries_by_id[str(row["_id"])] = str(row.get("text", "") or "")

    qrels: Qrels = {}
    with qrels_path.open("r", encoding="utf-8") as file:
        reader = csv.DictReader(file, delimiter="\t")
        for row in reader:
            query_id = str(row["query-id"])
            corpus_id = str(row["corpus-id"])
            qrels.setdefault(query_id, {})[corpus_id] = int(row["score"])

    queries = [Query(query_id=query_id, text=queries_by_id[query_id]) for query_id in qrels if query_id in queries_by_id]
    return documents, queries, qrels


def download_scifact(output_dir: str | Path) -> Path:
    output = Path(output_dir)
    if (output / "corpus.jsonl").exists():
        return output

    url = "https://public.ukp.informatik.tu-darmstadt.de/thakur/BEIR/datasets/scifact.zip"
    zip_path = output.parent / "scifact.zip"
    output.parent.mkdir(parents=True, exist_ok=True)

    try:
        from beir import util

        data_path = util.download_and_unzip(url, str(output.parent))
        return Path(data_path)
    except ModuleNotFoundError:
        if not zip_path.exists():
            urllib.request.urlretrieve(url, zip_path)
        with zipfile.ZipFile(zip_path) as archive:
            archive.extractall(output.parent)
        return output
