import uuid
from typing import List, Optional
from open_notebook.retrieval.contracts import Chunk

class WordChunker:
    def __init__(self, chunk_size: int = 350, chunk_overlap: int = 60):
        self.chunk_size = chunk_size
        self.chunk_overlap = chunk_overlap

    def chunk_document(
        self,
        document_id: str,
        title: str,
        text: str,
        url: Optional[str] = None
    ) -> List[Chunk]:
        if not text or not text.strip():
            return []
        
        words = text.split()
        total_words = len(words)
        
        if total_words == 0:
            return []
            
        chunks = []
        chunk_index = 0
        
        start = 0
        while start < total_words:
            end = min(start + self.chunk_size, total_words)
            chunk_words = words[start:end]
            chunk_text = " ".join(chunk_words)
            
            chunks.append(
                Chunk(
                    chunk_id=str(uuid.uuid4()),
                    document_id=document_id,
                    title=title,
                    url=url,
                    text=chunk_text,
                    chunk_index=chunk_index
                )
            )
            
            chunk_index += 1
            if end >= total_words:
                break
            # To avoid infinite loop if overlap is larger than or equal to size
            step = self.chunk_size - self.chunk_overlap
            if step <= 0:
                step = 1
            start += step
            
        return chunks
