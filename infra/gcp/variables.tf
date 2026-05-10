variable "gcp_project" {
  type        = string
  description = "GCP project id."
}

variable "gcp_region" {
  type        = string
  default     = "us-central1"
  description = "Primary deployment region."
}

variable "service_name" {
  type    = string
  default = "openmatch"
}

variable "cloud_sql_tier" {
  type        = string
  default     = "db-custom-2-7680"
  description = "Cloud SQL machine type. PostGIS works on standard Postgres tiers."
}

variable "redis_memory_gb" {
  type    = number
  default = 1
}
