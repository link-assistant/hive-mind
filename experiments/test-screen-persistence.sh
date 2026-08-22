#!/bin/bash
# Test that screen session persists after command completion

echo "Testing screen session persistence..."
echo

# Clean up any existing test sessions
screen -S test-persistence-session -X quit 2>/dev/null || true
sleep 1

# Create a screen session with a simple echo command that finishes immediately
echo "1. Creating screen session with a command that finishes quickly..."
screen -dmS test-persistence-session bash -c 'echo "Command executed!"; sleep 1; exec bash'

echo "   Waiting for command to complete..."
sleep 2

# Check if the screen session still exists
echo "2. Checking if screen session still exists..."
if screen -ls | grep -q test-persistence-session; then
    echo "   ✓ SUCCESS: Screen session 'test-persistence-session' is still alive!"

    # Try to send a command to the screen
    echo "3. Testing if we can send commands to the session..."
    screen -S test-persistence-session -X stuff "echo 'Hello from test!'\n"
    sleep 1

    echo "   ✓ Command sent successfully"

    # Clean up
    echo "4. Cleaning up..."
    screen -S test-persistence-session -X quit
    echo "   ✓ Test session terminated"

    echo
    echo "=== TEST PASSED ==="
    exit 0
else
    echo "   ✗ FAILURE: Screen session terminated after command completion"
    echo
    echo "=== TEST FAILED ==="
    exit 1
fi
