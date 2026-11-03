# MORA Server

This directory contains the server code imported from the original MORA web repository so the mobile app can be developed and deployed from this repository as a separate product.

## Structure

```text
server/
├─ spring/   Spring Boot API server (schema managed by Flyway, see spring/src/main/resources/db/migration)
└─ ocr/      FastAPI OCR server
```

## Current State

The imported server is the original business-card-focused MORA backend.

Implemented today:

- Email signup and login
- JWT-based auth
- Business card OCR scan
- Business card save, list, update, delete
- Business card semantic search with PostgreSQL + pgvector
- Poster, receipt, ticket, calendar, and card-group APIs
- Dashboard summary for today's schedules, upcoming deadlines, and document counts
- Notification list/read/delete APIs, notification preferences, and the daily 09:00 KST generator
- Search-history recording, listing, and full deletion for all four document searches
- Flyway-managed schema and Cloud Run Secret Manager deployment script

The release security branch adds authenticated image access through Spring,
image ownership validation for all four document types, full image deletion,
and browser-bound, single-use OAuth state checks. These changes require the
coordinated app/server rollout in
[`RELEASE_SECURITY.md`](RELEASE_SECURITY.md); code presence does not mean they
are already active in production.

Still required for the final mobile app: actual Google Calendar integration,
the chat API, production OAuth end-to-end verification, and release QA.

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

Production uses GCS when `GCS_BUCKET_NAME` is configured. Never use local-only
uploads in production: Cloud Run instance files are temporary.

## Production Environment Variables

### OCR Cloud Run

```text
GCS_BUCKET_NAME=mora-mobile-uploads
GCS_UPLOAD_PREFIX=uploads
MORA_UPLOAD_DIR=/tmp/mora-uploads
OCR_SHARED_SECRET=...  # Secret Manager; same dedicated service secret as Spring
```

`GCS_BUCKET_NAME` enables durable image storage. The OCR service still uses a
temporary local file so PaddleOCR can read the image, then uploads the original
to GCS. App-facing image URLs remain `/uploads/{file}` and are served back by
the OCR service to the authenticated Spring gateway, so the GCS bucket can stay
private. The app must not load originals directly from the OCR service.

### Spring Cloud Run

```text
DATABASE_URL=jdbc:postgresql:///mora?cloudSqlInstance=PROJECT_ID:asia-northeast3:mora-mobile-db&socketFactory=com.google.cloud.sql.postgres.SocketFactory&cloudSqlRefreshStrategy=lazy&stringtype=unspecified
DATABASE_USERNAME=mora
DATABASE_PASSWORD=...
JWT_SECRET=...
JWT_EXPIRATION=1209600000
OCR_SERVICE_URL=https://mora-mobile-ocr-xxxxx.a.run.app
OCR_SHARED_SECRET=...  # required, separate from JWT_SECRET; Secret Manager in production
OPENAI_API_KEY=...  # local development only; production uses Secret Manager
```

`JWT_EXPIRATION=1209600000` is 14 days.

For production, use [`cloudrun/deploy-spring.ps1`](cloudrun/deploy-spring.ps1).
It injects `OPENAI_API_KEY`, `JWT_SECRET`, and `DATABASE_PASSWORD` from Google
Secret Manager with Cloud Run `--set-secrets`; secret values are never command
arguments or ordinary environment configuration. See [`SECURITY.md`](SECURITY.md)
for setup and verification, and [`DATA_SAFETY.md`](DATA_SAFETY.md) for the Play
Console data inventory.

## Recommended Deployment Order

1. Create or select the Google Cloud project.
2. Create Cloud SQL for PostgreSQL. Schema is managed by Flyway (`spring/src/main/resources/db/migration`) and applies automatically on Spring Boot startup.
3. Create a private GCS bucket for uploaded originals.
4. Grant the OCR Cloud Run service account access to the GCS bucket.
5. Deploy OCR to Cloud Run with `GCS_BUCKET_NAME`.
6. Deploy Spring to Cloud Run with Cloud SQL and `OCR_SERVICE_URL`.
7. Build the mobile app with `EXPO_PUBLIC_API_URL` and `EXPO_PUBLIC_OCR_URL`.
8. Submit the production AAB through EAS or Google Play Console.
