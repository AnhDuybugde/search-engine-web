import httpx
from typing import List, Dict, Any
from loguru import logger
import os

class SearXNGProvider:
    def __init__(self, base_url: str = None):
        if base_url:
            self.base_url = base_url
        else:
            # Check env, check typical compose name 'searxng', fallback to localhost
            self.base_url = os.getenv("SEARXNG_URL", "http://localhost:8080")
            
    async def search(self, query: str, limit: int = 20) -> List[Dict[str, Any]]:
        # Use http://searxng:8080 inside docker compose network, or base_url
        url = f"{self.base_url.rstrip('/')}/search"
        params = {
            "q": query,
            "format": "json"
        }
        
        try:
            async with httpx.AsyncClient() as client:
                logger.info(f"Querying SearXNG: {url} with query='{query}'")
                response = await client.get(url, params=params, timeout=10.0)
                if response.status_code != 200:
                    # Try fallback to local docker address if localhost fails and inside docker
                    logger.error(f"SearXNG returned status code {response.status_code}: {response.text}")
                    return []
                    
                data = response.json()
                results = data.get("results", [])
                
                formatted = []
                for r in results[:limit]:
                    formatted.append({
                        "title": r.get("title", ""),
                        "url": r.get("url", ""),
                        "content": r.get("content", "")
                    })
                return formatted
        except Exception as e:
            logger.error(f"Error querying SearXNG: {e}")
            return []
