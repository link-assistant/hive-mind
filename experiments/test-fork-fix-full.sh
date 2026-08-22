#!/bin/bash

# Test the fork fix with the real scenario from issue #314
#
# This simulates what happens when:
# 1. A fork exists with a modified name (konard/netkeep80-jsonRVM)
# 2. The code tries to detect it

echo "================================================================================"
echo "TEST: Fork Detection with Modified Names"
echo "================================================================================"
echo

OWNER="netkeep80"
REPO="jsonRVM"
CURRENT_USER=$(gh api user --jq .login)

echo "Testing fork detection for: $OWNER/$REPO"
echo "Current user: $CURRENT_USER"
echo

# Standard fork name
STANDARD_FORK="$CURRENT_USER/$REPO"
echo "1. Checking standard fork name: $STANDARD_FORK"
if gh repo view "$STANDARD_FORK" --json name >/dev/null 2>&1; then
    echo "   ✅ Fork exists at: $STANDARD_FORK"
    FOUND_FORK="$STANDARD_FORK"
else
    echo "   ❌ Fork does not exist at: $STANDARD_FORK"
fi
echo

# Alternate fork name
ALTERNATE_FORK="$CURRENT_USER/$OWNER-$REPO"
echo "2. Checking alternate fork name: $ALTERNATE_FORK"
if gh repo view "$ALTERNATE_FORK" --json name >/dev/null 2>&1; then
    echo "   ✅ Fork exists at: $ALTERNATE_FORK"
    FOUND_FORK="$ALTERNATE_FORK"
else
    echo "   ❌ Fork does not exist at: $ALTERNATE_FORK"
fi
echo

if [ -n "$FOUND_FORK" ]; then
    echo "✅ SUCCESS: Found fork at $FOUND_FORK"
    echo
    echo "3. Verifying fork details..."
    gh repo view "$FOUND_FORK" --json nameWithOwner,isFork,parent --jq '{name: .nameWithOwner, isFork: .isFork, parent: .parent.nameWithOwner}'
else
    echo "❌ FAILED: No fork found"
fi

echo
echo "================================================================================"
echo "TEST COMPLETE"
echo "================================================================================"