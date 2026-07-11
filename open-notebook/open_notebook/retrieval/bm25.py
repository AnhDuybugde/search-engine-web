from typing import List
from rank_bm25 import BM25Okapi
from open_notebook.retrieval.contracts import Chunk, RankedChunk

class BM25Retriever:
    def retrieve(self, query: str, chunks: List[Chunk], top_k: int = 40) -> List[RankedChunk]:
        if not chunks:
            return []
        
        # Tokenize using a simple word splitter, lowercased for basic case-insensitivity
        tokenized_corpus = [chunk.text.lower().split() for chunk in chunks]
        tokenized_query = query.lower().split()
        
        bm25 = BM25Okapi(tokenized_corpus)
        scores = bm25.get_scores(tokenized_query)
        
        # Zip, sort, and retain original position info
        indexed_pairs = []
        for idx, (chunk, score) in enumerate(zip(chunks, scores)):
            indexed_pairs.append((chunk, score))
            
        ranked_pairs = sorted(
            indexed_pairs,
            key=lambda x: x[1],
            reverse=True
        )
        
        # Limit to top_k
        top_pairs = ranked_pairs[:top_k]
        
        results = []
        for rank, (chunk, score) in enumerate(top_pairs):
            results.append(
                RankedChunk(
                    chunk=chunk,
                    bm25_score=float(score),
                    bm25_rank=rank + 1
                )
            )
        return results
