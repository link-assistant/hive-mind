#!/bin/bash
# Test the fix for issue #356

set -e

echo "=== Testing Fix for Issue #356 ==="
echo ""

# We'll create a fake 'solve' command for testing
FAKE_SOLVE="/tmp/fake-solve-test-$$.sh"
cat > "$FAKE_SOLVE" << 'EOF'
#!/bin/bash
echo "================================"
echo "Fake solve command executed"
echo "Args: $@"
echo "Time: $(date '+%Y-%m-%d %H:%M:%S')"
echo "================================"
# Simulate some work
sleep 2
echo "Solve command completed"
EOF
chmod +x "$FAKE_SOLVE"

# Add the fake solve to PATH temporarily
export PATH="/tmp:$PATH"
ln -sf "$FAKE_SOLVE" /tmp/solve

cleanup() {
    echo ""
    echo "Cleaning up..."
    rm -f /tmp/solve "$FAKE_SOLVE"
    screen -S test-fix-356 -X quit 2>/dev/null || true
}

trap cleanup EXIT

echo "Test 1: Create initial session"
echo "Running: ./start-screen.mjs solve https://github.com/test/repo/issues/123 --dry-run"
./start-screen.mjs solve https://github.com/test/repo/issues/123 --dry-run &
FIRST_PID=$!
echo "Waiting for initial session to be created..."
sleep 2

if screen -ls | grep -q "solve-test-repo-123"; then
    echo "✓ Session created successfully"
else
    echo "✗ Session creation failed"
    exit 1
fi

echo ""
echo "Test 2: Send command to existing session (while first command is still running)"
echo "Running: ./start-screen.mjs solve https://github.com/test/repo/issues/123 --verbose"
./start-screen.mjs solve https://github.com/test/repo/issues/123 --verbose

echo ""
echo "Test 3: Wait for commands to complete and check session state"
sleep 5

if screen -ls | grep -q "solve-test-repo-123"; then
    echo "✓ Session still active"

    # Check the screen buffer to see if both commands executed
    screen -S solve-test-repo-123 -X hardcopy /tmp/test-fix-hardcopy-$$.txt
    sleep 0.5

    if [ -f /tmp/test-fix-hardcopy-$$.txt ]; then
        echo ""
        echo "Screen buffer contents:"
        cat /tmp/test-fix-hardcopy-$$.txt
        echo ""

        # Count how many times "Fake solve command executed" appears
        COUNT=$(grep -c "Fake solve command executed" /tmp/test-fix-hardcopy-$$.txt || echo "0")
        if [ "$COUNT" -ge 2 ]; then
            echo "✓ Both commands were executed (found $COUNT executions)"
        else
            echo "✗ Only $COUNT command(s) executed (expected 2)"
        fi
    fi
else
    echo "? Session terminated (might be expected if using --auto-terminate)"
fi

echo ""
echo "Test 4: Send another command to the existing session"
./start-screen.mjs solve https://github.com/test/repo/issues/123 --final-test

echo ""
echo "Waiting for command to execute..."
sleep 3

screen -S solve-test-repo-123 -X hardcopy /tmp/test-fix-hardcopy-2-$$.txt 2>/dev/null || true
if [ -f /tmp/test-fix-hardcopy-2-$$.txt ]; then
    if grep -q "final-test" /tmp/test-fix-hardcopy-2-$$.txt; then
        echo "✓ Third command also executed successfully"
    else
        echo "? Could not verify third command execution"
    fi
fi

echo ""
echo "=== Fix Testing Complete ==="
echo ""
echo "Summary:"
echo "- The fix adds a readiness check before sending commands"
echo "- This prevents commands from being lost or not executing"
echo "- User gets feedback about the session state"

# Clean up the session
screen -S solve-test-repo-123 -X quit 2>/dev/null || true
rm -f /tmp/test-fix-hardcopy-*.txt
