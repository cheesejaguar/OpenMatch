# OpenMatch convenience targets. See docs/self-hosting.md for the
# full walkthrough.

# Use bash so we get pipefail + && short-circuit consistently.
SHELL := /bin/bash
.SHELLFLAGS := -eu -o pipefail -c

# Compose v2 (`docker compose`) is required.
COMPOSE := docker compose

.DEFAULT_GOAL := help

.PHONY: help up up-services up-full down seed migrate dev test test-backend test-matching test-admin lint typecheck build logs ps gen-sdk gen-logo

help: ## Show this help.
	@awk 'BEGIN {FS = ":.*?## "} /^[a-zA-Z_-]+:.*?## / {printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

# ---- Self-host -------------------------------------------------------------

up: up-full ## One-command self-host: services + backend + admin, migrate + seed.

up-services: ## Bring up only the data services (postgres, redis, mailhog).
	$(COMPOSE) up -d postgres redis mailhog

up-full: ## Bring up all services including backend + admin containers.
	$(COMPOSE) --profile full up -d --build
	@echo "Waiting for backend to become healthy..."
	@for i in $$(seq 1 30); do \
		state=$$($(COMPOSE) ps backend --format json 2>/dev/null | grep -o '"Health":"healthy"' || true); \
		if [ -n "$$state" ]; then echo "  backend: healthy"; break; fi; \
		sleep 2; \
	done
	@$(MAKE) migrate
	@$(MAKE) seed
	@echo ""
	@echo "  Backend:  http://localhost:8080  (OpenAPI at /docs)"
	@echo "  Admin:    http://localhost:3000"
	@echo "  MailHog:  http://localhost:8025  (catches outbound email)"

down: ## Stop and remove all containers AND volumes (resets the DB).
	$(COMPOSE) --profile full down -v

migrate: ## Run prisma migrate deploy inside the backend container.
	$(COMPOSE) exec -T backend npx prisma migrate deploy

seed: ## Seed synthetic users + an admin account.
	$(COMPOSE) exec -T backend npm run seed -w @openmatch/backend
	$(COMPOSE) exec -T backend npm run seed:admin -w @openmatch/backend

logs: ## Tail logs from backend + admin.
	$(COMPOSE) logs -f backend admin

ps: ## Show container status.
	$(COMPOSE) ps

# ---- Local dev (no Docker for backend / admin) -----------------------------

dev: up-services ## Concurrent local dev: backend on :8080, admin on :3000.
	@command -v concurrently >/dev/null 2>&1 || npx --yes concurrently --version >/dev/null 2>&1 || (echo "Installing concurrently..." && npm i -D concurrently --no-save -w .)
	npx --yes concurrently --names "backend,admin" --prefix-colors "magenta,cyan" \
		"npm run dev -w @openmatch/backend" \
		"npm run dev -w @openmatch/admin"

# ---- Tests / quality -------------------------------------------------------

test: test-matching test-backend test-admin ## Run all test suites.

test-matching: ## @openmatch/matching tests (no DB required).
	npm test -w @openmatch/matching

test-backend: ## @openmatch/backend tests (needs postgres up).
	npm test -w @openmatch/backend

test-admin: ## @openmatch/admin tests.
	npm test -w @openmatch/admin

lint: ## biome check across the repo.
	npm run lint

typecheck: ## tsc --noEmit across workspaces.
	npm run typecheck

build: ## Build all workspaces.
	npm run build

# ---- SDK / assets ----------------------------------------------------------

gen-sdk: ## Regenerate the TypeScript client from /openapi.json.
	node scripts/gen-sdk.mjs

gen-logo: ## Re-rasterize logo assets (see scripts/gen_logo.mjs).
	node scripts/gen_logo.mjs
