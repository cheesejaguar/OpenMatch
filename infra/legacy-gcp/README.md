# OpenMatch — GCP infrastructure (LEGACY — DEPRECATED)

> **Deprecated.** OpenMatch's backend has migrated to Vercel + Neon + Upstash + Vercel Blob + Ably. This directory is kept for one release cycle as a reference for the prior architecture and to support data migration off Cloud SQL. New deployments should follow the Vercel setup in the root `README.md`. These Terraform files will be deleted after the GCP project is fully decommissioned.


Terraform to deploy OpenMatch on Google Cloud. All resources are cloud-native: Cloud Run for the API, Cloud SQL (Postgres 16 + PostGIS) for the database, Memorystore (Redis) for cache and rate limits, and Cloud Storage for photo blobs.

Local development does **not** require GCP — `docker-compose up` at the repo root brings up Postgres+PostGIS+Redis+MailHog and the backend will use those automatically. This infrastructure exists only for hosted deployments.

## What it provisions

- **VPC** with private service access for Cloud SQL and Memorystore.
- **Cloud SQL** Postgres 16 (regional HA), 14-day PITR, private IP only.
- **Memorystore** Redis 7 with AUTH and in-transit encryption.
- **Cloud Storage** bucket for photos, public-access prevention enforced. CORS for the iOS app's signed-URL uploads.
- **Service account** for Cloud Run with least-privilege bindings.
- **Secret Manager** entries for `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`.
- **Cloud Run v2** service running the API container.

## First-time setup

```bash
gcloud auth application-default login
gcloud auth configure-docker us-central1-docker.pkg.dev

terraform init
terraform plan  -var="gcp_project=YOUR_PROJECT"
terraform apply -var="gcp_project=YOUR_PROJECT"
```

After `apply`:

1. Install PostGIS in the new Cloud SQL instance (one-time):

   ```bash
   gcloud sql connect openmatch-pg --user=postgres --database=openmatch
   CREATE EXTENSION IF NOT EXISTS postgis;
   ```

2. Populate Secret Manager values:

   ```bash
   gcloud secrets versions add openmatch-database-url --data-file=- <<< "postgresql://openmatch:PASSWORD@/openmatch?host=/cloudsql/INSTANCE_CONNECTION_NAME"
   gcloud secrets versions add openmatch-redis-url   --data-file=- <<< "redis://:AUTH@HOST:6378"
   gcloud secrets versions add openmatch-jwt-secret  --data-file=- <<< "$(openssl rand -hex 48)"
   ```

3. Push the API image and run migrations:

   ```bash
   docker build -t us-central1-docker.pkg.dev/$PROJECT/openmatch/api:latest -f backend/Dockerfile .
   docker push     us-central1-docker.pkg.dev/$PROJECT/openmatch/api:latest

   # From your laptop with cloud-sql-proxy running:
   DATABASE_URL=... npx prisma migrate deploy --schema backend/prisma/schema.prisma
   ```

## Cost notes

`db-custom-2-7680` Cloud SQL + Memorystore basic 1GB + Cloud Run on-demand is roughly the floor for a low-traffic deployment. Scale up before launch — Cloud SQL is the dominant fixed cost.

## What's NOT in here

- CDN in front of the photo bucket — add CloudCDN once traffic patterns are known.
- Cloud Armor / WAF rules — add for production launch.
- A dedicated VPC service-control perimeter — add when handling production user data.
- APNs setup for push — handled via the Apple developer console, not Terraform.

These are intentionally deferred so the floor cost stays low while the project is in early development.
