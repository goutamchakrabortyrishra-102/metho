# METHO AAY-UPAY ERP — Backend (FastAPI)
FROM python:3.11-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
  PYTHONUNBUFFERED=1 \
  PIP_NO_CACHE_DIR=1

# System deps for weasyprint fonts, healthcheck, etc.
RUN apt-get update && apt-get install -y --no-install-recommends \
  curl build-essential libjpeg-dev zlib1g-dev \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt ./
RUN pip install --upgrade pip && pip install -r requirements.txt

COPY . .

RUN chmod +x /app/start_backend.sh

# Non-root user for security
RUN useradd -m -u 1000 metho && chown -R metho:metho /app
USER metho

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD curl -f http://localhost:8000/api || exit 1

CMD ["/app/start_backend.sh"]
