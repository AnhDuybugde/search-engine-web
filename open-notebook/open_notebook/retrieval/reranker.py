import torch
from transformers import AutoModelForSequenceClassification, AutoTokenizer
from typing import List
from loguru import logger
from open_notebook.retrieval.contracts import RankedChunk

class LocalReranker:
    _model = None
    _tokenizer = None
    _load_failed = False

    def __init__(self, model_name: str = "BAAI/bge-reranker-v2-m3", device: str = "cpu"):
        self.model_name = model_name
        if device == "cuda" and torch.cuda.is_available():
            self.device = "cuda"
        else:
            self.device = "cpu"
            
    def _load_model(self) -> bool:
        if LocalReranker._load_failed:
            return False
            
        if LocalReranker._model is None:
            try:
                logger.info(f"Loading reranker model {self.model_name} on device: {self.device}")
                LocalReranker._tokenizer = AutoTokenizer.from_pretrained(self.model_name)
                LocalReranker._model = AutoModelForSequenceClassification.from_pretrained(self.model_name).to(self.device)
                LocalReranker._model.eval()
                logger.info("Reranker model loaded successfully.")
                return True
            except Exception as e:
                logger.error(f"Failed to load local reranker model {self.model_name}: {e}")
                logger.warning("Falling back to BM25 scoring for reranking.")
                LocalReranker._load_failed = True
                return False
        return True

    def rerank(self, query: str, ranked_chunks: List[RankedChunk], top_k: int = 10) -> List[RankedChunk]:
        if not ranked_chunks:
            return []
            
        success = self._load_model()
        
        if not success:
            # Fallback: keep BM25 order and populate reranker fields with BM25 values
            logger.info("Using BM25 fallback for reranking")
            for idx, rc in enumerate(ranked_chunks):
                rc.reranker_score = rc.bm25_score
                rc.reranker_rank = idx + 1
            return ranked_chunks[:top_k]
            
        try:
            pairs = [[query, rc.chunk.text] for rc in ranked_chunks]
            
            with torch.no_grad():
                inputs = LocalReranker._tokenizer(pairs, padding=True, truncation=True, return_tensors='pt', max_length=512).to(self.device)
                outputs = LocalReranker._model(**inputs)
                scores = outputs.logits.view(-1).float()
                # Apply sigmoid activation to scale to [0, 1]
                probs = torch.sigmoid(scores).cpu().tolist()
                
            for rc, score in zip(ranked_chunks, probs):
                rc.reranker_score = float(score)
                
            # Sort by reranker score
            reranked = sorted(
                ranked_chunks,
                key=lambda x: x.reranker_score,
                reverse=True
            )
            
            # Assign ranks
            for rank, rc in enumerate(reranked):
                rc.reranker_rank = rank + 1
                
            return reranked[:top_k]
        except Exception as e:
            logger.error(f"Error during reranking inference: {e}")
            logger.warning("Falling back to BM25 scoring for reranking output.")
            # Fallback
            for idx, rc in enumerate(ranked_chunks):
                rc.reranker_score = rc.bm25_score
                rc.reranker_rank = idx + 1
            return ranked_chunks[:top_k]
