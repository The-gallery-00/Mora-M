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

## Production Environment Variables

### OCR Cloud Run

```text
GCS_BUCKET_NAME=mora-mobile-uploads
GCS_UPLOAD_PREFIX=uploads
MORA_UPLOAD_DIR=/tmp/mora-uploads
```

`GCS_BUCKET_NAME` enables durable image storage. The OCR service still uses a
temporary local file so PaddleOCR can read the image, then uploads the original
to GCS. App-facing image URLs remain `/uploads/{file}` and are served back by
the OCR service, so the GCS bucket can stay private.

### Spring Cloud Run

```text
DATABASE_URL=jdbc:postgresql:///mora?cloudSqlInstance=PROJECT_ID:asia-northeast3:mora-mobile-db&socketFactory=com.google.cloud.sql.postgres.SocketFactory&cloudSqlRefreshStrategy=lazy&stringtype=unspecified
DATABASE_USERNAME=mora
DATABASE_PASSWORD=...
JWT_SECRET=...
JWT_EXPIRATION=1209600000
OCR_SERVICE_URL=https://mora-mobile-ocr-xxxxx.a.run.app
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
2. Create Cloud SQL for PostgreSQL and apply `db/init.sql`.
3. Create a private GCS bucket for uploaded originals.
4. Grant the OCR Cloud Run service account access to the GCS bucket.
5. Deploy OCR to Cloud Run with `GCS_BUCKET_NAME`.
6. Deploy Spring to Cloud Run with Cloud SQL and `OCR_SERVICE_URL`.
7. Build the mobile app with `EXPO_PUBLIC_API_URL` and `EXPO_PUBLIC_OCR_URL`.
8. Submit the production AAB through EAS or Google Play Console.
