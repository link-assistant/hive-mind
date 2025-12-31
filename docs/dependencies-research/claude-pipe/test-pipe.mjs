#!/usr/bin/env node

// Dynamic import of use-m from unpkg
const { use } = eval(await (await fetch('https://unpkg.com/use-m/use.js')).text());

// Use command-stream for consistent $ behavior across runtimes
const { $ } = await use('command-stream');

// import { $ } from "bun";

const claude = process.env.CLAUDE_PATH || '/Users/konard/.claude/local/claude';

console.log('=== Claude Pipe to jq Test ===\n');

try {
  // Simple test: pipe claude output to jq
  // await $`${claude} -p "hi" --output-format stream-json --verbose --model sonnet | jq`;
  // await $`claude -p "hi" --output-format stream-json --verbose --model sonnet | jq`;

  // $`claude -p "hi" --output-format stream-json --verbose --model sonnet | jq`.sync();

  // $`${claude} -p "hi" --output-format stream-json --verbose --model sonnet | jq`.sync();

  // await $`claude -p "hi" --output-format stream-json --verbose --model sonnet | jq`.async();

  // await $`${claude} -p "hi" --output-format stream-json --verbose --model sonnet | jq`.async();

  // $`claude -p "hi" --output-format stream-json --verbose --model sonnet`.sync();

  // $`${claude} -p "hi" --output-format stream-json --verbose --model sonnet`.sync();

  // const command = $`${claude} -p "hi" --output-format stream-json --verbose --model sonnet`;
  // const command = $`${claude} -p "hi" --output-format stream-json --verbose --model sonnet | jq`;
  // const command = $`ping 8.8.8.8`;
  // command.on('data', (data) => {
  //   console.log('🟢 Claude output:', data);
  // });
  // command.on('error', (error) => {
  //   console.error('🔴 Claude error:', error);
  // });
  // command.on('end', () => {
  //   console.log('🔵 Claude stream ended');
  // });
  // await command.start();

  // await $`${claude} -p "hi" --output-format stream-json --verbose --model sonnet`;

  const command = $({ stdin: 'hi\n', mirror: false })`${claude} --output-format stream-json --verbose --model sonnet`;

  // Working example 1
  // command.on('data', (chunk) => {
  //   const chunkString = chunk.data.toString();
  //   const chunkJson = JSON.parse(chunkString.trim());
  //   const formattedChunkJson = JSON.stringify(chunkJson, null, 2);
  //   console.log('🟢 Claude output:', formattedChunkJson);
  // });

  // Working example 2
  for await (const chunk of command.stream()) {
    if (chunk.type === 'stdout') {
      const chunkString = chunk.data.toString();
      const chunkJson = JSON.parse(chunkString.trim());
      const formattedChunkJson = JSON.stringify(chunkJson, null, 2);
      console.log('🟢 Claude output:', formattedChunkJson);
    }
  }

  await command;
} catch (error) {
  console.error('❌ Test failed:', error.message);
  process.exit(1);
}
