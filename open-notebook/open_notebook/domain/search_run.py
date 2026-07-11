from typing import ClassVar, Dict, Any, Optional, List
from open_notebook.domain.base import ObjectModel

class SearchRun(ObjectModel):
    table_name: ClassVar[str] = "search_run"
    query: str
    config: Dict[str, Any]
    results: Optional[List[Dict[str, Any]]] = None
    timing: Optional[Dict[str, float]] = None
    metrics: Optional[Dict[str, Any]] = None
    status: str = "pending"  # pending, running, completed, failed
    error: Optional[str] = None
    generated_answer: Optional[str] = None
