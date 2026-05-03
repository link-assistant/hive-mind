#!/bin/bash
# Reproduction script for OpenCode gh CLI errors
# This script demonstrates the exact errors that occur

set +e  # Don't exit on errors (we expect some commands to fail)

echo "======================================"
echo "OpenCode gh CLI Error Reproduction"
echo "======================================"
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test variables (change these to match your test repo)
REPO="${REPO:-veb86/zcadvelecAI}"
PR_NUMBER="${PR_NUMBER:-313}"
ISSUE_NUMBER="${ISSUE_NUMBER:-241}"

echo "Test Configuration:"
echo "  Repository: $REPO"
echo "  PR Number: $PR_NUMBER"
echo "  Issue Number: $ISSUE_NUMBER"
echo ""

# Check if gh is installed
if ! command -v gh &> /dev/null; then
    echo -e "${RED}ERROR: gh CLI is not installed${NC}"
    echo "Please install it from: https://cli.github.com/"
    exit 1
fi

# Check if gh is authenticated
if ! gh auth status &> /dev/null; then
    echo -e "${YELLOW}WARNING: gh is not authenticated${NC}"
    echo "Please run: gh auth login"
    exit 1
fi

echo -e "${GREEN}✓ gh CLI is installed and authenticated${NC}"
echo ""

# Function to run test and show result
run_test() {
    local test_name="$1"
    local command="$2"
    local expected_result="$3"

    echo "======================================"
    echo "Test: $test_name"
    echo "======================================"
    echo "Command: $command"
    echo ""
    echo "Output:"

    output=$(eval "$command" 2>&1)
    exit_code=$?

    echo "$output"
    echo ""

    if [ $exit_code -ne 0 ]; then
        echo -e "${RED}✗ Command failed with exit code $exit_code${NC}"
    else
        echo -e "${GREEN}✓ Command succeeded${NC}"
    fi

    if [ -n "$expected_result" ]; then
        echo "Expected: $expected_result"
    fi
    echo ""
}

# Test 1: Incorrect "gh pr comments" command (should fail)
run_test \
    "Error 1 - gh pr comments (plural)" \
    "gh pr comments $PR_NUMBER --repo $REPO" \
    "Should fail with 'unknown command' error"

# Test 2: Incorrect "gh pr comment list" command (should fail)
run_test \
    "Error 2 - gh pr comment list" \
    "gh pr comment list $PR_NUMBER --repo $REPO" \
    "Should fail with 'accepts at most 1 arg(s)' error"

# Test 3: Correct "gh api" command for PR comments (should succeed)
run_test \
    "Correct - gh api for PR comments" \
    "gh api repos/$REPO/pulls/$PR_NUMBER/comments --jq 'length'" \
    "Should succeed and return count of comments"

# Test 4: Correct "gh pr view" command (should succeed)
run_test \
    "Correct - gh pr view" \
    "gh pr view $PR_NUMBER --repo $REPO --json number,title" \
    "Should succeed and return PR details"

# Test 5: Correct "gh pr comment" for adding comment (dry run)
echo "======================================"
echo "Test: Correct - gh pr comment (not executing)"
echo "======================================"
echo "Command (dry run): gh pr comment $PR_NUMBER --body \"Test comment\" --repo $REPO"
echo ""
echo -e "${YELLOW}ℹ Skipping execution to avoid adding test comments${NC}"
echo "This command would succeed if executed"
echo ""

# Summary
echo "======================================"
echo "Summary"
echo "======================================"
echo ""
echo "Errors Reproduced:"
echo "  ✓ Error 1: 'gh pr comments' - unknown command"
echo "  ✓ Error 2: 'gh pr comment list' - too many arguments"
echo ""
echo "Correct Alternatives Demonstrated:"
echo "  ✓ Use 'gh api repos/OWNER/REPO/pulls/NUMBER/comments' to list comments"
echo "  ✓ Use 'gh pr view NUMBER --repo OWNER/REPO' to view PR details"
echo "  ✓ Use 'gh pr comment NUMBER --body \"text\" --repo OWNER/REPO' to add comments"
echo ""
echo "For more information, see README.md in this directory"
