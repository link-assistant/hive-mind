#!/usr/bin/env bash
# verify-chart-yaml.sh
#
# Verifies that the Helm chart's Chart.yaml contains all required fields:
# name, version, and appVersion.
#
# Usage:
#   bash scripts/verify-chart-yaml.sh
#
# Exit code 0 = Chart.yaml is valid; non-zero = required field missing or file not found.

set -euo pipefail

echo "Verifying Chart.yaml structure..."
if [ ! -f "helm/hive-mind/Chart.yaml" ]; then
  echo "Chart.yaml not found"
  exit 1
fi

if ! grep -q "^name:" helm/hive-mind/Chart.yaml; then
  echo "Chart name not found"
  exit 1
fi

if ! grep -q "^version:" helm/hive-mind/Chart.yaml; then
  echo "Chart version not found"
  exit 1
fi

if ! grep -q "^appVersion:" helm/hive-mind/Chart.yaml; then
  echo "Chart appVersion not found"
  exit 1
fi

echo "Chart.yaml structure is valid"
