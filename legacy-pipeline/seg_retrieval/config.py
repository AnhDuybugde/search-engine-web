from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml


@dataclass(frozen=True)
class DatasetConfig:
    name: str
    data_dir: Path
    text_fields: tuple[str, ...]


@dataclass(frozen=True)
class RetrievalConfig:
    top_k: int
    rrf_k: int
    dense_model: str
    dense_batch_size: int


@dataclass(frozen=True)
class RouterConfig:
    label_order: tuple[str, ...]
    tie_break_order: tuple[str, ...]


@dataclass(frozen=True)
class RerankConfig:
    enabled: bool
    model: str
    top_k: int
    router_confidence_threshold: float
    score_gap_threshold: float
    disagreement_threshold: float


@dataclass(frozen=True)
class OutputConfig:
    run_dir: Path


@dataclass(frozen=True)
class AppConfig:
    dataset: DatasetConfig
    retrieval: RetrievalConfig
    router: RouterConfig
    rerank: RerankConfig
    outputs: OutputConfig


def load_config(path: str | Path) -> AppConfig:
    raw = yaml.safe_load(Path(path).read_text(encoding="utf-8"))
    return AppConfig(
        dataset=DatasetConfig(
            name=raw["dataset"]["name"],
            data_dir=Path(raw["dataset"]["data_dir"]),
            text_fields=tuple(raw["dataset"]["text_fields"]),
        ),
        retrieval=RetrievalConfig(**raw["retrieval"]),
        router=RouterConfig(
            label_order=tuple(raw["router"]["label_order"]),
            tie_break_order=tuple(raw["router"]["tie_break_order"]),
        ),
        rerank=RerankConfig(**raw["rerank"]),
        outputs=OutputConfig(run_dir=Path(raw["outputs"]["run_dir"])),
    )


def ensure_output_dirs(config: AppConfig) -> None:
    config.dataset.data_dir.mkdir(parents=True, exist_ok=True)
    config.outputs.run_dir.mkdir(parents=True, exist_ok=True)


def as_dict(config: AppConfig) -> dict[str, Any]:
    return {
        "dataset": {
            "name": config.dataset.name,
            "data_dir": str(config.dataset.data_dir),
            "text_fields": list(config.dataset.text_fields),
        },
        "retrieval": config.retrieval.__dict__,
        "router": {
            "label_order": list(config.router.label_order),
            "tie_break_order": list(config.router.tie_break_order),
        },
        "rerank": config.rerank.__dict__,
        "outputs": {"run_dir": str(config.outputs.run_dir)},
    }
