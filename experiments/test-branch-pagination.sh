#!/bin/bash

# Test script to verify branch pagination issue

OWNER="link-assistant"
REPO="hive-mind"

echo "Testing branch pagination for $OWNER/$REPO..."
echo ""

# Test 1: Current approach (no pagination)
echo "=== Test 1: Current approach (no pagination) ==="
BRANCHES_NO_PAGINATE=$(gh api "repos/$OWNER/$REPO/branches" --jq '.[].name')
COUNT_NO_PAGINATE=$(echo "$BRANCHES_NO_PAGINATE" | wc -l)
echo "Found $COUNT_NO_PAGINATE branches (default page size)"
echo ""

# Test 2: With pagination (all pages)
echo "=== Test 2: With pagination (all pages) ==="
BRANCHES_WITH_PAGINATE=$(gh api --paginate "repos/$OWNER/$REPO/branches" --jq '.[].name')
COUNT_WITH_PAGINATE=$(echo "$BRANCHES_WITH_PAGINATE" | wc -l)
echo "Found $COUNT_WITH_PAGINATE branches (with --paginate)"
echo ""

# Test 3: Check for issue-357 branches specifically
echo "=== Test 3: Search for issue-357 branches ==="
ISSUE_357_BRANCHES=$(echo "$BRANCHES_WITH_PAGINATE" | grep '^issue-357-' || echo "")
COUNT_357=$(echo "$ISSUE_357_BRANCHES" | grep -c '^issue-357-' || echo "0")
echo "Found $COUNT_357 branches for issue #357:"
if [ -n "$ISSUE_357_BRANCHES" ]; then
  echo "$ISSUE_357_BRANCHES" | sed 's/^/  • /'
fi
echo ""

# Test 4: Check for issue-408 branches specifically
echo "=== Test 4: Search for issue-408 branches ==="
ISSUE_408_BRANCHES=$(echo "$BRANCHES_WITH_PAGINATE" | grep '^issue-408-' || echo "")
COUNT_408=$(echo "$ISSUE_408_BRANCHES" | grep -c '^issue-408-' || echo "0")
echo "Found $COUNT_408 branches for issue #408:"
if [ -n "$ISSUE_408_BRANCHES" ]; then
  echo "$ISSUE_408_BRANCHES" | sed 's/^/  • /'
fi
echo ""

echo "=== Summary ==="
echo "Without --paginate: $COUNT_NO_PAGINATE branches"
echo "With --paginate:    $COUNT_WITH_PAGINATE branches"
echo "Difference:         $((COUNT_WITH_PAGINATE - COUNT_NO_PAGINATE)) branches were missing!"
echo ""
echo "The --paginate flag is needed to fetch all branches from the repository."
echo "Without it, only the first page (default 30 items) is returned."
