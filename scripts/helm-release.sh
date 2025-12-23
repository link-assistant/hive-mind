#!/usr/bin/env bash
set -euo pipefail

# Helm chart release script
# Usage: ./scripts/helm-release.sh <version>
#
# This script packages and publishes the Helm chart to the gh-pages branch.
# It expects Helm to be installed and Git to be configured.
#
# Environment variables:
#   GITHUB_ACTOR - GitHub username for Git commits
#   HELM_REPO_URL - Helm repository URL (default: https://link-assistant.github.io/hive-mind)

VERSION="${1:-}"
HELM_REPO_URL="${HELM_REPO_URL:-https://link-assistant.github.io/hive-mind}"
GITHUB_ACTOR="${GITHUB_ACTOR:-github-actions}"

if [ -z "$VERSION" ]; then
  echo "Error: Version is required"
  echo "Usage: $0 <version>"
  exit 1
fi

echo "Releasing Helm chart version ${VERSION}..."

# Configure Git
git config user.name "$GITHUB_ACTOR"
git config user.email "${GITHUB_ACTOR}@users.noreply.github.com"

# Update Chart.yaml with new version
echo "Updating Chart.yaml to version ${VERSION}..."
sed -i "s/^appVersion: .*/appVersion: \"${VERSION}\"/" helm/hive-mind/Chart.yaml
sed -i "s/^version: .*/version: ${VERSION}/" helm/hive-mind/Chart.yaml
echo "Updated Chart.yaml:"
cat helm/hive-mind/Chart.yaml

# Lint the chart
echo ""
echo "Linting Helm chart..."
helm lint helm/hive-mind

# Package the chart
echo ""
echo "Packaging Helm chart..."
mkdir -p .helm-packages
helm package helm/hive-mind -d .helm-packages
ls -la .helm-packages/

# Ensure gh-pages branch exists
echo ""
echo "Checking gh-pages branch..."
if ! git ls-remote --exit-code --heads origin gh-pages >/dev/null 2>&1; then
  echo "Creating gh-pages branch..."
  git checkout --orphan gh-pages
  git reset --hard
  git commit --allow-empty -m "Initialize gh-pages branch for Helm charts"
  git push origin gh-pages
  git checkout -
fi

# Checkout gh-pages branch
echo ""
echo "Checking out gh-pages branch..."
git fetch origin gh-pages:gh-pages
git checkout gh-pages

# Update Helm repository index
echo ""
echo "Updating Helm repository index..."
cp .helm-packages/*.tgz .
helm repo index . --url "${HELM_REPO_URL}"
echo "Index updated:"
cat index.yaml

# Commit and push
echo ""
echo "Committing and pushing to gh-pages..."
git add -f *.tgz index.yaml
git commit -m "Release Helm chart version ${VERSION}" || echo "No changes to commit"
git push origin gh-pages

# Switch back
echo ""
echo "Switching back to previous branch..."
git checkout -

echo ""
echo "Helm chart version ${VERSION} released successfully!"
