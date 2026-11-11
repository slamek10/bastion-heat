#!/bin/bash
# Builds Bastion Heat and pushes it to Docker Hub, like bastion-ha's docker-push.sh.
# Usage: ./docker-push.sh [tag] [--no-cache]      e.g. ./docker-push.sh 2026.11.0
# PLATFORMS=linux/amd64,linux/arm64 ./docker-push.sh   for an ARM NAS too

set -e
cd "$(dirname "$0")"

DOCKERHUB_USERNAME="islamek"
DOCKERHUB_REPO="bastion-heat"
VERSION=${1:-latest}
PLATFORMS=${PLATFORMS:-linux/amd64}
IMAGE="${DOCKERHUB_USERNAME}/${DOCKERHUB_REPO}"

echo "Image: ${IMAGE}:${VERSION} (${PLATFORMS})"

if ! command -v docker &> /dev/null; then
	echo "Error: Docker is not installed."
	exit 1
fi

# newer Docker Desktop no longer prints "Username:" in docker info; the saved
# credentials are in ~/.docker/config.json (or its credential store)
if ! grep -q 'index.docker.io' ~/.docker/config.json 2>/dev/null; then
	echo "Please log in to Docker Hub:"
	docker login
fi

NO_CACHE_FLAG=""
[ "$2" == "--no-cache" ] && NO_CACHE_FLAG="--no-cache"

TAGS=(-t "${IMAGE}:${VERSION}")
[ "$VERSION" != "latest" ] && TAGS+=(-t "${IMAGE}:latest")

# buildx builds and pushes in one go, for one or several platforms
docker buildx build --platform "$PLATFORMS" $NO_CACHE_FLAG "${TAGS[@]}" --push .

echo ""
echo "Pushed ${IMAGE}:${VERSION}"
echo "On the server: docker compose pull bastion-heat && docker compose up -d"
