#!/usr/bin/env bash
# Simple verification script for Playwright MCP installation

echo "=== Playwright MCP Installation Verification ==="
echo ""

# Check Node.js
echo -n "1. Node.js: "
if command -v node >/dev/null 2>&1; then
    echo "✓ $(node -v)"
else
    echo "✗ Not installed"
fi

# Check npm
echo -n "2. npm: "
if command -v npm >/dev/null 2>&1; then
    echo "✓ $(npm -v)"
else
    echo "✗ Not installed"
fi

# Check @playwright/mcp
echo -n "3. @playwright/mcp package: "
if npm list -g @playwright/mcp >/dev/null 2>&1; then
    echo "✓ Installed globally"
else
    echo "✗ Not installed (run: npm install -g @playwright/mcp)"
fi

# Check Claude CLI
echo -n "4. Claude CLI: "
if command -v claude >/dev/null 2>&1; then
    echo "✓ $(claude --version 2>/dev/null | head -1 || echo 'Installed')"
else
    echo "✗ Not installed"
fi

# Check MCP configuration
echo -n "5. Playwright MCP in Claude: "
if command -v claude >/dev/null 2>&1; then
    if claude mcp list 2>/dev/null | grep -q playwright; then
        echo "✓ Configured"
        echo ""
        echo "   Configuration details:"
        claude mcp get playwright 2>/dev/null | sed 's/^/   /'
    else
        echo "✗ Not configured (run: claude mcp add playwright npx @playwright/mcp@latest)"
    fi
else
    echo "⚠ Claude not available"
fi

echo ""
echo "=== Installation Commands ==="
echo "If any components are missing, run these commands:"
echo ""
echo "# Install Node.js (if needed):"
echo "curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash"
echo "source ~/.bashrc"
echo "nvm install 20"
echo ""
echo "# Install Playwright MCP:"
echo "npm install -g @playwright/mcp"
echo "npx playwright install"
echo ""
echo "# Configure with Claude CLI:"
echo "claude mcp add playwright npx @playwright/mcp@latest"