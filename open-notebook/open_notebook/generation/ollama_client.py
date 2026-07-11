import httpx
import json
import os
from typing import AsyncGenerator, List
from loguru import logger

class OllamaClient:
    def __init__(self, base_url: str = None, model: str = "qwen2.5:latest"):
        if base_url:
            self.base_url = base_url
        else:
            self.base_url = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
        self.model = os.getenv("OLLAMA_MODEL", model)

    async def test_connection(self) -> bool:
        url = f"{self.base_url.rstrip('/')}/api/tags"
        try:
            async with httpx.AsyncClient(timeout=3.0) as client:
                res = await client.get(url)
                return res.status_code == 200
        except Exception:
            return False

    async def generate_stream(
        self,
        prompt: str,
        system_prompt: str = None,
        temperature: float = 0.1,
        max_tokens: int = 800
    ) -> AsyncGenerator[str, None]:
        url = f"{self.base_url.rstrip('/')}/api/generate"
        payload = {
            "model": self.model,
            "prompt": prompt,
            "stream": True,
            "options": {
                "temperature": temperature,
                "num_predict": max_tokens
            }
        }
        if system_prompt:
            payload["system"] = system_prompt
            
        logger.info(f"Streaming from Ollama model={self.model} at {url}")
        try:
            # Increase timeout for local LLM generation
            async with httpx.AsyncClient(timeout=60.0) as client:
                async with client.stream("POST", url, json=payload) as response:
                    if response.status_code != 200:
                        logger.error(f"Ollama returned status code {response.status_code}")
                        yield json.dumps({"error": f"Ollama status {response.status_code}", "done": True})
                        return
                        
                    async for line in response.aiter_lines():
                        if not line:
                            continue
                        try:
                            data = json.loads(line)
                            token = data.get("response", "")
                            done = data.get("done", False)
                            
                            yield json.dumps({
                                "token": token,
                                "done": done
                            })
                        except Exception as e:
                            logger.error(f"JSON parse error on Ollama line: {e}")
        except Exception as e:
            logger.error(f"Ollama connection error: {e}")
            yield json.dumps({"error": f"Connection error: {str(e)}", "done": True})
