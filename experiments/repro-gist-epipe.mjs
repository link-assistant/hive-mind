#!/usr/bin/env node

globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
const { $ } = await use('command-stream');

const gistId = process.argv[2] || '35d63558e0013785b384033f584d1717';

await $`gh api gists/${gistId} --jq '{owner: .owner.login, files: .files, history: .history}'`;
console.log('AFTER_GIST_FETCH');
