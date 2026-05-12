SHELL := /bin/bash

IMAGE ?= xdimedrolx/pdf-service
VERSION_FILE ?= VERSION

# Priority: passed VERSION variable -> VERSION file
VERSION ?= $(shell test -f $(VERSION_FILE) && tr -d '[:space:]' < $(VERSION_FILE))
TAG := $(IMAGE):$(VERSION)

.PHONY: help version show-tag set-version tag-release docker-build docker-push docker-release

help:
	@echo "Targets:"
	@echo "  make version                 # show current version from $(VERSION_FILE)"
	@echo "  make show-tag                # show final image tag"
	@echo "  make set-version VERSION=X   # write VERSION file and sync server/package.json"
	@echo "  make tag-release             # create and push 'v\$$VERSION' git tag (triggers Release workflow)"
	@echo "  make docker-build            # docker build -t IMAGE:VERSION ./server"
	@echo "  make docker-push             # docker push IMAGE:VERSION"
	@echo "  make docker-release          # manual Docker Hub release (build + push)"
	@echo ""
	@echo "GitHub Release flow:"
	@echo "  1. make set-version VERSION=X"
	@echo "  2. commit the change"
	@echo "  3. make tag-release   # pushes v\$$VERSION; CI builds image to ghcr.io and creates the GitHub Release"
	@echo ""
	@echo "Optional vars: IMAGE, VERSION, VERSION_FILE"

version:
	@echo $(VERSION)

show-tag:
	@if [ -z "$(VERSION)" ]; then \
		echo "VERSION is empty. Set VERSION=<value> or create $(VERSION_FILE)."; \
		exit 1; \
	fi
	@echo $(TAG)

set-version:
	@if [ -z "$(VERSION)" ]; then \
		echo "Usage: make set-version VERSION=1.0.0"; \
		exit 1; \
	fi
	@echo "$(VERSION)" > $(VERSION_FILE)
	@cd server && npm version --no-git-tag-version --allow-same-version "$(VERSION)" >/dev/null
	@echo "Saved version: $(VERSION) (VERSION + server/package.json)"

tag-release:
	@if [ -z "$(VERSION)" ]; then \
		echo "VERSION is empty. Set VERSION=<value> or create $(VERSION_FILE)."; \
		exit 1; \
	fi
	@if [ -n "$$(git status --porcelain)" ]; then \
		echo "Working tree has uncommitted changes. Commit them before tagging."; \
		exit 1; \
	fi
	@if git rev-parse "v$(VERSION)" >/dev/null 2>&1; then \
		echo "Tag v$(VERSION) already exists."; \
		exit 1; \
	fi
	@PKG=$$(cd server && node -p "require('./package.json').version"); \
	if [ "$$PKG" != "$(VERSION)" ]; then \
		echo "server/package.json ($$PKG) does not match VERSION ($(VERSION)). Run: make set-version VERSION=$(VERSION)"; \
		exit 1; \
	fi
	git tag -a "v$(VERSION)" -m "Release v$(VERSION)"
	git push origin "v$(VERSION)"
	@echo "Pushed v$(VERSION). The Release workflow will build the image and create the GitHub Release."

docker-build:
	@if [ -z "$(VERSION)" ]; then \
		echo "VERSION is empty. Set VERSION=<value> or create $(VERSION_FILE)."; \
		exit 1; \
	fi
	docker build -t $(TAG) ./server

docker-push:
	@if [ -z "$(VERSION)" ]; then \
		echo "VERSION is empty. Set VERSION=<value> or create $(VERSION_FILE)."; \
		exit 1; \
	fi
	docker push $(TAG)

docker-release: docker-build docker-push
	@echo "Released: $(TAG)"
