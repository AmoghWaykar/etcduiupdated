#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────
# build-push.sh  —  Build & push etcd-dashboard to JFrog Artifactory
#
# Usage:
#   chmod +x build-push.sh
#   ./build-push.sh
#
# Or set env vars first:
#   export JFROG_URL=https://your-company.jfrog.io
#   export JFROG_REPO=docker-local
#   export JFROG_USER=your-username
#   export JFROG_PASSWORD=your-password
#   export IMAGE_TAG=1.0.0
#   ./build-push.sh
# ─────────────────────────────────────────────────────────────────
set -euo pipefail

# ── Configuration (override via env vars or edit below) ──────────
JFROG_URL="${JFROG_URL:-https://your-company.jfrog.io}"
JFROG_REPO="${JFROG_REPO:-docker-local}"
JFROG_USER="${JFROG_USER:-}"
JFROG_PASSWORD="${JFROG_PASSWORD:-}"
IMAGE_NAME="etcd-dashboard"
IMAGE_TAG="${IMAGE_TAG:-latest}"

# JFrog npm registry for build-time npm install
# e.g. https://your-company.jfrog.io/artifactory/api/npm/npm-virtual/
JFROG_NPM_URL="${JFROG_NPM_URL:-}"

# ── Derived values ────────────────────────────────────────────────
JFROG_HOST="${JFROG_URL#https://}"
JFROG_HOST="${JFROG_HOST#http://}"
REGISTRY="${JFROG_HOST}/${JFROG_REPO}"
FULL_IMAGE="${REGISTRY}/${IMAGE_NAME}:${IMAGE_TAG}"

# ── Validate required vars ────────────────────────────────────────
if [ -z "$JFROG_USER" ] || [ -z "$JFROG_PASSWORD" ]; then
  echo "❌  JFROG_USER and JFROG_PASSWORD must be set."
  echo "    export JFROG_USER=your-username"
  echo "    export JFROG_PASSWORD=your-password"
  exit 1
fi

echo "──────────────────────────────────────────"
echo " Building: ${IMAGE_NAME}:${IMAGE_TAG}"
echo " Registry: ${REGISTRY}"
echo "──────────────────────────────────────────"

# ── Step 1: Docker login to JFrog ────────────────────────────────
echo ""
echo "🔐 Logging in to JFrog Docker registry..."
echo "$JFROG_PASSWORD" | docker login "${JFROG_HOST}" \
  --username "$JFROG_USER" \
  --password-stdin
echo "✅ Login successful"

# ── Step 2: Build the Docker image ───────────────────────────────
echo ""
echo "🔨 Building Docker image..."
docker build \
  --build-arg JFROG_URL="${JFROG_NPM_URL}" \
  --build-arg JFROG_USER="${JFROG_USER}" \
  --build-arg JFROG_PASSWORD="${JFROG_PASSWORD}" \
  --tag "${FULL_IMAGE}" \
  --tag "${REGISTRY}/${IMAGE_NAME}:latest" \
  .

echo "✅ Build complete: ${FULL_IMAGE}"

# ── Step 3: Push to JFrog Artifactory ────────────────────────────
echo ""
echo "📤 Pushing image to Artifactory..."
docker push "${FULL_IMAGE}"
docker push "${REGISTRY}/${IMAGE_NAME}:latest"

echo ""
echo "✅ Successfully pushed:"
echo "   ${FULL_IMAGE}"
echo "   ${REGISTRY}/${IMAGE_NAME}:latest"

# ── Step 4: Clean up local credentials ───────────────────────────
docker logout "${JFROG_HOST}" 2>/dev/null || true
echo ""
echo "🔒 Logged out of registry"
echo "──────────────────────────────────────────"
echo " Done!"
echo "──────────────────────────────────────────"
