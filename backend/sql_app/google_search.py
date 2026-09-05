import json
import logging
import os
from urllib.parse import quote_plus
from urllib.request import Request, urlopen

logger = logging.getLogger(__name__)
SEARCH_URL = "https://www.googleapis.com/customsearch/v1"
SEARCH_USER_AGENT = "METHO-AI-Context/1.0"


def search_web_context(query: str, max_results: int = 3) -> str:
    """Return short public search context; never raise into a customer flow."""
    api_key = os.getenv("GOOGLE_SEARCH_API_KEY", "").strip()
    cse_id = os.getenv("GOOGLE_CSE_ID", "").strip()
    clean_query = str(query or "").strip()[:300]
    if not api_key or not cse_id or not clean_query:
        return ""
    endpoint = f"{SEARCH_URL}?key={quote_plus(api_key)}&cx={quote_plus(cse_id)}&q={quote_plus(clean_query)}&num={max(1, min(3, int(max_results)))}"
    try:
        request = Request(endpoint, headers={"Accept": "application/json", "User-Agent": SEARCH_USER_AGENT})
        with urlopen(request, timeout=4) as response:
            payload = json.loads(response.read().decode("utf-8"))
        items = payload.get("items") if isinstance(payload, dict) else []
        if not isinstance(items, list):
            return ""
        snippets = []
        for item in items[:3]:
            if not isinstance(item, dict):
                continue
            title = str(item.get("title") or "").strip()
            snippet = str(item.get("snippet") or "").strip()
            link = str(item.get("link") or "").strip()
            if title and snippet:
                snippets.append(f"{title}: {snippet} ({link})")
        return "\n".join(snippets)[:5000]
    except Exception as exc:
        logger.warning("Optional Google Search context unavailable: %s", exc)
        return ""