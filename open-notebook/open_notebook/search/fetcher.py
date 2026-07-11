import asyncio
import httpx
from typing import List, Dict
from loguru import logger

class AsyncWebFetcher:
    def __init__(self, concurrency: int = 5, timeout: float = 10.0):
        self.semaphore = asyncio.Semaphore(concurrency)
        self.timeout = timeout
        
    async def fetch_url(self, client: httpx.AsyncClient, url: str) -> Dict[str, str]:
        async with self.semaphore:
            try:
                headers = {
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
                }
                logger.debug(f"Fetching URL: {url}")
                response = await client.get(url, headers=headers, timeout=self.timeout, follow_redirects=True)
                if response.status_code == 200:
                    return {"url": url, "html": response.text, "success": "true"}
                else:
                    logger.warning(f"Failed to fetch {url}, status code: {response.status_code}")
                    return {"url": url, "html": "", "success": "false", "error": f"Status {response.status_code}"}
            except Exception as e:
                logger.warning(f"Error fetching {url}: {e}")
                return {"url": url, "html": "", "success": "false", "error": str(e)}

    async def fetch_urls(self, urls: List[str]) -> List[Dict[str, str]]:
        # Disable SSL verification issues for dev
        limits = httpx.Limits(max_keepalive_connections=5, max_connections=20)
        async with httpx.AsyncClient(limits=limits, verify=False) as client:
            tasks = [self.fetch_url(client, url) for url in urls]
            return await asyncio.gather(*tasks)
