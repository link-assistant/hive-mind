#!/bin/bash
# Test the bash -c 'command; exec bash' pattern directly

echo "Testing bash -c 'command; exec bash' pattern..."
echo

# Test 1: Command that succeeds
echo "Test 1: Command that succeeds (echo)"
SESSION1="test-bash-success"
screen -S "$SESSION1" -X quit 2>/dev/null || true
sleep 1

screen -dmS "$SESSION1" bash -c 'echo "Success!"; sleep 1; exec bash'
sleep 2

if screen -ls | grep -q "$SESSION1"; then
    echo "   ✓ Session still alive after successful command"
    screen -S "$SESSION1" -X quit
else
    echo "   ✗ Session terminated after successful command"
fi

# Test 2: Command that fails
echo "Test 2: Command that fails"
SESSION2="test-bash-failure"
screen -S "$SESSION2" -X quit 2>/dev/null || true
sleep 1

screen -dmS "$SESSION2" bash -c 'false; echo "After failure"; sleep 1; exec bash'
sleep 2

if screen -ls | grep -q "$SESSION2"; then
    echo "   ✓ Session still alive after failed command"
    screen -S "$SESSION2" -X quit
else
    echo "   ✗ Session terminated after failed command"
fi

# Test 3: Command that doesn't exist
echo "Test 3: Command that doesn't exist"
SESSION3="test-bash-notfound"
screen -S "$SESSION3" -X quit 2>/dev/null || true
sleep 1

screen -dmS "$SESSION3" bash -c 'nonexistent-command; echo "After notfound"; sleep 1; exec bash'
sleep 2

if screen -ls | grep -q "$SESSION3"; then
    echo "   ✓ Session still alive after command not found"
    screen -S "$SESSION3" -X quit
else
    echo "   ✗ Session terminated after command not found"
fi

echo
echo "All tests completed!"
