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

for (const failed of [false, true]) {
  test(`image gates ${failed ? 'preserve synthetic diagnostics before failed-container cleanup' : 'exercise the search executable from both release images'}`, { timeout: 10000 }, async t => {
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
  fs.writeFileSync(args[2],args[1].endsWith('/hive-tool-data-gate-private.log')?'synthetic failure diagnostic':'synthetic image search executable',{mode:0o755});
}else if(args[0]==='exec'&&args.at(-1).includes('/verify-mounted-tool-data.mjs')&&${JSON.stringify(failed)}){
  process.exitCode=43;
}else if(args[0]==='exec'&&args.at(-1).includes('/verify-mounted-task-backing.mjs')){
  const fixture=fs.readFileSync(${JSON.stringify(state)},'utf8');
  for(const directory of ['sessions','archived_sessions','thread-writer-locks','rollout-migrations'])for(const index of [0,1])fs.writeFileSync(path.join(fixture,'home/.codex',directory,'task-'+index),'persisted');
}else if(args[0]==='image'&&args[1]==='save'){
  fs.writeFileSync(args[args.indexOf('-o')+1],'synthetic image archive');
}
`,
      { mode: 0o700 }
    );
    const pending = execute(process.execPath, [fileURLToPath(new URL('../scripts/docker-pr-verify-mount-backing.mjs', import.meta.url))], { env: { PATH: root, TMPDIR: root, RUNNER_TEMP: root }, maxBuffer: 64 * 1024 });
    if (failed) await assert.rejects(pending);
    else await pending;
    const commands = (await fs.readFile(calls, 'utf8'))
      .trim()
      .split('\n')
      .map(line => JSON.parse(line));
    const copies = commands.filter(args => args[0] === 'cp');
    if (failed) {
      const diagnostic = copies.find(args => args[1].endsWith('/hive-tool-data-gate-private.log'));
      assert.ok(diagnostic, 'copy the bounded synthetic log out of the failing container');
      assert.equal(await fs.readFile(diagnostic[2], 'utf8'), 'synthetic failure diagnostic');
      assert.equal((await fs.stat(diagnostic[2])).mode & 0o777, 0o600);
      const name = diagnostic[1].split(':')[0];
      assert.ok(commands.findIndex(args => args[0] === 'rm' && args.at(-1) === name) > commands.indexOf(diagnostic), 'preserve the diagnostic before container removal');
      return;
    }
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
}

for (const failed of [false, true]) {
  test(`the image gate waits for both tasks and cleans them up after ${failed ? 'a peer failure' : 'success'}`, { timeout: 10000 }, async t => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hive-mount-gate-unit-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const home = path.join(root, 'home');
    for (const directory of ['sessions', 'archived_sessions', 'thread-writer-locks', 'rollout-migrations']) await fs.mkdir(path.join(home, '.codex', directory), { recursive: true });
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
    else setTimeout(()=>{for(const mount of mounts.slice(1))fs.writeFileSync(mount.source+'/task-'+index,'persisted')},100);
  }
}else if(args[0]==='image')console.log('sha256:synthetic');
`,
      { mode: 0o700 }
    );
    const pending = execute(process.execPath, [fileURLToPath(new URL('../scripts/verify-mounted-task-backing.mjs', import.meta.url)), fileURLToPath(new URL('../src/hive.mjs', import.meta.url))], { env: { PATH: path.join(root, 'bin'), HIVE_MOUNT_TEST_IMAGE: 'synthetic:1', HIVE_MOUNT_TEST_EXPECTED_HOME: home, HIVE_MOUNT_TEST_FIXTURE: root }, maxBuffer: 64 * 1024 });
    if (failed) await assert.rejects(pending);
    else assert.match((await pending).stdout, /Installed-package mount backing verified/u);
    assert.equal(await fs.readFile(path.join(home, '.codex/sessions/task-1'), 'utf8'), 'persisted', 'the peer completes before the script returns, including on failure');
    assert.equal(await fs.readFile(path.join(home, '.codex/rollout-migrations/task-1'), 'utf8'), 'persisted', 'the peer journal must reach canonical storage before cleanup');
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
