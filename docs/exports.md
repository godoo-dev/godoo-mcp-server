# Configure private result artifacts

Configure an existing private bucket for artifact delivery from
[`record_search` and `record_read`](api.md#private-result-delivery). Their
`max_return_bytes` argument defaults to 500 bytes; larger results use storage.
`0` forces artifact delivery and `null` returns the full result inline. The server uses
[obstore](https://developmentseed.org/obstore/latest/) for uploads and temporary
signed GET URLs across R2, S3 and GCS. Credentials are server configuration;
callers cannot select providers, buckets, object keys or credentials.

The configuration below is a source-level setup example. No live provider or
deployed caller path has been qualified by this change.

## Bucket access and retention

Two optional server settings control the timing, in whole minutes:

- `ODOO_EXPORT_URL_TTL_MINUTES`: signed URL lifetime, default `60`; allowed range
  `1`–`10080` (the providers' seven-day signing limit).
- `ODOO_EXPORT_CLEANUP_GRACE_MINUTES`: time retained beyond the URL lifetime,
  default `30`; zero or a positive integer.

With the defaults, objects become eligible for deletion 90 minutes after upload.
Signed GET URLs remain reusable until expiry; they are not single-use links.
The signing clock starts immediately before upload. Retention starts from the
provider's completed-upload timestamp, so a slow upload cannot cause deletion
before the URL expires plus the configured grace. Receipts include `delete_after`.

The server lists its versioned `exports/v1/` namespace at startup and after each
60-second pause, deleting eligible managed objects. Each key records its original
retention duration; the provider timestamp completes the durable deadline.
Restarting the process or reducing the configuration does not shorten retention
for existing exports. The worker logs safe failure events and retries on later
sweeps; it stops with the server. Under normal operation deletion occurs within
roughly a minute of eligibility, plus sweep duration. Downtime or provider errors
delay deletion; overdue objects are retried after recovery. If you change buckets
or providers, keep cleanup running for the old bucket until its exports are gone.

Keep public access disabled and restrict the server identity to the selected
bucket's `exports/` prefix. It needs upload, read/sign, metadata, delete, and
prefix-scoped list permissions. Large uploads also need the provider's multipart
permissions. No bucket creation or public ACL is requested. Use a dedicated,
unversioned export bucket; versioned buckets can retain older bytes after deletion.
Keep the bucket private even after URLs expire.

Optional bucket lifecycle rules can provide a coarse fallback during prolonged
downtime and abort incomplete multipart uploads. Their day-based/asynchronous
deletion is not the 90-minute cleanup mechanism. The server does not install or
inspect lifecycle rules. URL expiry itself does not delete data. The server
removes its temporary local file on completion/failure and attempts to remove
this request's object after delivery failure. Interrupted processes leave managed
objects for the next sweep; incomplete multipart uploads require the provider's
abort policy. Missing provider/bucket or invalid timing settings fail closed.

## Cloudflare R2

Use the R2 S3 API endpoint, rather than a public bucket URL or custom domain.
Supply an R2 API access key with the bucket scope described above through the
deployment's secret mechanism. Example nonsecret configuration:

```sh
export ODOO_EXPORT_PROVIDER=r2
export ODOO_EXPORT_BUCKET=private-exports
export ODOO_EXPORT_ENDPOINT=https://YOUR_ACCOUNT_ID.r2.cloudflarestorage.com
export ODOO_EXPORT_URL_TTL_MINUTES=60
export ODOO_EXPORT_CLEANUP_GRACE_MINUTES=30
```

Set `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` privately. R2 selects region
`auto` and path-style addressing. The signed URL uses the same HTTPS endpoint
and must be reachable by the caller's calculation environment. No public access
or custom download gateway is required.

## Amazon S3

```sh
export ODOO_EXPORT_PROVIDER=s3
export ODOO_EXPORT_BUCKET=private-exports
export AWS_REGION=eu-west-1
export ODOO_EXPORT_URL_TTL_MINUTES=60
export ODOO_EXPORT_CLEANUP_GRACE_MINUTES=30
```

Use obstore's [AWS credential configuration](https://developmentseed.org/obstore/latest/api/store/aws/),
such as privately supplied `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` and, for
temporary credentials, `AWS_SESSION_TOKEN`, or a supported workload identity.
Ensure credentials remain valid for the download lifetime. For another compatible
S3 service, set `ODOO_EXPORT_ENDPOINT` to its reachable HTTPS API endpoint.
It overrides the SDK's environment endpoint settings. Clear any inherited endpoint
variables when targeting Amazon's service directly. Anonymous signing is disabled.

## Google Cloud Storage

```sh
export ODOO_EXPORT_PROVIDER=gcs
export ODOO_EXPORT_BUCKET=private-exports
export ODOO_EXPORT_URL_TTL_MINUTES=60
export ODOO_EXPORT_CLEANUP_GRACE_MINUTES=30
export GOOGLE_SERVICE_ACCOUNT=/run/secrets/export-service-account.json
```

Mount a service-account JSON file with signing credentials and the required bucket
permissions. Obstore also accepts `GOOGLE_SERVICE_ACCOUNT_KEY` through the secret
mechanism. Use [obstore's GCS configuration](https://developmentseed.org/obstore/latest/api/store/gcs/)
for credential details. A credential that can upload does not necessarily support
URL signing; a static OAuth bearer token alone is insufficient for this flow.
Anonymous signing is disabled.

## Download in calculation code

Have the host pass the receipt as a code input without persisting its signed URL
in evidence. This Python example assumes `receipt` contains that tool result and
`destination` is a workspace `pathlib.Path` selected by the calculation code:

```python
import hashlib
import urllib.request

digest = hashlib.sha256()
size = 0
try:
    with urllib.request.urlopen(receipt["download_url"], timeout=60) as response:
        with destination.open("wb") as output:
            while chunk := response.read(1024 * 1024):
                size += len(chunk)
                if size > receipt["size_bytes"]:
                    raise ValueError("Export size mismatch")
                digest.update(chunk)
                output.write(chunk)
    if size != receipt["size_bytes"] or digest.hexdigest() != receipt["sha256"]:
        raise ValueError("Export integrity check failed")
except Exception:
    destination.unlink(missing_ok=True)
    raise RuntimeError("Export download failed") from None
```

Do not print the receipt, URL, response body or dataset. Parse the saved JSON result
object in calculation code and return only the requested aggregate or bounded rows.
A successful download proves those bytes were reachable at that moment; it does
not prove expiry or access isolation. Before rollout, qualify the selected live
provider and host: checksum/count agreement, private access rejection without a
capability, a different object's rejection, bearer-access scope, actual configured
expiry, timed deletion/recovery, and absence of rows in the calling model's context.
