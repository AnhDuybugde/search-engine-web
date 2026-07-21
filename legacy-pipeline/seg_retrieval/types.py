from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Document:
    doc_id: str
    title: str
    abstract: str

    @property
    def text(self) -> str:
        return " ".join(part for part in (self.title, self.abstract) if part).strip()


@dataclass(frozen=True)
class Query:
    query_id: str
    text: str


Run = dict[str, list[tuple[str, float]]]
Qrels = dict[str, dict[str, int]]
