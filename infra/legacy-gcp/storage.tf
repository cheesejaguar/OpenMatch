resource "google_storage_bucket" "photos" {
  name                        = "${var.gcp_project}-${var.service_name}-photos"
  location                    = var.gcp_region
  storage_class               = "STANDARD"
  uniform_bucket_level_access = true
  force_destroy               = false

  versioning {
    enabled = false
  }

  # Photos must never be served publicly — the app issues short-lived
  # signed URLs (15-minute TTL by default). Public access prevention is
  # enforced at the org level too.
  public_access_prevention = "enforced"

  lifecycle_rule {
    condition {
      age = 730
    }
    action {
      type = "Delete"
    }
  }

  cors {
    origin          = ["https://app.openmatch.example"]
    method          = ["GET", "PUT", "HEAD"]
    response_header = ["Content-Type", "Content-Length"]
    max_age_seconds = 3600
  }

  depends_on = [google_project_service.apis]
}

resource "google_storage_bucket_iam_binding" "app_writer" {
  bucket = google_storage_bucket.photos.name
  role   = "roles/storage.objectAdmin"
  members = [
    "serviceAccount:${google_service_account.run.email}",
  ]
}
