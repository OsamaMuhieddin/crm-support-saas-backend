# Files v1 Local MinIO Setup

## 1) Start MinIO (official image)

```bash
docker compose -f docker-compose.minio.yml up -d
```

This uses the official `minio/minio:latest` image with persistent volume `minio_data`.

## 2) Access URLs

- MinIO API: `http://localhost:9000`
- MinIO Console: `http://localhost:9011`

Credentials are read from:

- `MINIO_ROOT_USER`
- `MINIO_ROOT_PASSWORD`
- Optional host port overrides: `MINIO_API_PORT`, `MINIO_CONSOLE_PORT`

## 3) Create bucket (private)

1. Sign in to `http://localhost:9011`.
2. Create bucket using `S3_BUCKET` value (for example `crm-support-files`).
3. Leave bucket private (default).
4. Do not apply anonymous read/write policies.

## 4) Backend env values

```env
STORAGE_PROVIDER=minio
S3_ENDPOINT=127.0.0.1
S3_PORT=9000
S3_USE_SSL=false
S3_ACCESS_KEY=minioadmin
S3_SECRET_KEY=minioadmin123
S3_BUCKET=crm-support-files
S3_REGION=us-east-1
S3_FORCE_PATH_STYLE=true
MAX_FILE_SIZE_BYTES=10485760
FILES_ALLOWED_MIME_TYPES=application/pdf,image/jpeg,image/png,text/plain,application/zip
FILES_ALLOWED_EXTENSIONS=.pdf,.jpg,.jpeg,.png,.txt,.zip
FILES_UPLOAD_RATE_LIMIT_WINDOW_SECONDS=60
FILES_UPLOAD_RATE_LIMIT_MAX=20
FILES_DOWNLOAD_RATE_LIMIT_WINDOW_SECONDS=60
FILES_DOWNLOAD_RATE_LIMIT_MAX=120
```

## 5) v1 API behavior note

- Upload is backend multipart: `POST /api/files`
- Download is backend-streamed: `GET /api/files/:fileId/download`
- Public clients never receive permanent raw MinIO object URLs.
