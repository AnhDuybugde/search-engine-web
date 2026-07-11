from urllib.parse import urlparse, urlunparse
from typing import List

def normalize_url(url: str) -> str:
    try:
        parsed = urlparse(url)
        query_parts = []
        if parsed.query:
            query_parts = [
                p for p in parsed.query.split("&")
                if not p.lower().startswith("utm_")
            ]
        
        new_query = "&".join(query_parts)
        path = parsed.path
        if path.endswith("/") and len(path) > 1:
            path = path[:-1]
            
        normalized = urlunparse((
            parsed.scheme.lower(),
            parsed.netloc.lower(),
            path,
            parsed.params,
            new_query,
            ""  # Strip fragment/anchors
        ))
        return normalized
    except Exception:
        return url

def unique_urls(urls: List[str]) -> List[str]:
    seen = set()
    result = []
    for url in urls:
        norm = normalize_url(url)
        if norm not in seen:
            seen.add(norm)
            result.append(url)
    return result
