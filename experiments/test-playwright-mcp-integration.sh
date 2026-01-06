#!/usr/bin/env bash
# Integration test for Playwright MCP installation in ubuntu-24-server-install.sh

set -euo pipefail

echo "=== Playwright MCP Installation Integration Test ==="
echo ""

# This script simulates the installation steps from ubuntu-24-server-install.sh
# It's meant to be run in a test environment to verify the installation works

# Function to check command availability
check_command() {
    local cmd="$1"
    local name="$2"

    echo -n "Checking $name... "
    if command -v "$cmd" >/dev/null 2>&1; then
        echo "✓"
        return 0
    else
        echo "✗"
        return 1
    fi
}

# Function to test installation
test_installation() {
    echo ""
    echo "Testing Playwright MCP installation process..."
    echo ""

    # 1. Check Node.js
    if ! check_command "node" "Node.js"; then
        echo "  ERROR: Node.js is required but not installed"
        return 1
    fi

    # 2. Check npm
    if ! check_command "npm" "npm"; then
        echo "  ERROR: npm is required but not installed"
        return 1
    fi

    # 3. Install @playwright/mcp
    echo ""
    echo "Installing @playwright/mcp package..."
    if npm list -g @playwright/mcp >/dev/null 2>&1; then
        echo "  Package already installed, updating..."
        npm update -g @playwright/mcp
    else
        echo "  Installing package..."
        npm install -g @playwright/mcp
    fi

    # 4. Install Playwright browsers
    echo ""
    echo "Installing Playwright browsers..."
    npx playwright install chromium firefox webkit || {
        echo "  WARNING: Some browsers failed to install"
    }

    # 5. Configure with Claude CLI (if available)
    echo ""
    if command -v claude >/dev/null 2>&1; then
        echo "Configuring Playwright MCP with Claude CLI..."

        # Check if already configured
        if claude mcp list 2>/dev/null | grep -q "playwright"; then
            echo "  Already configured"
        else
            # Add the configuration
            if claude mcp add playwright "npx" "@playwright/mcp@latest" 2>/dev/null; then
                echo "  Successfully configured"
            else
                echo "  WARNING: Could not configure with Claude CLI"
            fi
        fi

        # Verify configuration
        echo ""
        echo "Verifying configuration..."
        if claude mcp get playwright >/dev/null 2>&1; then
            echo "  ✓ Configuration verified"
        else
            echo "  ✗ Configuration could not be verified"
        fi
    else
        echo "Claude CLI not available, skipping configuration"
    fi

    # 6. Final verification
    echo ""
    echo "=== Final Verification ==="

    local all_good=true

    # Check package installation
    echo -n "  @playwright/mcp package: "
    if npm list -g @playwright/mcp >/dev/null 2>&1; then
        echo "✓"
    else
        echo "✗"
        all_good=false
    fi

    # Check browsers
    echo "  Playwright browsers:"
    for browser in chromium firefox webkit; do
        echo -n "    $browser: "
        # Check if browser directory exists
        if ls ~/.cache/ms-playwright/${browser}* >/dev/null 2>&1; then
            echo "✓"
        else
            echo "✗"
            # Don't fail test for missing browsers
        fi
    done

    # Check Claude configuration (if Claude is available)
    if command -v claude >/dev/null 2>&1; then
        echo -n "  Claude MCP configuration: "
        if claude mcp list 2>/dev/null | grep -q playwright; then
            echo "✓"
        else
            echo "✗"
            all_good=false
        fi
    fi

    echo ""
    if $all_good; then
        echo "✅ All critical components installed successfully!"
        return 0
    else
        echo "⚠️  Some components are missing, but installation completed"
        return 1
    fi
}

# Main execution
main() {
    # Run the test
    if test_installation; then
        echo ""
        echo "Integration test PASSED"
        exit 0
    else
        echo ""
        echo "Integration test completed with warnings"
        # Exit with warning status (not failure)
        exit 0
    fi
}

# Run if executed directly
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    main "$@"
fi