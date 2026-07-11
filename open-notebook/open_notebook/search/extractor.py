import trafilatura
from typing import Dict

class ContentExtractor:
    def extract(self, html: str) -> Dict[str, str]:
        if not html:
            return {"title": "", "text": ""}
        try:
            res = trafilatura.bare_extraction(html)
            if res:
                title = res.get("title") or ""
                text = res.get("text") or ""
                return {"title": title, "text": text}
        except Exception:
            pass
            
        # Fallback to standard extraction
        try:
            text = trafilatura.extract(html) or ""
            return {"title": "", "text": text}
        except Exception:
            return {"title": "", "text": ""}
