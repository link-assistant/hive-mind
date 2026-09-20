# Evidence index

The complete logs are stored beside this file as gzip archives. Line numbers
refer to the uncompressed sanitized content.

## Original killed task

- Size: 14,570,060 bytes; 45,890 lines.
- Start-command launch: lines 1–18, timestamp `2026-07-25 06:53:10.298`.
- First Codex `thread.started`: line 961.
- Real tool session markers:
  - line 963, byte 128,815;
  - line 23,868, byte 7,019,300;
  - line 28,992, byte 8,980,942;
  - line 30,296, byte 9,533,304;
  - line 31,593, byte 10,077,022; and
  - line 32,747, byte 10,581,185.
- Every marker is `019f980e-a0fd-75e1-907b-9167319836ad`.
- `8b8e10af-0776-4706-aae6-72c95bebbd73` occurs zero times.
- Final captured tool activity: approximately lines 45,560–45,888.
- Wrapper footer: lines 45,889–45,890, timestamp
  `2026-07-25 11:05:51.953`.

The final real marker is 3,988,875 bytes before EOF, far beyond the historical
262,144-byte tail window.

## Failed resume task

- Size: 163,994 bytes; 847 lines.
- Hive Mind warning that the selected session log does not exist: line 518.
- Attempted ID: `8b8e10af-0776-4706-aae6-72c95bebbd73`.
- Codex `no rollout found` error: line 824, timestamp
  `2026-07-25T14:12:52.950Z`.
- Hive Mind reports command exit code 1: lines 830–832.
