/** @hive-mind-test-suite default */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execute = promisify(execFile);

test('both daemon gates exercise the search executable from their release image', { timeout: 10000 }, async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hive-image-search-gate-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const calls = path.join(root, 'calls.jsonl');
  const state = path.join(root, 'fixture');
  await fs.writeFile(
    path.join(root, 'docker'),
    `#!${process.execPath}
const fs=require('node:fs');
const path=require('node:path');
const args=process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(calls)},JSON.stringify(args)+'\\n');
if(args[0]==='run'){
  const mount=args.find(arg=>arg.startsWith('type=bind,source=')&&arg.endsWith('target=/mount-fixture'));
  fs.writeFileSync(${JSON.stringify(state)},mount.split(',')[1].slice(7));
}else if(args[0]==='cp'){
  fs.writeFileSync(args[2],'synthetic image search executable',{mode:0o755});
}else if(args[0]==='exec'&&args.at(-1).includes('/verify-mounted-task-backing.mjs')){
  const fixture=fs.readFileSync(${JSON.stringify(state)},'utf8');
  for(const index of [0,1])fs.writeFileSync(path.join(fixture,'home/.codex/sessions/task-'+index),'persisted');
}else if(args[0]==='image'&&args[1]==='save'){
  fs.writeFileSync(args[args.indexOf('-o')+1],'synthetic image archive');
}
`,
    { mode: 0o700 }
  );
  await execute(process.execPath, [fileURLToPath(new URL('../scripts/docker-pr-verify-mount-backing.mjs', import.meta.url))], { env: { PATH: root, TMPDIR: root }, maxBuffer: 64 * 1024 });
  const commands = (await fs.readFile(calls, 'utf8'))
    .trim()
    .split('\n')
    .map(line => JSON.parse(line));
  const copies = commands.filter(args => args[0] === 'cp');
  assert.equal(copies.length, 2, 'each release image must supply its own installed search executable');
  const gates = commands.filter(args => args[0] === 'exec' && args.at(-1).includes('/verify-mounted-tool-data.mjs'));
  assert.equal(gates.length, 2);
  for (const [index, args] of gates.entries()) {
    const name = args[args.indexOf('bash') - 1];
    assert.equal(copies[index][1], `${name}:/home/box/.local/bin/rg`);
    const home = args.find(arg => arg.startsWith('HIVE_MOUNT_TEST_EXPECTED_HOME=')).split('=')[1];
    assert.ok(args.includes(`HIVE_MOUNT_TEST_SEARCH_SOURCE=${path.join(path.dirname(home), 'rg')}`), 'the copied image executable must use the selected daemon namespace');
    assert.ok(commands.indexOf(copies[index]) < commands.indexOf(args), 'copy must precede task admission');
    assert.ok(commands.some(command => command[0] === 'rm' && command.at(-1) === name));
  }
});

for (const failed of [false, true]) {
  test(`the image gate waits for both tasks and cleans them up after ${failed ? 'a peer failure' : 'success'}`, { timeout: 10000 }, async t => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hive-mount-gate-unit-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const home = path.join(root, 'home');
    await fs.mkdir(path.join(home, '.codex/sessions'), { recursive: true });
    await fs.mkdir(path.join(root, 'bin'));
    await fs.writeFile(path.join(home, '.codex/auth.json'), '{"synthetic":"canonical"}');
    const calls = path.join(root, 'calls.jsonl');
    await fs.writeFile(
      path.join(root, 'bin/docker'),
      `#!${process.execPath}
const fs=require('node:fs');
const args=process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(calls)},JSON.stringify(args)+'\\n');
if(args[0]==='run'){
  const mounts=args.filter(arg=>arg.startsWith('type=bind,source=')).map(arg=>Object.fromEntries(arg.split(',').map(item=>item.split('='))));
  if(mounts[0].target.startsWith('/__hive_mount_probe/')){
    console.log(JSON.stringify(mounts.map(mount=>{const s=fs.statSync(mount.source,{bigint:true});return s.dev+':'+s.ino+':'+(s.isDirectory()?'directory':'file');})));
  }else{
    const index=args.at(-1);
    if(${JSON.stringify(failed)} && index==='0')process.exitCode=7;
    else setTimeout(()=>fs.writeFileSync(mounts[1].source+'/task-'+index,'persisted'),100);
  }
}else if(args[0]==='image')console.log('sha256:synthetic');
`,
      { mode: 0o700 }
    );
    const pending = execute(process.execPath, [fileURLToPath(new URL('../scripts/verify-mounted-task-backing.mjs', import.meta.url)), fileURLToPath(new URL('../src/hive.mjs', import.meta.url))], { env: { PATH: path.join(root, 'bin'), HIVE_MOUNT_TEST_IMAGE: 'synthetic:1', HIVE_MOUNT_TEST_EXPECTED_HOME: home, HIVE_MOUNT_TEST_FIXTURE: root }, maxBuffer: 64 * 1024 });
    if (failed) await assert.rejects(pending);
    else assert.match((await pending).stdout, /Installed-package mount backing verified/u);
    assert.equal(await fs.readFile(path.join(home, '.codex/sessions/task-1'), 'utf8'), 'persisted', 'the peer completes before the script returns, including on failure');
    const commands = (await fs.readFile(calls, 'utf8'))
      .trim()
      .split('\n')
      .map(line => JSON.parse(line));
    const children = commands
      .filter(args => args[0] === 'run' && args.includes('--name'))
      .map(args => args[args.indexOf('--name') + 1])
      .filter(name => name.startsWith('hive-mount-contract-'));
    assert.equal(children.length, 2);
    for (const name of children) assert.ok(commands.some(args => args[0] === 'rm' && args.at(-1) === name));
    assert.equal(await fs.readFile(path.join(home, '.codex/auth.json'), 'utf8'), '{"synthetic":"canonical"}');
  });
}
