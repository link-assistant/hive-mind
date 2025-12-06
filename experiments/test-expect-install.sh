#!/usr/bin/env bash
# Test script to verify expect command is installed and working
# This test helps ensure issue #813 is resolved

set -euo pipefail

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}==> Testing expect installation${NC}\n"

# Test 1: Check if expect is installed
echo -e "${BLUE}[1/3] Checking if expect command is available...${NC}"
if command -v expect &>/dev/null; then
  echo -e "${GREEN}✓ expect command found in PATH${NC}"
else
  echo -e "${RED}✗ expect command not found in PATH${NC}"
  exit 1
fi

# Test 2: Check expect version
echo -e "\n${BLUE}[2/3] Checking expect version...${NC}"
EXPECT_VERSION=$(expect -v 2>&1 || echo "unknown")
if [[ "$EXPECT_VERSION" == *"expect"* ]]; then
  echo -e "${GREEN}✓ expect version: $EXPECT_VERSION${NC}"
else
  echo -e "${YELLOW}⚠ Could not determine expect version${NC}"
fi

# Test 3: Run a simple expect script to verify functionality
echo -e "\n${BLUE}[3/3] Testing expect functionality with simple script...${NC}"

# Create a temporary expect script
TEMP_EXPECT_SCRIPT=$(mktemp)
cat > "$TEMP_EXPECT_SCRIPT" << 'EOF'
#!/usr/bin/expect -f
# Simple test script to verify expect works
set timeout 5
log_user 0

# Spawn a simple echo command
spawn echo "Hello from expect"

# Wait for output
expect {
  "Hello from expect" {
    puts "SUCCESS: expect is working correctly"
    exit 0
  }
  timeout {
    puts "ERROR: Timeout waiting for output"
    exit 1
  }
  eof {
    puts "SUCCESS: expect processed command"
    exit 0
  }
}
EOF

# Make it executable
chmod +x "$TEMP_EXPECT_SCRIPT"

# Run the test script
if expect "$TEMP_EXPECT_SCRIPT" &>/dev/null; then
  echo -e "${GREEN}✓ expect script executed successfully${NC}"
  rm -f "$TEMP_EXPECT_SCRIPT"
else
  echo -e "${RED}✗ expect script failed to execute${NC}"
  rm -f "$TEMP_EXPECT_SCRIPT"
  exit 1
fi

# Summary
echo -e "\n${GREEN}==> All tests passed! expect is installed and working correctly${NC}"
echo -e "${BLUE}This resolves issue #813 - expect command is now preinstalled${NC}\n"

exit 0
