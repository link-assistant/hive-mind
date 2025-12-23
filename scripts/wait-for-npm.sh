#!/usr/bin/env bash
set -euo pipefail

# Wait for NPM package availability
# Usage: ./scripts/wait-for-npm.sh <version>
#
# This script waits for a specific version of @link-assistant/hive-mind
# to become available on the npm registry. This is necessary because there
# can be a delay between publishing and availability.

VERSION="${1:-}"
PACKAGE_NAME="@link-assistant/hive-mind"
MAX_ATTEMPTS="${MAX_ATTEMPTS:-30}"
SLEEP_TIME="${SLEEP_TIME:-10}"

if [ -z "$VERSION" ]; then
  echo "Error: Version is required"
  echo "Usage: $0 <version>"
  exit 1
fi

echo "Waiting for NPM package ${PACKAGE_NAME}@${VERSION} to become available..."

for i in $(seq 1 "$MAX_ATTEMPTS"); do
  echo "Attempt $i/$MAX_ATTEMPTS: Checking NPM registry..."

  if npm view "${PACKAGE_NAME}@${VERSION}" version 2>/dev/null; then
    echo "Package ${PACKAGE_NAME}@${VERSION} is now available on NPM!"
    exit 0
  fi

  if [ "$i" -lt "$MAX_ATTEMPTS" ]; then
    echo "Package not yet available, waiting ${SLEEP_TIME} seconds..."
    sleep "$SLEEP_TIME"
  fi
done

echo "Package ${PACKAGE_NAME}@${VERSION} did not become available after $((MAX_ATTEMPTS * SLEEP_TIME)) seconds"
exit 1
