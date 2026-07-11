from typing import Optional, List
from pydantic import BaseModel

class Chunk(BaseModel):
    chunk_id: str
    document_id: str
    title: str
    url: Optional[str] = None
    text: str
    chunk_index: int

class RankedChunk(BaseModel):
    chunk: Chunk
    bm25_score: float = 0.0
    bm25_rank: int = 0
    reranker_score: float = 0.0
    reranker_rank: int = 0

class RetrievalPipelineContract:
    async def retrieve(
        self,
        query: str,
        chunks: List[Chunk],
        top_k: int,
    ) -> List[RankedChunk]:
        raise NotImplementedError
