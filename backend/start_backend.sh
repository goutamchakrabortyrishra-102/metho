#!/bin/sh
set -e

if [ "${BACKEND_MODE:-}" = "sql" ]; then
  echo "Starting SQL starter backend mode."
  exec uvicorn sql_app.main:app --host 0.0.0.0 --port 8000 --proxy-headers --forwarded-allow-ips='*'
fi

if [ "${SIMPLE_BACKEND_MODE:-1}" = "1" ]; then
  echo "Starting SIMPLE backend mode (Mongo-free)."
  exec uvicorn server_simple:app --host 0.0.0.0 --port 8000 --proxy-headers --forwarded-allow-ips='*'
fi

echo "Starting FULL backend mode (Mongo required)."
exec uvicorn server:app --host 0.0.0.0 --port 8000 --proxy-headers --forwarded-allow-ips='*'
