import json
import sys
from pathlib import Path
from unittest.mock import MagicMock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sql_app.google_search import search_web_context


def test_google_search_returns_three_context_items(monkeypatch):
    monkeypatch.setenv("GOOGLE_SEARCH_API_KEY", "search-key")
    monkeypatch.setenv("GOOGLE_CSE_ID", "cse-id")
    response = MagicMock()
    response.read.return_value = json.dumps({"items": [{"title": "One", "snippet": "First", "link": "https://one"}, {"title": "Two", "snippet": "Second", "link": "https://two"}]}).encode()
    response.__enter__.return_value = response
    response.__exit__.return_value = None
    captured = {}
    monkeypatch.setattr("sql_app.google_search.urlopen", lambda request, timeout: captured.update({"url": request.full_url, "timeout": timeout, "user_agent": request.headers["User-agent"]}) or response)
    result = search_web_context("METHO product price")
    assert "One: First" in result
    assert "Two: Second" in result
    assert "num=3" in captured["url"]
    assert captured["timeout"] == 4
    assert captured["user_agent"] == "METHO-AI-Context/1.0"


def test_google_search_fails_open_without_credentials(monkeypatch):
    monkeypatch.delenv("GOOGLE_SEARCH_API_KEY", raising=False)
    monkeypatch.delenv("GOOGLE_CSE_ID", raising=False)
    assert search_web_context("product price") == ""