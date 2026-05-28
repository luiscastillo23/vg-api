# 12 — File uploads

The uploads module is a thin façade over object storage (S3 or Cloudinary). Two upload modes — direct multipart and presigned PUT — share the same authorization, validation, and persistence rules. Object URLs are stored on the owning entity; the storage provider is a configuration detail.

> Section index: [Goals](#goals) · [`StorageService` interface](#storageservice-interface) · [API](#api) · [Direct upload](#direct-upload) · [Presigned PUT](#presigned-put) · [Validation](#validation) · [Naming & paths](#naming--paths) · [Access control](#access-control) · [Lifecycle & cleanup](#lifecycle--cleanup) · [Antivirus & abuse](#antivirus--abuse) · [Local dev (MinIO)](#local-dev-minio) · [Operational concerns](#operational-concerns)

## Goals

1. **Provider-agnostic core**: nothing outside `modules/uploads/` knows whether the file went to S3 or Cloudinary.
2. **No client-trusted filenames or MIME types**: the server decides both.
3. **No raw bytes through the API for large files**: presigned URLs let the client PUT directly to the bucket.
4. **Bounded blast radius**: a leaked upload URL is short-lived (≤ 5 min) and scoped to a single key.
5. **Reversible**: we can swap providers per environment without rewriting consumers.

## `StorageService` interface

```ts
// modules/uploads/storage/storage.interface.ts
export interface IStorageService {
  readonly provider: 's3' | 'cloudinary';

  /** Upload bytes server-side. Returns the public URL + storage key. */
  upload(input: UploadInput): Promise<StoredObject>;

  /** Issue a short-lived PUT URL the client can upload to directly. */
  getPresignedUploadUrl(input: PresignInput): Promise<PresignedUpload>;

  /** Issue a short-lived GET URL for private objects. (Public objects: just return the canonical URL.) */
  getSignedReadUrl?(key: string, expiresInSec: number): Promise<string>;

  /** Delete an object. Best-effort — returns true if the provider confirmed deletion. */
  delete(key: string): Promise<boolean>;
}

export interface UploadInput {
  buffer: Buffer;
  filename: string;          // server-generated, sanitized
  mime: string;              // server-validated
  ownerId: string;           // local User.id; tagged onto the object
  scope: UploadScope;        // determines path prefix + ACL
}

export interface PresignInput {
  filename: string;
  mime: string;
  sizeBytes: number;
  ownerId: string;
  scope: UploadScope;
}

export type UploadScope = 'product-image' | 'service-image' | 'avatar' | 'chat-attachment' | 'admin-document';

export interface StoredObject {
  key: string;       // bucket-relative path, persisted for future delete
  url: string;       // public URL (or CDN URL if fronted)
}

export interface PresignedUpload extends StoredObject {
  expiresAt: Date;
  fields?: Record<string, string>;  // S3 POST-policy fields, when applicable
}
```

Implementations:

- `S3StorageService` — `@aws-sdk/client-s3` for uploads/deletes, `@aws-sdk/s3-request-presigner` for presigned URLs.
- `CloudinaryStorageService` — `cloudinary` SDK.

Selection is by `STORAGE_PROVIDER` env var; the module registers exactly one provider as `StorageService`. Consumers inject the interface, not the concrete class.

## API

| Method | Path                       | Auth                     | Description                                                     |
| ------ | -------------------------- | ------------------------ | --------------------------------------------------------------- |
| POST   | `/uploads/images`          | Authenticated (Clerk)    | Direct multipart upload. Image files only (jpg/png/webp).        |
| POST   | `/uploads/presign`         | Admin                    | Issues a presigned PUT URL. Body: `{ filename, mime, sizeBytes, scope }`. |
| DELETE | `/uploads/:key`            | Admin                    | Deletes an object. `key` is URL-encoded.                         |

Returned shape (direct upload):

```json
{
  "success": true,
  "data": { "key": "products/abc/...", "url": "https://cdn.example.com/products/abc/..." }
}
```

Returned shape (presign):

```json
{
  "success": true,
  "data": {
    "key": "products/abc/...",
    "url": "https://cdn.example.com/products/abc/...",
    "uploadUrl": "https://s3.amazonaws.com/...?X-Amz-Signature=...",
    "expiresAt": "2026-05-27T19:05:12.000Z"
  }
}
```

## Direct upload

Use this for small files (≤ 5 MB by default — config).

```
POST /uploads/images        multipart/form-data
  fields:
    file:  <binary>          (one file per request)
    scope: 'product-image'   (must match UploadScope)
  ↓
ClerkAuthGuard, optional @Roles for admin-only scopes
  ↓
UploadsController.uploadImage(@UploadedFile() file, @CurrentUser() user, @Body('scope'))
  ↓
UploadsService.uploadImage({ file, user, scope })
  1. Validate MIME by magic bytes (not the client-reported Content-Type).
  2. Validate sizeBytes ≤ scope.maxBytes.
  3. Reject if dimensions out of range (e.g. product image > 4000×4000).
  4. Generate filename: <cuid>.<extFromMime>.
  5. storage.upload({ buffer, filename, mime, ownerId, scope })
  6. Return { key, url }
```

Multipart parsing in Fastify: `@fastify/multipart` registered with `limits.fileSize = SCOPE_MAX_BYTES`. Nest's `FileInterceptor` works on top of this — see Nest docs for the Fastify-specific wiring.

## Presigned PUT

Use this for large files (admin uploading product image bundles, support attaching documents, etc.) or to keep bytes off the API server entirely.

```
POST /uploads/presign { filename, mime, sizeBytes, scope }
  ↓
ClerkAuthGuard + @Roles
  ↓
UploadsService.getPresignedUploadUrl(user, dto)
  1. Validate MIME against scope's allowlist.
  2. Validate sizeBytes ≤ scope.maxBytes.
  3. key = makeKey(scope, user.id, dto.filename)
  4. presigned = storage.getPresignedUploadUrl({ key, mime, sizeBytes, expiresInSec: 300 })
  5. Return { key, url, uploadUrl, expiresAt }
  ↓
Client PUTs the bytes directly to `uploadUrl` (S3) or POSTs with `fields` (Cloudinary signed POST).
  ↓
Client persists `key` on the owning entity (Product, ChatAttachment, …) via the entity's normal PATCH endpoint.
```

The presigned URL expires in 5 minutes. Don't make it longer — once issued, you cannot revoke it.

## Validation

`UploadScope` config table (lives in `modules/uploads/scope-config.ts`):

| Scope               | Roles allowed       | MIME allowlist                  | Max size | Max dimensions | Path prefix        |
| ------------------- | ------------------- | -------------------------------- | -------- | -------------- | ------------------ |
| `product-image`     | Admin, Manager      | image/jpeg, image/png, image/webp | 5 MB     | 4000×4000      | `products/`        |
| `service-image`     | Admin, Manager      | image/jpeg, image/png, image/webp | 5 MB     | 4000×4000      | `services/`        |
| `avatar`            | Authenticated       | image/jpeg, image/png, image/webp | 2 MB     | 1024×1024      | `avatars/<userId>/` |
| `chat-attachment`   | Authenticated       | image/*, application/pdf         | 10 MB    | n/a            | `chat/<convId>/`   |
| `admin-document`    | Admin               | application/pdf                  | 25 MB    | n/a            | `admin/`           |

MIME validation is done by magic-byte inspection (`file-type` package or equivalent). Trusting the client-reported `Content-Type` is the single most common upload-handling bug.

## Naming & paths

```ts
function makeKey(scope: UploadScope, ownerId: string, originalFilename: string): string {
  const ext = path.extname(originalFilename).toLowerCase().replace(/^\./, '');
  const prefix = SCOPE_CONFIG[scope].pathPrefix; // e.g. 'products/'
  const id = cuid();
  return scope === 'avatar' || scope === 'chat-attachment'
    ? `${prefix}${id}.${ext}`           // already includes owner in prefix
    : `${prefix}${ownerId}/${id}.${ext}`; // owner segment for traceability
}
```

Never echo the client-supplied filename in the key. CDN paths leak through logs, screenshots, and analytics — they should never embed an email address, name, or sensitive ID.

## Access control

- **Read**: public bucket / public Cloudinary delivery is the default for catalog images. Private scopes (`admin-document`, support `chat-attachment`) use `getSignedReadUrl` issued by the service that owns the entity.
- **Write**: only through the API, gated by the scope's role allowlist.
- **Tagging**: every object is tagged `owner=<userId>` and `scope=<scope>` so a leaked URL can be traced to its author via the bucket's tag-based audit.

## Lifecycle & cleanup

- **Orphan sweep**: objects without a referencing row (e.g. a presigned PUT that succeeded but the client never persisted the key) are deleted after 24 h by a daily job that compares bucket listings against the persisted keys.
- **Entity deletion**: when an entity referencing an upload is deleted, the owning module calls `StorageService.delete(key)`. This is a best-effort step *after* the DB transaction — a transient storage error doesn't roll the delete back. Orphan sweep catches the leftover.
- **Versioning**: enabled at the bucket level (S3 versioning / Cloudinary auto-versions). Recovering an accidentally overwritten object is possible up to N days (config — default 30).

## Antivirus & abuse

- For user-generated attachments (`chat-attachment`, `admin-document`), enable bucket-side AV scanning (S3: Macie/GuardDuty + Lambda; Cloudinary: built-in moderation flag). A failed scan moves the object to a quarantine prefix and writes a `Notification` to the uploader.
- Avatar/product images use perceptual hashing in a background job to flag duplicate or known-bad images.
- Rate-limit uploads per user: default `THROTTLE_LIMIT / 4` on the upload routes (see [06-infrastructure.md#throttler-tuning](./06-infrastructure.md#throttler-tuning)).

## Local dev (MinIO)

S3 in dev is heavyweight. Drop a MinIO container into `docker-compose.yml` when uploads are wired:

```yaml
minio:
  image: minio/minio
  command: server /data --console-address ":9001"
  environment:
    MINIO_ROOT_USER: vg
    MINIO_ROOT_PASSWORD: vg-dev-secret
  ports: ['9000:9000', '9001:9001']
  volumes: ['minio_data:/data']
```

Set `AWS_S3_ENDPOINT=http://localhost:9000` and `AWS_S3_FORCE_PATH_STYLE=true` in the dev `.env`. The S3 SDK speaks to MinIO over the same wire protocol.

Cloudinary has no local emulator — use a free Cloudinary account scoped to a dev environment.

## Operational concerns

- **Bucket region**: same region as the API, or use a multi-region CDN in front. Latency for image-heavy catalog pages will swamp everything else if you cross-region for every read.
- **CORS**: bucket CORS must allow the storefront origin for direct PUTs to work — see the deployment runbook.
- **CDN**: front the bucket with CloudFront / Cloudinary's CDN. Configure long `Cache-Control` for content-hashed paths; short cache for `latest/` aliases (if any).
- **Cost**: log size + count uploaded per day per scope. A misconfigured scope (or a bot) can rack up bills overnight.

## Cross-references

- [04-api-rest.md](./04-api-rest.md) — `/uploads/*` surface
- [05-patterns.md#strategy-pattern](./05-patterns.md#strategy-pattern) — storage strategy
- [06-infrastructure.md#storage](./06-infrastructure.md#storage) — env vars
- [15-security.md](./15-security.md) — abuse / threat surface
- [`s3-outage.md`](../runbooks/s3-outage.md) — storage-down runbook
