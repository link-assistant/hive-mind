#!/bin/bash
# Experiment 02: Multi-turn conversation via stream-json input
# This tests if we can send multiple user messages in sequence via stdin

echo "=== Experiment 02: Multi-Turn Stream-JSON Input ==="
echo "Testing if multiple messages can be sent via stdin"
echo ""

# Send multiple user messages - each message is a separate JSON line
{
  echo '{"type":"user","message":{"role":"user","content":[{"type":"text","text":"Remember the number 42"}]}}'
  sleep 1
  echo '{"type":"user","message":{"role":"user","content":[{"type":"text","text":"What number did I ask you to remember?"}]}}'
} | claude -p --output-format=stream-json --input-format=stream-json --verbose 2>&1 | head -150

echo ""
echo "=== Test Complete ==="
