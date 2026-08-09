"""
Simple fallback backend for emergency deployment.
Use when full Mongo-backed backend is not ready yet.
"""
from datetime import datetime, timezone
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="METHO AAY-UPAY ERP v3.0 (Simple Mode)")

# Keep permissive CORS in simple mode so frontend can connect quickly.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api")
async def api_root():
    return {
        "app": "METHO AAY-UPAY ERP v3.0",
        "mode": "simple",
        "status": "running",
        "time": datetime.now(timezone.utc).isoformat(),
        "message": "Simple backend is active. Configure MongoDB and set SIMPLE_BACKEND_MODE=0 for full features.",
    }


@app.get("/api/health")
async def health():
    return {"ok": True, "mode": "simple"}


@app.get("/api/settings")
async def settings():
    return {
        "site_title": "METHO AAY-UPAY",
        "currency": "INR",
        "simple_mode": True,
    }


@app.get("/api/products")
async def products():
    return []


@app.get("/api/categories")
async def categories():
    return []
