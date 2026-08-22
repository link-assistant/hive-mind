#!/bin/bash

# Test parsing fork name from gh repo fork output
#
# When gh repo fork outputs messages like:
# - "konard/netkeep80-jsonRVM already exists"
# - "✓ Created fork konard/netkeep80-jsonRVM"
# - Just the fork name on a line
#
# We need to extract the actual fork name

echo "================================================================================"
echo "TEST: Parse Fork Name from gh repo fork Output"
echo "================================================================================"
echo

# Test cases - various outputs from gh repo fork
TEST_CASES=(
    "konard/netkeep80-jsonRVM already exists"
    "✓ Created fork konard/netkeep80-jsonRVM"
    "konard/jsonRVM"
    "Creating fork konard/netkeep80-jsonRVM..."
    "konard/some-repo"
)

echo "Test cases for fork name extraction:"
echo

for i in "${!TEST_CASES[@]}"; do
    OUTPUT="${TEST_CASES[$i]}"
    echo "Test $((i+1)): \"$OUTPUT\""

    # Try to extract fork name (owner/repo pattern)
    # Pattern: word/word or word/word-word
    FORK_NAME=$(echo "$OUTPUT" | grep -oE '[a-zA-Z0-9_-]+/[a-zA-Z0-9_-]+' | head -1)

    if [ -n "$FORK_NAME" ]; then
        echo "  ✅ Extracted: $FORK_NAME"
    else
        echo "  ❌ Failed to extract fork name"
    fi
    echo
done

echo "================================================================================"
echo "TEST: Real gh repo fork Output"
echo "================================================================================"
echo

# Test with real gh command
OWNER="netkeep80"
REPO="jsonRVM"
FULL_REPO="$OWNER/$REPO"

echo "Running: gh repo fork $FULL_REPO --clone=false"
FORK_OUTPUT=$(gh repo fork "$FULL_REPO" --clone=false 2>&1)
EXIT_CODE=$?
echo "Exit code: $EXIT_CODE"
echo "Output:"
echo "$FORK_OUTPUT" | sed 's/^/  /'
echo

echo "Extracting fork name..."
EXTRACTED_FORK=$(echo "$FORK_OUTPUT" | grep -oE '[a-zA-Z0-9_-]+/[a-zA-Z0-9_-]+' | head -1)
echo "Extracted: $EXTRACTED_FORK"
echo

# Verify the extracted fork name
if [ -n "$EXTRACTED_FORK" ]; then
    echo "Verifying fork: $EXTRACTED_FORK"
    if gh repo view "$EXTRACTED_FORK" --json nameWithOwner >/dev/null 2>&1; then
        echo "✅ Fork verified: $EXTRACTED_FORK exists and is accessible"
    else
        echo "❌ Fork verification failed: $EXTRACTED_FORK not accessible"
    fi
else
    echo "❌ No fork name could be extracted"
fi

echo
echo "================================================================================"
echo "COMPLETE"
echo "================================================================================"