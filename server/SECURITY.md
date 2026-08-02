# Server security operations

## Logging policy

Production logs must never contain request or response bodies, uploaded image
contents, OCR text, names, email addresses, phone numbers, passwords, JWTs,
OAuth codes, API keys, `Authorization` headers, or secret values.

Implemented safeguards:

- Spring request-detail logging and Tomcat access logging are disabled.
- Hibernate SQL and bind-value logging are disabled.
- Spring error responses never include exception messages or stack traces.
- OpenAI failures log only the exception class, not the HTTP exception message.
- entity `toString()` output contains identifiers only.
- OCR failures return a generic message and log only the exception class.
- OCR command-line diagnostics output field counts, never recognized values.

Cloud Run request logs are platform metadata logs. Do not place personal data,
JWTs, OAuth codes, or secrets in URL paths or query strings because URLs may be
recorded by the platform independently of application logging.

## Secret Manager

Production secrets are injected into Cloud Run directly from Google Secret
Manager. They must not be passed with `--set-env-vars`, committed to an env
file, embedded in an image, or printed by CI.

Required secrets:

| Secret Manager secret | Runtime variable | Purpose |
|---|---|---|
| `mora-openai-api-key` | `OPENAI_API_KEY` | OpenAI embeddings |
| `mora-jwt-secret` | `JWT_SECRET` | JWT signing |
| `mora-database-password` | `DATABASE_PASSWORD` | Cloud SQL login |

Grant the Cloud Run runtime service account
`roles/secretmanager.secretAccessor` on only these secrets. Create secret
versions through the Google Cloud Console or a protected CI secret source; do
not paste values into repository scripts.

Deploy with `cloudrun/deploy-spring.ps1`. The script accepts secret *names* and
explicit version numbers only, then maps those versions with Cloud Run
`--set-secrets`. Increment the version parameters during secret rotation; do
not use the mutable `latest` alias in production.

Local development may use `server/spring/.env`, which is gitignored. The
checked-in `.env.example` contains placeholders only. `JWT_SECRET` is required
at startup and has no insecure application default.

## Verification checklist

1. Search Cloud Logging for `Bearer `, JWT-shaped strings, `password`,
   `OPENAI_API_KEY`, and representative test email/phone values.
2. Trigger failed login, invalid JWT, OCR failure, and OpenAI failure paths.
3. Confirm logs contain only status/exception type and no submitted values.
4. Confirm the Cloud Run revision lists the three variables as secret-backed.
5. Rotate each secret and deploy a new revision without changing source code.
