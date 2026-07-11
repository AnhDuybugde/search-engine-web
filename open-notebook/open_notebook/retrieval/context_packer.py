from urllib.parse import urlparse
from typing import List, Dict
from open_notebook.retrieval.contracts import RankedChunk

class ContextPacker:
    def __init__(self, max_per_source: int = 2, max_total_chunks: int = 6):
        self.max_per_source = max_per_source
        self.max_total_chunks = max_total_chunks

    def pack_context(self, ranked_chunks: List[RankedChunk]) -> List[RankedChunk]:
        packed_chunks: List[RankedChunk] = []
        source_counts: Dict[str, int] = {}
        
        for rc in ranked_chunks:
            if len(packed_chunks) >= self.max_total_chunks:
                break
                
            # Determine source identifier (domain or document_id)
            if rc.chunk.url:
                try:
                    parsed = urlparse(rc.chunk.url)
                    source_id = parsed.netloc or rc.chunk.document_id
                except Exception:
                    source_id = rc.chunk.document_id
            else:
                source_id = rc.chunk.document_id
                
            count = source_counts.get(source_id, 0)
            if count < self.max_per_source:
                packed_chunks.append(rc)
                source_counts[source_id] = count + 1
                
        return packed_chunks
