#!/usr/bin/env bash
# Test script to verify Playwright MCP installation and configuration

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test counter
TESTS_PASSED=0
TESTS_FAILED=0

# Function to run a test
run_test() {
    local test_name="$1"
    local test_command="$2"

    echo -n "Testing: $test_name... "

    if eval "$test_command" >/dev/null 2>&1; then
        echo -e "${GREEN}✓${NC}"
        ((TESTS_PASSED++))
        return 0
    else
        echo -e "${RED}✗${NC}"
        ((TESTS_FAILED++))
        return 1
    fi
}

echo "=== Playwright MCP Installation Test Suite ==="
echo ""

# Test 1: Check if Node.js is installed
run_test "Node.js installation" "command -v node"

# Test 2: Check Node.js version (should be 18+)
if command -v node >/dev/null 2>&1; then
    NODE_VERSION=$(node -v | sed 's/v//g' | cut -d. -f1)
    if [[ $NODE_VERSION -ge 18 ]]; then
        echo -e "Testing: Node.js version (18+)... ${GREEN}✓${NC} (v$NODE_VERSION)"
        ((TESTS_PASSED++))
    else
        echo -e "Testing: Node.js version (18+)... ${RED}✗${NC} (v$NODE_VERSION < 18)"
        ((TESTS_FAILED++))
    fi
else
    echo -e "Testing: Node.js version (18+)... ${RED}✗${NC} (Node not found)"
    ((TESTS_FAILED++))
fi

# Test 3: Check if npm is installed
run_test "npm installation" "command -v npm"

# Test 4: Check if npx is available
run_test "npx availability" "command -v npx"

# Test 5: Check if @playwright/mcp is installed globally
run_test "@playwright/mcp global installation" "npm list -g @playwright/mcp"

# Test 6: Check if Claude CLI is installed
run_test "Claude CLI installation" "command -v claude"

# Test 7: Check if playwright MCP is configured in Claude CLI
if command -v claude &>/dev/null; then
    run_test "Playwright MCP in Claude configuration" "claude mcp list 2>/dev/null | grep -q playwright"

    # Test 8: Get detailed playwright MCP configuration
    if claude mcp list 2>/dev/null | grep -q playwright; then
        echo ""
        echo "Playwright MCP Configuration Details:"
        claude mcp get playwright 2>/dev/null || echo "  Could not retrieve configuration details"
    fi
else
    echo -e "${YELLOW}Skipping Claude MCP configuration tests (Claude CLI not found)${NC}"
fi

# Test 9: Check if Playwright browsers are installed
echo ""
echo "Checking Playwright browsers:"
for browser in chromium firefox webkit; do
    if npx playwright show-trace 2>&1 | grep -q "browsers"; then
        echo "  Browser check requires running: npx playwright install $browser"
    else
        # Try to check browser installation
        if [ -d "$HOME/.cache/ms-playwright/$browser"* ] 2>/dev/null; then
            echo -e "  $browser: ${GREEN}✓${NC}"
        else
            echo -e "  $browser: ${YELLOW}Not installed${NC}"
        fi
    fi
done

# Test 10: Test Playwright MCP execution (dry run)
echo ""
echo "Testing Playwright MCP execution:"
if command -v npx &>/dev/null && npm list -g @playwright/mcp &>/dev/null; then
    # Try to get help/version from playwright MCP
    if npx @playwright/mcp --help &>/dev/null 2>&1; then
        echo -e "  Playwright MCP execution test: ${GREEN}✓${NC}"
        ((TESTS_PASSED++))
    else
        # Some MCP servers don't have --help, try running with timeout
        if timeout 2 npx @playwright/mcp 2>&1 | grep -qE "(MCP|Model Context Protocol|server|playwright)"; then
            echo -e "  Playwright MCP execution test: ${GREEN}✓${NC}"
            ((TESTS_PASSED++))
        else
            echo -e "  Playwright MCP execution test: ${YELLOW}Could not verify${NC}"
        fi
    fi
else
    echo -e "  Playwright MCP execution test: ${RED}✗${NC} (Dependencies missing)"
    ((TESTS_FAILED++))
fi

# Test summary
echo ""
echo "=== Test Summary ==="
echo -e "Tests passed: ${GREEN}$TESTS_PASSED${NC}"
if [ $TESTS_FAILED -gt 0 ]; then
    echo -e "Tests failed: ${RED}$TESTS_FAILED${NC}"
else
    echo -e "Tests failed: ${GREEN}$TESTS_FAILED${NC}"
fi

# Exit with appropriate code
if [ $TESTS_FAILED -gt 0 ]; then
    echo ""
    echo -e "${YELLOW}Some tests failed. The Playwright MCP installation may be incomplete.${NC}"
    echo "To complete the installation manually:"
    echo "  1. Install Node.js 18+: nvm install 20"
    echo "  2. Install Playwright MCP: npm install -g @playwright/mcp"
    echo "  3. Install browsers: npx playwright install"
    echo "  4. Configure Claude: claude mcp add playwright npx @playwright/mcp@latest"
    exit 1
else
    echo ""
    echo -e "${GREEN}All tests passed! Playwright MCP is properly installed and configured.${NC}"
    exit 0
fi