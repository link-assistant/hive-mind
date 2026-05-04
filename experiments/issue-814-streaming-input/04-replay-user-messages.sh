#!/bin/bash
# Experiment 04: Test --replay-user-messages flag
# This flag re-emits user messages from stdin back on stdout for acknowledgment

echo "=== Experiment 04: Testing --replay-user-messages ==="
echo "This flag should echo back user messages for acknowledgment"
echo ""

# Test with replay-user-messages flag
{
  echo '{"type":"user","message":{"role":"user","content":[{"type":"text","text":"First message: Hello"}]}}'
  sleep 2
  echo '{"type":"user","message":{"role":"user","content":[{"type":"text","text":"Second message: How are you?"}]}}'
} | claude -p \
  --output-format=stream-json \
  --input-format=stream-json \
  --replay-user-messages \
  --verbose 2>&1 | head -150

echo ""
echo "=== Test Complete ==="
