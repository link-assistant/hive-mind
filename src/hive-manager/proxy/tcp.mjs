export function directionState() {
  return { intervals: [], anchor: null, highestEnd: null, highestAck: null, lastAck: null };
}

// Bounded captures observe less than half the TCP sequence space. Interpret
// sequence and ACK numbers relative to the first observed byte in this direction.
function relative(value, anchor) {
  return (value - anchor) | 0;
}

export function recordPayload(state, start, size) {
  state.anchor ??= start;
  const low = relative(start, state.anchor);
  const high = low + size;
  state.highestEnd = Math.max(state.highestEnd ?? high, high);

  const { intervals } = state;
  let left = 0;
  let right = intervals.length;
  while (left < right) {
    const middle = Math.floor((left + right) / 2);
    if (intervals[middle][1] < low) left = middle + 1;
    else right = middle;
  }

  let from = low;
  let to = high;
  let end = left;
  let repeated = 0;
  while (end < intervals.length && intervals[end][0] <= high) {
    const [previousStart, previousEnd] = intervals[end++];
    repeated += Math.max(0, Math.min(high, previousEnd) - Math.max(low, previousStart));
    from = Math.min(from, previousStart);
    to = Math.max(to, previousEnd);
  }
  intervals.splice(left, end - left, [from, to]);
  return repeated;
}

export function recordAck(state, ack) {
  // Start unwrapping ACKs before the first payload is seen so captures taken
  // mid-connection can account for ACKs in either arrival order.
  state.anchor ??= ack;
  const value = relative(ack, state.anchor);
  state.highestAck = Math.max(state.highestAck ?? value, value);
}

export function recordAckGap(stats, state) {
  if (state.highestEnd === null || state.highestAck === null) return;
  const gap = Math.max(0, state.highestEnd - state.highestAck);
  stats.ackGapComparableFlows++;
  stats.ackGapMax = Math.max(stats.ackGapMax, gap);
  stats.ackGapSum += gap;
  if (gap > 0) stats.ackGapFlows++;
}
