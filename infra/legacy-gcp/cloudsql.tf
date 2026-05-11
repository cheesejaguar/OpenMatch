resource "google_sql_database_instance" "openmatch" {
  name             = "${var.service_name}-pg"
  database_version = "POSTGRES_16"
  region           = var.gcp_region

  settings {
    tier              = var.cloud_sql_tier
    availability_type = "REGIONAL"
    disk_autoresize   = true
    disk_size         = 20

    database_flags {
      name  = "cloudsql.enable_pgaudit"
      value = "on"
    }

    backup_configuration {
      enabled                        = true
      point_in_time_recovery_enabled = true
      backup_retention_settings {
        retained_backups = 14
      }
    }

    ip_configuration {
      ipv4_enabled    = false
      private_network = google_compute_network.vpc.id
    }

    insights_config {
      query_insights_enabled  = true
      record_application_tags = false
      record_client_address   = false
    }
  }

  deletion_protection = true

  depends_on = [
    google_service_networking_connection.private_vpc_connection,
    google_project_service.apis,
  ]
}

resource "google_sql_database" "openmatch" {
  name     = "openmatch"
  instance = google_sql_database_instance.openmatch.name
}

resource "google_sql_user" "app" {
  name     = "openmatch"
  instance = google_sql_database_instance.openmatch.name
  type     = "BUILT_IN"
}

# PostGIS isn't installed by Cloud SQL automatically.
# After `terraform apply`, run:
#   gcloud sql connect ${google_sql_database_instance.openmatch.name} --user=postgres --database=openmatch
#   CREATE EXTENSION IF NOT EXISTS postgis;
# The Prisma migration also issues `CREATE EXTENSION` and is idempotent.

resource "google_compute_network" "vpc" {
  name                    = "${var.service_name}-vpc"
  auto_create_subnetworks = true
}

resource "google_compute_global_address" "private_ip_range" {
  name          = "${var.service_name}-private-ip-range"
  purpose       = "VPC_PEERING"
  address_type  = "INTERNAL"
  prefix_length = 16
  network       = google_compute_network.vpc.id
}

resource "google_service_networking_connection" "private_vpc_connection" {
  network                 = google_compute_network.vpc.id
  service                 = "servicenetworking.googleapis.com"
  reserved_peering_ranges = [google_compute_global_address.private_ip_range.name]
}
