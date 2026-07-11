import json
import os
import time
import asyncio
from typing import AsyncGenerator, Dict, Any, List, Optional, Literal

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse
from loguru import logger
from pydantic import BaseModel

from api.models import AskRequest, AskResponse, SearchRequest, SearchResponse
from open_notebook.ai.models import Model, model_manager
from open_notebook.domain.notebook import text_search, vector_search
from open_notebook.exceptions import DatabaseOperationError, InvalidInputError
from open_notebook.graphs.ask import graph as ask_graph

# Import our new search, retrieval, and generation components
from open_notebook.search import SearXNGProvider, AsyncWebFetcher, ContentExtractor, unique_urls
from open_notebook.retrieval import WordChunker, RetrievalPipeline, Chunk, RankedChunk
from open_notebook.generation import OllamaClient
from open_notebook.domain.search_run import SearchRun
from open_notebook.domain.notebook import Notebook, Source
from open_notebook.database.repository import repo_query

router = APIRouter()

# --- Request Models ---

class SearchRunCreateRequest(BaseModel):
    query: str
    search_limit: int = 20
    retrieve_top_k: int = 40
    rerank_top_k: int = 10
    context_top_k: int = 6
    generate_answer: bool = True
    boost_speed: bool = False
    retrieval_method: Literal["bm25", "our-method"] = "bm25"

class NotebookRetrieveRequest(BaseModel):
    query: str
    source_ids: Optional[List[str]] = None
    limit: int = 10
    retrieval_method: Literal["bm25", "our-method"] = "bm25"

class NotebookAnswerRequest(BaseModel):
    query: str
    source_ids: Optional[List[str]] = None
    limit: int = 10
    generate_answer: bool = True
    retrieval_method: Literal["bm25", "our-method"] = "bm25"


def build_search_queries(query: str) -> List[str]:
    """Build lightweight multilingual web-search variants for newsy questions."""
    normalized = " ".join(query.split())
    lower = normalized.lower()
    queries = [normalized]

    replacements = {
        "kết quả": "result",
        "bóng đá": "football",
        "trận đấu": "match",
        "trận": "match",
        "gần nhất": "latest",
        "pháp": "France",
        "ma rốc": "Morocco",
        "maroc": "Morocco",
        "world cup": "World Cup",
    }

    translated = lower
    for source, target in replacements.items():
        translated = translated.replace(source, target)
    translated = " ".join(translated.split())
    if translated and translated != lower:
        queries.append(translated)

    if any(term in lower for term in ["world cup", "bóng đá", "kết quả", "trận", "score"]):
        if "pháp" in lower or "france" in lower:
            queries.append("France latest match World Cup 2026 result score")
            queries.append("France World Cup 2026 last match result")

    deduped = []
    seen = set()
    for candidate in queries:
        key = candidate.lower()
        if key not in seen:
            deduped.append(candidate)
            seen.add(key)
    return deduped[:4]

# --- Existing Endpoints (Kept Unchanged) ---

@router.post("/search", response_model=SearchResponse)
async def search_knowledge_base(search_request: SearchRequest):
    """Search the knowledge base using text or vector search."""
    try:
        if search_request.type == "vector":
            # Check if embedding model is available for vector search
            if not await model_manager.get_embedding_model():
                raise HTTPException(
                    status_code=400,
                    detail="Vector search requires an embedding model. Please configure one in the Models section.",
                )

            results = await vector_search(
                keyword=search_request.query,
                results=search_request.limit,
                source=search_request.search_sources,
                note=search_request.search_notes,
                minimum_score=search_request.minimum_score,
            )
        else:
            # Text search
            results = await text_search(
                keyword=search_request.query,
                results=search_request.limit,
                source=search_request.search_sources,
                note=search_request.search_notes,
            )

        return SearchResponse(
            results=results or [],
            total_count=len(results) if results else 0,
            search_type=search_request.type,
        )

    except InvalidInputError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except DatabaseOperationError as e:
        logger.error(f"Database error during search: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Search failed: {str(e)}")
    except Exception as e:
        logger.error(f"Unexpected error during search: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Search failed: {str(e)}")


async def stream_ask_response(
    question: str, strategy_model: Model, answer_model: Model, final_answer_model: Model
) -> AsyncGenerator[str, None]:
    """Stream the ask response as Server-Sent Events."""
    try:
        final_answer = None

        async for chunk in ask_graph.astream(
            input=dict(question=question),  # type: ignore[arg-type]
            config=dict(
                configurable=dict(
                    strategy_model=strategy_model.id,
                    answer_model=answer_model.id,
                    final_answer_model=final_answer_model.id,
                )
            ),
            stream_mode="updates",
        ):
            if "agent" in chunk:
                strategy_data = {
                    "type": "strategy",
                    "reasoning": chunk["agent"]["strategy"].reasoning,
                    "searches": [
                        {"term": search.term, "instructions": search.instructions}
                        for search in chunk["agent"]["strategy"].searches
                    ],
                }
                yield f"data: {json.dumps(strategy_data)}\n\n"

            elif "provide_answer" in chunk:
                for answer in chunk["provide_answer"]["answers"]:
                    answer_data = {"type": "answer", "content": answer}
                    yield f"data: {json.dumps(answer_data)}\n\n"

            elif "write_final_answer" in chunk:
                final_answer = chunk["write_final_answer"]["final_answer"]
                final_data = {"type": "final_answer", "content": final_answer}
                yield f"data: {json.dumps(final_data)}\n\n"

        # Send completion signal
        completion_data = {"type": "complete", "final_answer": final_answer}
        yield f"data: {json.dumps(completion_data)}\n\n"

    except Exception as e:
        from open_notebook.utils.error_classifier import classify_error

        _, user_message = classify_error(e)
        logger.error(f"Error in ask streaming: {str(e)}")
        error_data = {"type": "error", "message": user_message}
        yield f"data: {json.dumps(error_data)}\n\n"


@router.post("/search/ask")
async def ask_knowledge_base(ask_request: AskRequest):
    """Ask the knowledge base a question using AI models."""
    try:
        # Validate models exist
        strategy_model = await Model.get(ask_request.strategy_model)
        answer_model = await Model.get(ask_request.answer_model)
        final_answer_model = await Model.get(ask_request.final_answer_model)

        if not strategy_model:
            raise HTTPException(
                status_code=400,
                detail=f"Strategy model {ask_request.strategy_model} not found",
            )
        if not answer_model:
            raise HTTPException(
                status_code=400,
                detail=f"Answer model {ask_request.answer_model} not found",
            )
        if not final_answer_model:
            raise HTTPException(
                status_code=400,
                detail=f"Final answer model {ask_request.final_answer_model} not found",
            )

        # Check if embedding model is available
        if not await model_manager.get_embedding_model():
            raise HTTPException(
                status_code=400,
                detail="Ask feature requires an embedding model. Please configure one in the Models section.",
            )

        # For streaming response
        return StreamingResponse(
            stream_ask_response(
                ask_request.question, strategy_model, answer_model, final_answer_model
            ),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
            },
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error in ask endpoint: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Ask operation failed: {str(e)}")


@router.post("/search/ask/simple", response_model=AskResponse)
async def ask_knowledge_base_simple(ask_request: AskRequest):
    """Ask the knowledge base a question and return a simple response (non-streaming)."""
    try:
        # Validate models exist
        strategy_model = await Model.get(ask_request.strategy_model)
        answer_model = await Model.get(ask_request.answer_model)
        final_answer_model = await Model.get(ask_request.final_answer_model)

        if not strategy_model:
            raise HTTPException(
                status_code=400,
                detail=f"Strategy model {ask_request.strategy_model} not found",
            )
        if not answer_model:
            raise HTTPException(
                status_code=400,
                detail=f"Answer model {ask_request.answer_model} not found",
            )
        if not final_answer_model:
            raise HTTPException(
                status_code=400,
                detail=f"Final answer model {ask_request.final_answer_model} not found",
            )

        # Check if embedding model is available
        if not await model_manager.get_embedding_model():
            raise HTTPException(
                status_code=400,
                detail="Ask feature requires an embedding model. Please configure one in the Models section.",
            )

        # Run the ask graph and get final result
        final_answer = None
        async for chunk in ask_graph.astream(
            input=dict(question=ask_request.question),  # type: ignore[arg-type]
            config=dict(
                configurable=dict(
                    strategy_model=strategy_model.id,
                    answer_model=answer_model.id,
                    final_answer_model=final_answer_model.id,
                )
            ),
            stream_mode="updates",
        ):
            if "write_final_answer" in chunk:
                final_answer = chunk["write_final_answer"]["final_answer"]

        if not final_answer:
            raise HTTPException(status_code=500, detail="No answer generated")

        return AskResponse(answer=final_answer, question=ask_request.question)

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error in ask simple endpoint: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Ask operation failed: {str(e)}")


# --- Health Endpoints (Section 8) ---

@router.get("/health/searxng")
async def health_searxng():
    provider = SearXNGProvider()
    url = f"{provider.base_url.rstrip('/')}/status"
    try:
        import httpx
        async with httpx.AsyncClient() as client:
            res = await client.get(url, timeout=3.0)
            if res.status_code == 200:
                return {"status": "healthy", "provider": "searxng", "url": provider.base_url}
    except Exception:
        pass
    # fallback check search query
    try:
        results = await provider.search("healthcheck", limit=1)
        return {"status": "healthy" if results else "unhealthy", "provider": "searxng", "url": provider.base_url}
    except Exception as e:
        return {"status": "unhealthy", "error": str(e), "url": provider.base_url}

@router.get("/health/ollama")
async def health_ollama():
    client = OllamaClient()
    connected = await client.test_connection()
    return {
        "status": "healthy" if connected else "unhealthy",
        "provider": "ollama",
        "url": client.base_url,
        "model": client.model
    }

@router.get("/health/reranker")
async def health_reranker():
    from open_notebook.retrieval.reranker import LocalReranker
    reranker = LocalReranker()
    # Check if loaded or failed
    status = "healthy"
    if LocalReranker._load_failed:
        status = "degraded (fallback to BM25)"
    return {
        "status": status,
        "model": reranker.model_name,
        "device": reranker.device,
        "load_failed": LocalReranker._load_failed
    }


# --- Search Run Endpoints (Section 8 & 9) ---

@router.post("/search/runs")
async def create_search_run(req: SearchRunCreateRequest):
    """Create a new search run log in the database."""
    run = SearchRun(
        query=req.query,
        config=req.model_dump(),
        status="pending"
    )
    await run.save()
    return run

@router.get("/search/runs/{run_id}")
async def get_search_run(run_id: str):
    """Retrieve details of a search run."""
    try:
        run = await SearchRun.get(run_id)
        return run
    except Exception as e:
        raise HTTPException(status_code=404, detail=f"Search run {run_id} not found: {e}")

@router.post("/search/runs/{run_id}/cancel")
async def cancel_search_run(run_id: str):
    """Cancel a pending/running search run."""
    try:
        run = await SearchRun.get(run_id)
        if run.status in ["pending", "running"]:
            run.status = "cancelled"
            await run.save()
        return {"status": "success", "message": f"Run {run_id} cancelled"}
    except Exception as e:
        raise HTTPException(status_code=404, detail=f"Search run {run_id} not found: {e}")

@router.delete("/search/runs/{run_id}")
async def delete_search_run(run_id: str):
    """Delete a search run from history."""
    try:
        run = await SearchRun.get(run_id)
        await run.delete()
        return {"status": "success", "message": f"Run {run_id} deleted"}
    except Exception as e:
        raise HTTPException(status_code=404, detail=f"Search run {run_id} not found: {e}")

@router.get("/search/runs")
async def get_all_search_runs(
    summary: bool = Query(False, description="Return lightweight rows without heavy results/answers"),
    limit: int = Query(50, ge=1, le=200),
):
    """Retrieve history of all search runs."""
    try:
        if summary:
            return await repo_query(
                """
                SELECT id, query, config, timing, metrics, status, error, created, updated
                FROM search_run
                ORDER BY created DESC
                LIMIT $limit
                """,
                {"limit": limit},
            )

        runs = await SearchRun.get_all(order_by="created desc")
        return runs
    except Exception as e:
        logger.error(f"Error fetching search runs: {e}")
        return []


async def execute_and_stream_run(run_id: str) -> AsyncGenerator[str, None]:
    """Execute search pipeline step-by-step and yield events."""
    run = None
    try:
        try:
            run = await SearchRun.get(run_id)
        except Exception as e:
            yield f"data: {json.dumps({'event': 'run_failed', 'data': {'error': f'Run not found: {e}'}})}\n\n"
            return

        if run.status == "cancelled":
            yield f"data: {json.dumps({'event': 'run_failed', 'data': {'error': 'Run was cancelled'}})}\n\n"
            return

        run.status = "running"
        await run.save()

        timing: Dict[str, float] = {}
        metrics: Dict[str, Any] = {}
        total_start = time.perf_counter()

        query = run.query
        config = run.config
        search_limit = config.get("search_limit", 20)
        retrieve_top_k = config.get("retrieve_top_k", 40)
        rerank_top_k = config.get("rerank_top_k", 10)
        context_top_k = config.get("context_top_k", 6)
        generate_answer = config.get("generate_answer", True)
        boost_speed = config.get("boost_speed", False)
        retrieval_method = config.get("retrieval_method", "bm25")

        # --- Step 1: SearXNG Web Search ---
        yield f"data: {json.dumps({'event': 'search_started', 'data': {'query': query}})}\n\n"
        
        search_start = time.perf_counter()
        searxng = SearXNGProvider()
        
        # Try local docker container host name if local fails
        if "localhost" in searxng.base_url:
            # If running inside docker, localhost refers to the container. The host is host.docker.internal,
            # or other services can be reached via container name 'searxng'. Let's probe 'searxng' if localhost fails.
            if os.getenv("SURREAL_URL", "").startswith("ws://surrealdb"):
                searxng.base_url = "http://searxng:8080"
                
        search_results = []
        seen_result_urls = set()
        query_variants = build_search_queries(query)
        per_query_limit = max(3, min(search_limit, (search_limit + len(query_variants) - 1) // len(query_variants) + 2))
        for search_query in query_variants:
            variant_results = await searxng.search(search_query, limit=per_query_limit)
            for result in variant_results:
                url = result.get("url")
                key = url or f"{result.get('title', '')}:{result.get('content', '')}"
                if key in seen_result_urls:
                    continue
                search_results.append(result)
                seen_result_urls.add(key)
                if len(search_results) >= search_limit:
                    break
            if len(search_results) >= search_limit:
                break
        timing["search_time"] = round(time.perf_counter() - search_start, 3)

        metrics["search_results_count"] = len(search_results)
        metrics["search_query_variants"] = query_variants
        yield f"data: {json.dumps({'event': 'search_results_received', 'data': {'count': len(search_results), 'results': search_results, 'queries': query_variants}})}\n\n"

        if run.status == "cancelled" or (await SearchRun.get(run_id)).status == "cancelled":
            return

        # --- Step 2: URL Normalization and Deduplication ---
        raw_urls = [r["url"] for r in search_results if r.get("url")]
        unique_web_urls = unique_urls(raw_urls)
        metrics["duplicate_urls_removed"] = len(raw_urls) - len(unique_web_urls)

        # Slice to max pages to fetch (max 15 as in plan.md, 5 if boost_speed is active)
        max_pages = 5 if boost_speed else 15
        unique_web_urls = unique_web_urls[:max_pages]

        # --- Step 3: Fetch Pages ---
        yield f"data: {json.dumps({'event': 'fetch_started', 'data': {'urls': unique_web_urls}})}\n\n"
        
        fetch_start = time.perf_counter()
        fetcher = AsyncWebFetcher(concurrency=5, timeout=10.0)
        fetched_docs = await fetcher.fetch_urls(unique_web_urls)
        timing["fetch_time"] = round(time.perf_counter() - fetch_start, 3)

        success_docs = []
        fetched_success_count = 0
        fetched_failed_count = 0

        extractor = ContentExtractor()
        extraction_start = time.perf_counter()

        for doc in fetched_docs:
            url = doc["url"]
            title = ""
            # Find original title from search results as fallback
            for r in search_results:
                if r["url"] == url:
                    title = r["title"]
                    break

            if doc["success"] == "true":
                fetched_success_count += 1
                extracted = extractor.extract(doc["html"])
                doc_title = extracted["title"] or title
                success_docs.append({
                    "url": url,
                    "title": doc_title,
                    "text": extracted["text"],
                    "document_id": url
                })
                yield f"data: {json.dumps({'event': 'document_fetched', 'data': {'url': url, 'title': doc_title}})}\n\n"
            else:
                fetched_failed_count += 1
                yield f"data: {json.dumps({'event': 'document_failed', 'data': {'url': url, 'error': doc.get('error', 'Unknown error')}})}\n\n"

        timing["extraction_time"] = round(time.perf_counter() - extraction_start, 3)
        metrics["fetched_success_count"] = fetched_success_count
        metrics["fetched_failed_count"] = fetched_failed_count

        if run.status == "cancelled" or (await SearchRun.get(run_id)).status == "cancelled":
            return

        # --- Step 4: Chunking ---
        chunker = WordChunker(chunk_size=350, chunk_overlap=60)
        chunking_start = time.perf_counter()
        
        all_chunks: List[Chunk] = []
        for doc in success_docs:
            doc_chunks = chunker.chunk_document(
                document_id=doc["document_id"],
                title=doc["title"],
                text=doc["text"],
                url=doc["url"]
            )
            all_chunks.extend(doc_chunks)
            
        timing["chunking_time"] = round(time.perf_counter() - chunking_start, 3)
        metrics["chunks_created"] = len(all_chunks)

        yield f"data: {json.dumps({'event': 'chunking_completed', 'data': {'chunks_count': len(all_chunks)}})}\n\n"

        if not all_chunks:
            # No chunks, complete immediately with empty
            timing["total_time"] = round(time.perf_counter() - total_start, 3)
            run.status = "completed"
            run.timing = timing
            run.metrics = metrics
            run.results = []
            await run.save()
            yield f"data: {json.dumps({'event': 'retrieval_ready', 'data': {'results': []}})}\n\n"
            yield f"data: {json.dumps({'event': 'run_completed', 'data': {'run': run.model_dump(mode='json')}})}\n\n"
            return

        # --- Step 5: Retrieval Pipeline (BM25 + Rerank + Packing) ---
        pipeline_start = time.perf_counter()
        pipeline = RetrievalPipeline(
            bm25_top_k=retrieve_top_k,
            rerank_top_k=rerank_top_k,
            context_top_k=context_top_k,
            device="cuda",
            retrieval_method=retrieval_method,
        )

        # We do retrieval and rerank separately so we can stream progress events
        retrieval_start = time.perf_counter()
        candidate_results = pipeline.retrieve_candidates(query, all_chunks, top_k=retrieve_top_k)
        timing["retrieval_candidate_time"] = round(time.perf_counter() - retrieval_start, 3)
        timing["bm25_time"] = timing["retrieval_candidate_time"]
        metrics["retrieval_method"] = retrieval_method
        metrics["chunks_retrieved"] = len(candidate_results)
        yield f"data: {json.dumps({'event': 'bm25_completed', 'data': {'count': len(candidate_results), 'method': retrieval_method}})}\n\n"

        if run.status == "cancelled" or (await SearchRun.get(run_id)).status == "cancelled":
            return

        if boost_speed:
            logger.info("Boost Speed enabled: bypassing neural reranker and using BM25 results directly")
            rerank_results = candidate_results[:rerank_top_k]
            for idx, rc in enumerate(rerank_results):
                rc.reranker_score = rc.rrf_score or rc.bm25_score
                rc.reranker_rank = idx + 1
            timing["reranking_time"] = 0.0
            metrics["chunks_reranked"] = len(rerank_results)
            yield f"data: {json.dumps({'event': 'reranking_completed', 'data': {'count': len(rerank_results), 'bypassed': True}})}\n\n"
        else:
            rerank_start = time.perf_counter()
            rerank_results = pipeline.reranker.rerank(query, candidate_results, top_k=rerank_top_k)
            timing["reranking_time"] = round(time.perf_counter() - rerank_start, 3)
            metrics["chunks_reranked"] = len(rerank_results)
            yield f"data: {json.dumps({'event': 'reranking_completed', 'data': {'count': len(rerank_results)}})}\n\n"

        # Context Pack
        packed_results = pipeline.context_packer.pack_context(rerank_results)
        timing["retrieval_time"] = round(time.perf_counter() - pipeline_start, 3)

        # Format results to return to frontend
        formatted_results = []
        for rc in packed_results:
            formatted_results.append(rc.model_dump(mode="json"))

        run.results = formatted_results
        await run.save()

        yield f"data: {json.dumps({'event': 'retrieval_ready', 'data': {'results': formatted_results}})}\n\n"

        # --- Step 6: Generation (Ollama Client) ---
        answer_text = ""
        if generate_answer and packed_results:
            yield f"data: {json.dumps({'event': 'generation_started', 'data': {}})}\n\n"
            
            llm_start = time.perf_counter()
            context_parts = []
            for idx, rc in enumerate(packed_results):
                citation_id = idx + 1
                context_parts.append(
                    f"[{citation_id}] Title: {rc.chunk.title}\nURL: {rc.chunk.url or 'N/A'}\nContent: {rc.chunk.text}\n"
                )
            context_str = "\n".join(context_parts)

            system_prompt = (
                "You are a helpful research assistant. You are given a set of search results chunks.\n"
                "Answer the user's query based ONLY on the provided chunks.\n"
                "For each statement or fact you write, you MUST cite the source chunk using the format [citation_number] (e.g., [1], [2]).\n"
                "Cite multiple sources as [1][2] instead of [1, 2].\n"
                "Keep the answer concise, informative, and clear.\n"
                "If the search results do not contain the answer, say 'I cannot find the answer in the provided documents.' and do not speculate."
            )
            
            user_prompt = f"User Query: {query}\n\nSearch Results Chunks:\n{context_str}"

            ollama_endpoint = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
            # Try host.docker.internal if localhost fails inside docker
            if "localhost" in ollama_endpoint and os.getenv("SURREAL_URL", "").startswith("ws://surrealdb"):
                ollama_endpoint = "http://host.docker.internal:11434"

            ollama = OllamaClient(base_url=ollama_endpoint)
            
            first_token_time = None
            async for chunk_str in ollama.generate_stream(
                prompt=user_prompt,
                system_prompt=system_prompt,
                temperature=0.1,
                max_tokens=800
            ):
                if run.status == "cancelled" or (await SearchRun.get(run_id)).status == "cancelled":
                    return
                    
                chunk_data = json.loads(chunk_str)
                if "error" in chunk_data:
                    yield f"data: {json.dumps({'event': 'generation_failed', 'data': {'error': chunk_data['error']}})}\n\n"
                    break
                    
                token = chunk_data.get("token", "")
                answer_text += token
                
                if first_token_time is None and token:
                    first_token_time = time.perf_counter()
                    timing["time_to_first_token"] = round(first_token_time - llm_start, 3)
                    
                yield f"data: {json.dumps({'event': 'generation_token', 'data': {'token': token}})}\n\n"
                
            timing["llm_time"] = round(time.perf_counter() - llm_start, 3)
            metrics["sources_used_count"] = len(packed_results)
            
            cited_sources = []
            for idx in range(len(packed_results)):
                cit = f"[{idx+1}]"
                if cit in answer_text:
                    cited_sources.append(idx + 1)
            metrics["cited_sources"] = cited_sources

            run.generated_answer = answer_text
            yield f"data: {json.dumps({'event': 'generation_completed', 'data': {'answer': answer_text, 'cited_sources': cited_sources}})}\n\n"

        timing["total_time"] = round(time.perf_counter() - total_start, 3)
        
        run.status = "completed"
        run.timing = timing
        run.metrics = metrics
        await run.save()
        
        yield f"data: {json.dumps({'event': 'run_completed', 'data': {'run': run.model_dump(mode='json')}})}\n\n"

    except Exception as e:
        logger.error(f"Error executing search run: {e}")
        logger.exception(e)
        if run:
            run.status = "failed"
            run.error = str(e)
            await run.save()
        yield f"data: {json.dumps({'event': 'run_failed', 'data': {'error': str(e)}})}\n\n"



@router.get("/search/runs/{run_id}/events")
async def stream_run_events(run_id: str):
    """Endpoint to stream Search Run status and results via Server-Sent Events."""
    return StreamingResponse(
        execute_and_stream_run(run_id),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


# --- Notebook Retrieval & Answering Endpoints (Section 7 & 8) ---

@router.post("/notebooks/{notebook_id}/retrieve")
async def retrieve_notebook_context(notebook_id: str, req: NotebookRetrieveRequest):
    """Retrieve relevant chunks from notebook sources using shared RetrievalPipeline."""
    try:
        notebook = await Notebook.get(notebook_id)
        all_sources = await notebook.get_sources(include_full_text=True)
        
        # Filter by selected source_ids if provided
        sources = all_sources
        if req.source_ids:
            sources = [s for s in all_sources if s.id in req.source_ids]
            
        # Extract and chunk
        chunker = WordChunker(chunk_size=350, chunk_overlap=60)
        chunks: List[Chunk] = []
        for s in sources:
            if not s.full_text:
                continue
            doc_chunks = chunker.chunk_document(
                document_id=s.id,
                title=s.title or "Untitled source",
                text=s.full_text
            )
            chunks.extend(doc_chunks)
            
        if not chunks:
            return {"results": []}
            
        # Run retrieval pipeline
        pipeline = RetrievalPipeline(
            bm25_top_k=40,
            rerank_top_k=20,
            context_top_k=req.limit,
            device="cuda",
            retrieval_method=req.retrieval_method,
        )
        ranked = await pipeline.retrieve(req.query, chunks, top_k=req.limit)
        
        return {"results": [rc.model_dump(mode="json") for rc in ranked]}
        
    except Exception as e:
        logger.error(f"Error in notebook retrieve: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/notebooks/{notebook_id}/answer")
async def answer_notebook_question(notebook_id: str, req: NotebookAnswerRequest):
    """Answer question from notebook sources using shared RetrievalPipeline and Ollama."""
    try:
        notebook = await Notebook.get(notebook_id)
        all_sources = await notebook.get_sources(include_full_text=True)
        
        sources = all_sources
        if req.source_ids:
            sources = [s for s in all_sources if s.id in req.source_ids]
            
        chunker = WordChunker(chunk_size=350, chunk_overlap=60)
        chunks: List[Chunk] = []
        for s in sources:
            if not s.full_text:
                continue
            doc_chunks = chunker.chunk_document(
                document_id=s.id,
                title=s.title or "Untitled source",
                text=s.full_text
            )
            chunks.extend(doc_chunks)
            
        if not chunks:
            return {"answer": "No sources available in notebook.", "results": []}
            
        pipeline = RetrievalPipeline(
            bm25_top_k=40,
            rerank_top_k=20,
            context_top_k=req.limit,
            device="cuda",
            retrieval_method=req.retrieval_method,
        )
        ranked = await pipeline.retrieve(req.query, chunks, top_k=req.limit)
        
        results_formatted = [rc.model_dump(mode="json") for rc in ranked]
        
        if not req.generate_answer:
            return {"answer": "", "results": results_formatted}
            
        # Call Ollama
        context_parts = []
        for idx, rc in enumerate(ranked):
            citation_id = idx + 1
            context_parts.append(
                f"[{citation_id}] Source: {rc.chunk.title}\nContent: {rc.chunk.text}\n"
            )
        context_str = "\n".join(context_parts)

        system_prompt = (
            "You are a helpful research assistant. You are given a set of document chunks from a user's notebook.\n"
            "Answer the user's query based ONLY on the provided chunks.\n"
            "For each statement or fact you write, you MUST cite the source chunk using the format [citation_number] (e.g., [1], [2]).\n"
            "Cite multiple sources as [1][2] instead of [1, 2].\n"
            "Keep the answer concise and clear.\n"
            "If the notebook chunks do not contain the answer, say 'I cannot find the answer in the provided documents.' and do not speculate."
        )
        
        user_prompt = f"Question: {req.query}\n\nNotebook Chunks:\n{context_str}"

        ollama_endpoint = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
        if "localhost" in ollama_endpoint and os.getenv("SURREAL_URL", "").startswith("ws://surrealdb"):
            ollama_endpoint = "http://host.docker.internal:11434"

        ollama = OllamaClient(base_url=ollama_endpoint)
        
        # We can stream or return simple. For this REST endpoint, we can do a non-streaming compile
        # by collecting tokens.
        answer_text = ""
        async for chunk_str in ollama.generate_stream(
            prompt=user_prompt,
            system_prompt=system_prompt,
            temperature=0.1,
            max_tokens=800
        ):
            chunk_data = json.loads(chunk_str)
            if "error" in chunk_data:
                answer_text += f"\n[Generation Error: {chunk_data['error']}]"
                break
            answer_text += chunk_data.get("token", "")
            
        return {
            "answer": answer_text,
            "results": results_formatted
        }
        
    except Exception as e:
        logger.error(f"Error in notebook answer: {e}")
        raise HTTPException(status_code=500, detail=str(e))
