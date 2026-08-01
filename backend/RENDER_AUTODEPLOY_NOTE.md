# Render Autodeploy Note

This repository now includes a root-level `render.yaml` file that scopes the backend service to the `backend/` directory and ignores backend markdown docs for autodeploy purposes.

Expected effect after the Render service is synced with the Blueprint:

- root-level docs-only commits stop redeploying the backend
- frontend-only changes stop redeploying the backend
- backend markdown-only changes stop redeploying the backend
- backend code changes under `backend/` still redeploy the backend

Important:

- existing Render services do not automatically start using `render.yaml` unless they are managed by a Blueprint sync, or the equivalent Root Directory / Build Filters settings are applied in the Render dashboard
- changes to `render.yaml` itself are always processed by Render Blueprint syncs
