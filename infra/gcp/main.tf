terraform {
  required_version = ">= 1.5.0"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 7.31"
    }
  }
}

provider "google" {
  project = var.gcp_project
  region  = var.gcp_region
}

# Enable the APIs we'll use.
resource "google_project_service" "apis" {
  for_each = toset([
    "run.googleapis.com",
    "sqladmin.googleapis.com",
    "redis.googleapis.com",
    "storage.googleapis.com",
    "secretmanager.googleapis.com",
    "iamcredentials.googleapis.com",
    "servicenetworking.googleapis.com",
  ])
  project            = var.gcp_project
  service            = each.value
  disable_on_destroy = false
}
