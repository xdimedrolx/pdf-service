SHELL := /bin/bash

IMAGE ?= xdimedrolx/pdf-service
VERSION_FILE ?= VERSION

# Priority: passed VERSION variable -> VERSION file
VERSION ?= $(shell test -f $(VERSION_FILE) && tr -d '[:space:]' < $(VERSION_FILE))
TAG := $(IMAGE):$(VERSION)

.PHONY: help version show-tag set-version docker-build docker-push docker-release

help:
	@echo "Targets:"
	@echo "  make version                 # show current version from $(VERSION_FILE)"
	@echo "  make show-tag               # show final image tag"
	@echo "  make set-version VERSION=X  # write VERSION file"
	@echo "  make docker-build           # docker build -t IMAGE:VERSION ."
	@echo "  make docker-push            # docker push IMAGE:VERSION"
	@echo "  make docker-release         # build + push"
	@echo ""
	@echo "Optional vars: IMAGE, VERSION, VERSION_FILE"
	@echo "Example: make docker-release VERSION=0.7.0"

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
		echo "Usage: make set-version VERSION=0.7.0"; \
		exit 1; \
	fi
	@echo "$(VERSION)" > $(VERSION_FILE)
	@echo "Saved version: $(VERSION)"

docker-build:
	@if [ -z "$(VERSION)" ]; then \
		echo "VERSION is empty. Set VERSION=<value> or create $(VERSION_FILE)."; \
		exit 1; \
	fi
	docker build -t $(TAG) .

docker-push:
	@if [ -z "$(VERSION)" ]; then \
		echo "VERSION is empty. Set VERSION=<value> or create $(VERSION_FILE)."; \
		exit 1; \
	fi
	docker push $(TAG)

docker-release: docker-build docker-push
	@echo "Released: $(TAG)"
