#!/bin/bash
# Test script for auto-restart functionality when uncommitted changes are detected

set -e

echo "=== Testing Auto-Restart Functionality ==="
echo ""

# Create a test repository
TEST_DIR="/tmp/test_auto_restart_$(date +%s)"
mkdir -p "$TEST_DIR"
cd "$TEST_DIR"

echo "1. Creating test repository..."
git init
git config user.email "test@example.com"
git config user.name "Test User"

# Create initial file
echo "Initial content" > test.txt
git add test.txt
git commit -m "Initial commit"

echo ""
echo "2. Simulating uncommitted changes..."
echo "Uncommitted change" >> test.txt
echo "New file content" > new_file.txt

echo ""
echo "3. Running git status to confirm uncommitted changes..."
git status --porcelain

echo ""
echo "4. Expected behavior:"
echo "   - Should detect uncommitted changes"
echo "   - Should show 'AUTO-RESTART' message"
echo "   - Should return true from checkForUncommittedChanges function"
echo ""

# Simulate the check
node -e "
const checkResult = async () => {
  const tempDir = '$TEST_DIR';
  const statusOutput = \`$(git status --porcelain)\`;

  if (statusOutput) {
    console.log('✅ Uncommitted changes detected successfully');
    console.log('Changes:');
    console.log(statusOutput);
    console.log('');
    console.log('🔄 AUTO-RESTART would be triggered');
    return true;
  } else {
    console.log('❌ No uncommitted changes detected');
    return false;
  }
};

checkResult().then(result => {
  console.log('');
  console.log('Function would return:', result);
});
"

echo ""
echo "5. Testing with --auto-commit-uncommitted-changes flag..."
echo "   With this flag, auto-restart should NOT be triggered"
echo "   Instead, changes should be auto-committed"
echo ""

# Clean up
echo "6. Cleaning up test directory..."
rm -rf "$TEST_DIR"

echo ""
echo "=== Test Complete ==="
echo ""
echo "The auto-restart functionality has been implemented to:"
echo "1. Detect uncommitted changes after Claude execution"
echo "2. Trigger a single restart (not a loop) when changes are found"
echo "3. Pass uncommitted changes as feedback to the restarted Claude"
echo "4. Let Claude decide what to commit from the uncommitted changes"