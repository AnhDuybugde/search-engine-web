from typing import List
from open_notebook.retrieval.contracts import Chunk, RankedChunk, RetrievalPipelineContract
from open_notebook.retrieval.bm25 import BM25Retriever
from open_notebook.retrieval.reranker import LocalReranker
from open_notebook.retrieval.context_packer import ContextPacker

class RetrievalPipeline(RetrievalPipelineContract):
    def __init__(
        self,
        bm25_top_k: int = 40,
        rerank_top_k: int = 10,
        context_top_k: int = 6,
        reranker_model: str = "BAAI/bge-reranker-v2-m3",
        device: str = "cpu"
    ):
        self.bm25_top_k = bm25_top_k
        self.rerank_top_k = rerank_top_k
        self.context_top_k = context_top_k
        
        self.bm25_retriever = BM25Retriever()
        self.reranker = LocalReranker(model_name=reranker_model, device=device)
        self.context_packer = ContextPacker(max_total_chunks=context_top_k)

    async def retrieve(
        self,
        query: str,
        chunks: List[Chunk],
        top_k: int = 6,
    ) -> List[RankedChunk]:
        if not chunks:
            return []
            
        # Step 1: BM25 retrieval
        bm25_results = self.bm25_retriever.retrieve(query, chunks, top_k=self.bm25_top_k)
        
        # Step 2: Rerank top BM25 results
        rerank_results = self.reranker.rerank(query, bm25_results, top_k=self.rerank_top_k)
        
        # Step 3: Pack and diversify context sources
        packed_results = self.context_packer.pack_context(rerank_results)
        
        # Limit to the requested top_k
        return packed_results[:top_k]
