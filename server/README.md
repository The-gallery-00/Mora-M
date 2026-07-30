# MORA Server

This directory contains the server code imported from the original MORA web repository so the mobile app can be developed and deployed from this repository as a separate product.

## Structure

```text
server/
├─ spring/   Spring Boot API server
├─ ocr/      FastAPI OCR server
└─ db/       Local database schema
```

## Current State

The imported server is the original business-card-focused MORA backend.

Implemented today:

- Email signup and login
- JWT-based auth
- Business card OCR scan
- Business card save, list, update, delete
- Business card semantic search with PostgreSQL + pgvector

Still required for the final mobile app:

- Poster, receipt, and ticket APIs
- Dashboard, notifications, recent searches, and full mobile API parity
- Cloud Run deployment files
- GCS-backed image storage instead of local `/uploads`
- Production secrets and OAuth redirect handling for `mora://`

## Local Development

Start PostgreSQL, OCR, and Spring locally:

```bash
cd server
docker compose up --build
```

Local service URLs:

```text
Spring: http://localhost:8080
OCR:    http://localhost:8000
DB:     localhost:5433
```

The mobile app should point to the host machine LAN IP, not `localhost`, when running on a real device.

## Deployment Direction

For store-ready mobile deployment:

- Spring: Cloud Run
- OCR: Cloud Run
- Database: Cloud SQL for PostgreSQL
- Image storage: Google Cloud Storage
- App build: EAS production AAB

Do not deploy the current local `/uploads` storage model to production. Cloud Run instances are stateless, so local images can disappear when instances are replaced.
