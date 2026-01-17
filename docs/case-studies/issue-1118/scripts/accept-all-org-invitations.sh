#!/bin/bash
# Script to accept all pending organization invitations using gh CLI
#
# Requirements:
#   - gh CLI installed and authenticated
#   - Token with 'admin:org' or 'write:org' scope
#
# Usage:
#   ./accept-all-org-invitations.sh           # Accept all pending org invitations
#   ./accept-all-org-invitations.sh --dry-run # Preview without accepting

set -euo pipefail

DRY_RUN=false
if [[ "${1:-}" == "--dry-run" ]]; then
    DRY_RUN=true
    echo "=== DRY RUN MODE - No invitations will be accepted ==="
    echo ""
fi

echo "Fetching organization memberships..."

# Get all organization memberships and filter for pending ones
MEMBERSHIPS=$(gh api /user/memberships/orgs)
PENDING=$(echo "$MEMBERSHIPS" | jq '[.[] | select(.state == "pending")]')

# Count pending invitations
COUNT=$(echo "$PENDING" | jq 'length')

if [[ "$COUNT" -eq 0 ]]; then
    echo "No pending organization invitations found."
    echo ""
    echo "Current active memberships:"
    echo "$MEMBERSHIPS" | jq -r '.[] | select(.state == "active") | "  - \(.organization.login) (role: \(.role))"'
    exit 0
fi

echo "Found $COUNT pending organization invitation(s):"
echo ""

# List all pending invitations
echo "$PENDING" | jq -r '.[] | "  - \(.organization.login) (role: \(.role))"'
echo ""

if [[ "$DRY_RUN" == "true" ]]; then
    echo "Dry run complete. Use without --dry-run to accept invitations."
    exit 0
fi

# Accept each invitation
echo "Accepting invitations..."
echo "$PENDING" | jq -r '.[].organization.login' | while read -r org; do
    echo "  Accepting invitation for organization: $org..."

    RESPONSE=$(gh api -X PATCH "/user/memberships/orgs/$org" -f state=active 2>&1) || {
        echo "    Failed to accept invitation: $RESPONSE"
        continue
    }

    echo "    Accepted successfully!"
done

echo ""
echo "Done!"
