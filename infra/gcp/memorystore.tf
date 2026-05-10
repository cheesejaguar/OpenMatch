resource "google_redis_instance" "openmatch" {
  name           = "${var.service_name}-redis"
  tier           = "BASIC"
  memory_size_gb = var.redis_memory_gb
  region         = var.gcp_region

  redis_version           = "REDIS_7_0"
  authorized_network      = google_compute_network.vpc.id
  connect_mode            = "PRIVATE_SERVICE_ACCESS"
  auth_enabled            = true
  transit_encryption_mode = "SERVER_AUTHENTICATION"

  depends_on = [
    google_service_networking_connection.private_vpc_connection,
    google_project_service.apis,
  ]
}
