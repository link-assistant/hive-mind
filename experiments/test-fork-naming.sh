#!/bin/bash

# Experiment to understand fork naming behavior
#
# This tests:
# 1. What gh repo fork outputs when a fork already exists
# 2. What the actual fork name is on GitHub
# 3. What message gh displays when trying to fork again

echo "================================================================================"
echo "FORK NAMING EXPERIMENT"
echo "================================================================================"
echo

# Test repo from the issue
OWNER="netkeep80"
REPO="jsonRVM"
FULL_REPO="$OWNER/$REPO"

echo "Testing fork behavior for: $FULL_REPO"
echo

# Get current user
echo "1. Getting current user..."
CURRENT_USER=$(gh api user --jq .login)
echo "   Current user: $CURRENT_USER"
echo

# Check what fork name would be
EXPECTED_FORK="$CURRENT_USER/$REPO"
echo "2. Expected fork name: $EXPECTED_FORK"
echo

# Try to check if fork exists
echo "3. Checking if fork exists: $EXPECTED_FORK"
if gh repo view "$EXPECTED_FORK" --json name >/dev/null 2>&1; then
    echo "   ✅ Fork exists at: $EXPECTED_FORK"
else
    echo "   ❌ Fork does not exist at: $EXPECTED_FORK"
fi
echo

# Try to create fork (will fail if already exists)
echo "4. Trying to create fork from $FULL_REPO..."
echo "   Running: gh repo fork $FULL_REPO --clone=false"
OUTPUT=$(gh repo fork "$FULL_REPO" --clone=false 2>&1)
EXIT_CODE=$?
echo "   Exit code: $EXIT_CODE"
echo "   Output:"
echo "$OUTPUT" | sed 's/^/     /'
echo

# Parse the fork output to see what fork name gh mentioned
echo "5. Analyzing fork output..."
echo "$OUTPUT" | grep -i "already exists\|fork" | sed 's/^/   Found: "/' | sed 's/$/"/'
echo

# List all forks of the upstream repo
echo "6. Listing all forks of $FULL_REPO owned by $CURRENT_USER..."
gh api "repos/$FULL_REPO/forks" --jq '.[] | select(.owner.login == "'$CURRENT_USER'") | .full_name' 2>/dev/null | while read fork; do
    echo "   ✅ $fork (owned by current user)"
done
echo

echo "================================================================================"
echo "EXPERIMENT COMPLETE"
echo "================================================================================"