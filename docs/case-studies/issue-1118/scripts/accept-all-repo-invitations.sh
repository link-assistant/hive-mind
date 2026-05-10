#!/bin/bash
# Script to accept all pending repository invitations using gh CLI
#
# Requirements:
#   - gh CLI installed and authenticated
#   - Token with 'repo:invite' or 'repo' scope
#
# Usage:
#   ./accept-all-repo-invitations.sh           # Accept all invitations
#   ./accept-all-repo-invitations.sh --dry-run # Preview without accepting

set -euo pipefail

DRY_RUN=false
if [[ "${1:-}" == "--dry-run" ]]; then
    DRY_RUN=true
    echo "=== DRY RUN MODE - No invitations will be accepted ==="
    echo ""
fi

echo "Fetching pending repository invitations..."

# Get all pending invitations as JSON
INVITATIONS=$(gh api /user/repository_invitations)

# Count invitations
COUNT=$(echo "$INVITATIONS" | jq 'length')

if [[ "$COUNT" -eq 0 ]]; then
    echo "No pending repository invitations found."
    exit 0
fi

echo "Found $COUNT pending invitation(s):"
echo ""

# List all invitations
echo "$INVITATIONS" | jq -r '.[] | "  - \(.repository.full_name) (from: \(.inviter.login), expired: \(.expired))"'
echo ""

if [[ "$DRY_RUN" == "true" ]]; then
    echo "Dry run complete. Use without --dry-run to accept invitations."
    exit 0
fi

# Accept each invitation
echo "Accepting invitations..."
echo "$INVITATIONS" | jq -r '.[].id' | while read -r id; do
    REPO=$(echo "$INVITATIONS" | jq -r ".[] | select(.id == $id) | .repository.full_name")
    echo "  Accepting invitation for: $REPO (ID: $id)..."

    RESPONSE=$(gh api -X PATCH "/user/repository_invitations/$id" 2>&1) || {
        echo "    Failed to accept invitation: $RESPONSE"
        continue
    }

    echo "    Accepted successfully!"
done

echo ""
echo "Done!"
