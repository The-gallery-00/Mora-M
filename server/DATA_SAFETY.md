# Google Play Data safety inventory

This inventory describes the backend currently present in this repository. It
is an engineering input for the Play Console declaration, not legal advice.
Re-check it against the production build, privacy policy, enabled features,
third-party SDKs, retention policy, and actual Google Cloud configuration before
submission.

## Data stored by MORA

| Play data category | Concrete fields/content | Storage | Purpose | Deletion/retention today |
|---|---|---|---|---|
| Personal info: email address | account `email`; email recognized from a business card | PostgreSQL `users`, `business_cards` | account management; card organization/search | account deletion removes the user and owned cards; no automatic TTL |
| Personal info: name | account display name; card holder name | PostgreSQL | account profile; card organization/search | removed with account/card deletion; no automatic TTL |
| Personal info: phone number | phone/fax recognized from cards | PostgreSQL | card organization/search | removed with card/account deletion; no automatic TTL |
| Work/professional info | company and position/title | PostgreSQL | card organization/search | removed with card/account deletion; no automatic TTL |
| User IDs | random account UUID and card UUID | PostgreSQL; JWT claims | ownership, authentication and record lookup | user/card rows are deleted; issued JWTs expire but are not server-revoked |
| Photos and files | uploaded business-card/document original | private GCS in production; local upload volume in development | OCR, review and later display | individual card deletion and account deletion both invoke image deletion; no automatic TTL |
| User content | raw OCR text and corrected card fields | PostgreSQL; temporary OCR processing memory/disk | OCR result, editing and semantic search | removed with card/account deletion; no automatic TTL |
| Derived data | 1536-dimensional embedding vector | PostgreSQL `business_cards.embedding` | semantic card search | removed with card/account deletion |
| Credentials | BCrypt password hash for local accounts | PostgreSQL `users.password_hash` | authentication | removed with account deletion; plaintext passwords are not stored |
| Authentication information | signed JWT containing user UUID and email | client secure storage; transmitted in `Authorization` header | authenticated API access | expires according to `JWT_EXPIRATION`; backend does not store the token |
| Operational metadata | Cloud Run/platform request metadata such as timestamp, route, status, latency, IP/user-agent where enabled by Google Cloud | Google Cloud Logging | reliability, security and abuse monitoring | governed by the configured Cloud Logging retention policy |

Scanned cards can contain third-party personal data. The product flow and
privacy policy must require the uploader to have authority to process it.

## Data transmitted outside the mobile app

| Destination | Data transmitted | Why | Storage note |
|---|---|---|---|
| Spring API (MORA backend) | account email/password during authentication; JWT; card fields; search query; uploaded image | core app service | password is immediately verified/hashed; request bodies and credentials must not be logged |
| OCR FastAPI service | uploaded original image and original filename/content type | text recognition and image persistence | image is processed on temporary/local disk and persisted to GCS when configured |
| Google Cloud SQL | account/profile data, password hash, card fields, OCR text, image URL, embedding | durable application database | private production database; encryption/access controls depend on GCP configuration |
| Google Cloud Storage | original uploaded image plus generated opaque object name and content type | durable image storage | bucket is intended to remain private; OCR service proxies reads |
| OpenAI Embeddings API | card name, company, position, phone, email, raw OCR text; or a user's semantic search query | create vectors for semantic search | no image, password, JWT, account UUID, or OpenAI key is placed in the request body |
| Google Cloud Logging | operational metadata and explicitly emitted metadata-only application errors | operations/security | application safeguards prohibit bodies, OCR values, credentials and secrets |

The OpenAI transfer includes personal and potentially user-provided content.
That third-party processing must be disclosed consistently in the privacy
policy and Play Data safety answers. Confirm OpenAI account data controls and
retention terms applicable to the production account before submission.

## Play Console preparation checklist

- Mark applicable collected categories: email address, name, phone number,
  photos/files, user IDs, and other user-generated/professional content.
- Mark data as transmitted off device because it is sent to MORA servers,
  Google Cloud services, and OpenAI.
- Declare purposes that actually apply: app functionality, account management,
  and security/operations. Do not claim advertising or analytics unless added.
- Confirm TLS is enforced for every production endpoint; local HTTP development
  does not satisfy encrypted-in-transit production requirements.
- Confirm account deletion is reachable in the released app and verify deletion
  of database rows and every GCS object.
- Define and configure retention periods for database backups, GCS versions,
  Cloud Logging, and temporary OCR objects; the repository currently provides
  no universal automatic retention policy.
- Re-run this inventory whenever new document types, OAuth, calendar, analytics,
  crash reporting, notifications, or advertising SDKs are enabled.
