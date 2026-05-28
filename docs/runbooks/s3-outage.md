# Runbook — S3 (storage) outage

> **Symptom shorthand**: Uploads fail; images on product pages show broken-image icons; admin can't generate exports; `POST /api/v1/uploads/*` returns 5xx.

> Related: [`../architecture/12-uploads.md`](../architecture/12-uploads.md), [`../architecture/14-reports.md`](../architecture/14-reports.md), [`incident-template.md`](./incident-template.md).

## Symptoms

| Signal                                                          | What it usually means                                  |
| --------------------------------------------------------------- | ------------------------------------------------------ |
| Upload route 5xx spike                                          | Direct call to S3 / Cloudinary failing.                |
| Storefront showing broken image placeholders                    | CDN can't reach origin, OR the image URL itself is bad. |
| Admin export polling returns `status: 'failed'`                 | The export job couldn't write its output.              |
| AWS Health Dashboard / Cloudinary status page red               | Direct confirmation of provider outage.                |
| `s3.send()` timeouts in app logs                                 | Network path to provider degraded.                     |

## First 2 minutes — scope it

1. **Is it us or the provider?**

   - AWS status: https://health.aws.amazon.com/health/status
   - Cloudinary status: https://status.cloudinary.com

   If either is yellow/red for our region or service — confirmed provider outage. Skip to [Provider outage](#provider-outage).

2. **Is it just one bucket / region?**

   - Hit the bucket directly: `aws s3 ls s3://<bucket>` (from an instance with creds) → ListBucket either works (config issue) or times out (provider).
   - Try a different operation: read vs write — sometimes writes fail while reads work, or vice versa.

3. **Are credentials valid?**

   ```
   aws sts get-caller-identity
   ```

   `ExpiredToken` / `InvalidClientTokenId` → credential rotation went wrong. Jump to [Credential rotation gone wrong](#credential-rotation-gone-wrong).

4. **Is it network / VPC?**

   - From an API instance: `curl -v https://s3.<region>.amazonaws.com` → if the TCP connect fails, it's network, not S3.
   - Likely cause: a security group / VPC endpoint change. Roll back the change.

## Provider outage

Customer-visible degradation is the main concern. The product can mostly survive a storage outage if reads continue to work (CDN still serving cached images).

### Mitigations

1. **Disable upload routes** to stop user-facing 5xx:

   - Flip the `UPLOADS_ENABLED` flag (if wired) to `false`. Routes return `503 Service Unavailable` with a clear message and `Retry-After: 600`.
   - If no flag exists yet, add a temporary global rate-limit of 0 on `POST /api/v1/uploads/*` via the runtime config.

2. **Communicate**

   - Status page: "Image uploads are temporarily unavailable due to a third-party storage outage. Reads (product images) continue to work normally."
   - Slack `#customer-support`: same message + Zendesk macro link.

3. **Queue admin exports** instead of failing them:

   - `POST /reports/exports` should already enqueue large jobs. Confirm the export processor is idle (it'll retry when storage recovers).
   - If sync exports are hitting storage directly and failing, switch them to async behind the same flag.

4. **Wait it out**

   - AWS outages typically resolve in tens of minutes to hours. Polling AWS Health every ~15 min is enough; don't sit on it.
   - Once provider reports recovery, run the smoke checks below before flipping the flag back.

### Recovery checks

After provider reports recovery:

```bash
# Write
echo "ok" | aws s3 cp - s3://<bucket>/healthcheck/$(date +%s).txt
# Read
aws s3 cp s3://<bucket>/healthcheck/<key>.txt -

# Presigned PUT
aws s3 presign --expires-in 60 s3://<bucket>/healthcheck/$(date +%s).put
# (curl the presigned URL with `--upload-file` to confirm)
```

All three pass → flip the upload flag back on; monitor error rate.

## Credential rotation gone wrong

A rotation that wasn't deployed in lockstep with the secret update.

### Mitigations

1. Roll back the rotation: in the secret manager, restore the previous valid credentials. AWS doesn't immediately invalidate the previous access key — the old key works for ~1 minute after deletion (don't rely on this, but it gives you a window).
2. Restart instances so they re-read the secret. Most apps cache credentials per instance start.
3. Confirm `aws sts get-caller-identity` returns the expected ARN from a fresh instance.
4. Re-plan the rotation: deploy the new credentials to the secret manager **first**, restart instances, **then** delete the old credentials in IAM. Never the reverse.

## DNS / region misconfiguration

The bucket exists, credentials are valid, but the SDK is pointed at the wrong region or endpoint.

Common after a deploy that touched `AWS_REGION` or `AWS_S3_ENDPOINT`:

1. Verify env vars: `AWS_REGION`, `AWS_S3_BUCKET`, `AWS_S3_ENDPOINT` (the last is only set for MinIO / LocalStack — should be empty in production).
2. Roll back the offending deploy.
3. Tighten the env validator (`@nestjs/config` Joi schema) to reject `AWS_S3_ENDPOINT` being set in `NODE_ENV=production`.

## CORS or signed-URL failure

Symptoms: presigned PUT succeeds server-side (we return the URL), but the browser PUT fails with CORS error.

1. Verify the bucket CORS policy includes our storefront origin and headers (`Content-Type`, `Content-MD5`, `x-amz-acl` if used).
2. Bucket CORS is configured **once** per environment. If a recent infra change touched it, restore.
3. For Cloudinary, equivalent is the upload preset's allowed origins.

## Long outage — graceful degradation

For an outage > 30 min:

- **Catalog images**: CDN cache typically holds catalog images for hours. Users see most products normally. New product images won't display until cache expiry, but that's tolerable.
- **Avatars**: same; default avatar served from CDN as a fallback.
- **Chat attachments**: users see "Attachment unavailable" with a retry button. The message body still delivers.
- **Reports / exports**: queued. They generate when storage recovers.
- **Order completion**: unaffected (we don't write to storage during checkout).

If the outage drags past hours and storefront degradation becomes serious, consider a temporary fallback (Cloudinary if S3 is down, or vice versa) — but only if the strategy pattern has both adapters wired. **This is not a quick switch**; it requires the bucket to already have the data mirrored. We don't currently mirror between providers.

## Resolve

- Provider status page green.
- Smoke checks (write/read/presign) all pass.
- Upload routes re-enabled; no 5xx in 10 min.
- Export queue drained.

## Postmortem follow-ups (common)

- Add an alert: "Storage write error rate > 1% over 5 min".
- Add a synthetic monitor: every 5 min, presign + PUT a 1 KB file from an external runner.
- Re-evaluate cross-provider mirror as a long-outage hedge — usually not worth the cost, but document the decision.
- Confirm CDN cache TTL on catalog images is long enough to survive a typical provider incident (≥ 1 h).

## Reference

- [`12-uploads.md`](../architecture/12-uploads.md) — uploads architecture
- [`14-reports.md`](../architecture/14-reports.md) — export pipeline
- [`../architecture/06-infrastructure.md#storage`](../architecture/06-infrastructure.md#storage) — storage config
