#!/bin/bash
# Experiment 06: FIFO (Named Pipe) based streaming test
# Uses a named pipe to simulate continuous input while reading output

echo "=== Experiment 06: FIFO-based Bidirectional Streaming ==="
echo "Testing with named pipes for more control over input timing"
echo ""

# Create temp directory and FIFO
TMPDIR=$(mktemp -d)
INPUT_FIFO="$TMPDIR/claude_input"
OUTPUT_FILE="$TMPDIR/claude_output.log"

mkfifo "$INPUT_FIFO"
echo "Created FIFO: $INPUT_FIFO"

# Start Claude reading from FIFO in background
cat "$INPUT_FIFO" | claude -p \
  --output-format=stream-json \
  --input-format=stream-json \
  2>&1 > "$OUTPUT_FILE" &
CLAUDE_PID=$!

echo "Claude started with PID: $CLAUDE_PID"

# Give it a moment to start
sleep 1

# Function to send a message to the FIFO
send_message() {
  local text="$1"
  local msg=$(jq -nc --arg t "$text" '{type:"user",message:{role:"user",content:[{type:"text",text:$t}]}}')
  echo "[SENDING]: $text"
  echo "$msg" > "$INPUT_FIFO"
}

# Open FIFO for writing (keeps it open)
exec 3>"$INPUT_FIFO"

# Send first message
send_message "Start counting from 1. I will interrupt you."

# Monitor output while sending more input
for i in {1..3}; do
  sleep 2
  echo "[OUTPUT SO FAR]:"
  tail -5 "$OUTPUT_FILE" 2>/dev/null || echo "(no output yet)"
  echo ""

  if [ $i -lt 3 ]; then
    send_message "Interruption $i: Please acknowledge this interrupt and continue."
  fi
done

# Close FIFO
exec 3>&-

# Wait for Claude to finish
sleep 3
echo ""
echo "[FINAL OUTPUT]:"
cat "$OUTPUT_FILE" | head -50

# Cleanup
kill $CLAUDE_PID 2>/dev/null
rm -rf "$TMPDIR"

echo ""
echo "=== Test Complete ==="
