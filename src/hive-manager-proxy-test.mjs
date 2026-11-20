import { randomBytes } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { clearTimeout, setTimeout } from 'node:timers';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { readBoundedFile } from './hive-manager-files.lib.mjs';

const usage = `Usage: hive-manager proxy-test --session-file FILE [OPTIONS]
Check a Telegram user session by writing, reading and deleting a marker in Saved Messages.

  --credentials FILE   Private JSON with apiId and apiHash (or set TELEGRAM_API_ID and TELEGRAM_API_HASH)
  --session-file FILE  File containing a pre-authorized Telegram StringSession
  --proxy-host HOST    MTProto proxy DNS name or IP address
  --proxy-port PORT    MTProto proxy port (default: 443)
  --secret-file FILE   File containing the MTProto proxy secret
  --direct             Exercise the same API checks without a proxy
  --matrix FILE        Compare up to 12 named direct and proxy routes from a JSON file
  --media              Verify a 32 KiB document round trip by comparing bytes
  --photo FILE         Test a selected JPEG or PNG of at most 256 KiB
  --timeout SECONDS    Per-step deadline from 1 to 120 seconds (default: 30)
`;

function photoType(data) {
  if (!Buffer.isBuffer(data) || data.length < 24) return null;
  if (data.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) return 'png';
  if (data.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex'))) return 'jpg';
  return null;
}

async function attempt(operation, label, timeout) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error()), timeout * 1000);
      }),
    ]);
  } catch {
    throw new Error(`Telegram probe ${label} failed or timed out.`);
  } finally {
    clearTimeout(timer);
  }
}

export async function runProxyProbe(client, { media = false, photo = null, timeout = 30 } = {}) {
  const ids = [];
  const result = { text: false, document: null, photo: null, cleaned: false };
  const marker = `Hive Mind proxy probe ${randomBytes(12).toString('hex')}`;
  const run = (label, operation) => attempt(operation, label, timeout);
  let sending = false;
  const send = async (label, operation) => {
    sending = true;
    const message = await run(label, operation);
    if (!Number.isSafeInteger(message?.id) || message.id <= 0) throw new Error('Telegram returned a message without an ID.');
    ids.push(message.id);
    sending = false;
    return message.id;
  };
  const receive = async id => {
    const [received] = await run('read', () => client.getMessages('me', { ids: [id] }));
    if (!received || received.id !== id) throw new Error('Could not verify the probe message in Saved Messages.');
    return received;
  };
  const transfer = async (data, filename, forceDocument) => {
    const file = Object.assign(Buffer.from(data), { name: filename });
    const id = await send('upload', () => client.sendFile('me', { file, forceDocument, caption: marker, workers: 1 }));
    const received = await receive(id);
    if (!received.media) throw new Error('Telegram did not return the uploaded probe media.');
    return run('download', () => client.downloadMedia(received, {}));
  };

  let failure;
  try {
    await run('connection', () => client.connect());
    if (!(await run('authorization', () => client.checkAuthorization()))) throw new Error('The supplied Telegram session is unauthorized.');
    const id = await send('send', () => client.sendMessage('me', { message: marker }));
    const text = await receive(id);
    if (text.message !== marker) throw new Error('Telegram returned a different probe marker.');
    result.text = true;
    if (media) {
      const document = randomBytes(32 * 1024);
      const received = await transfer(document, 'hive-manager-probe.bin', true);
      if (!Buffer.isBuffer(received) || !document.equals(received)) throw new Error('The downloaded document differs from the probe document.');
      result.document = received.length;
    }
    if (photo) {
      const received = await transfer(photo, `hive-manager-probe.${photoType(photo)}`, false);
      if (!photoType(received)) throw new Error('Telegram did not return a JPEG or PNG photo.');
      result.photo = received.length;
    }
  } catch (error) {
    failure = error;
  } finally {
    try {
      if (ids.length) await run('cleanup', () => client.deleteMessages('me', ids, { revoke: true }));
      result.cleaned = true;
    } catch (error) {
      failure = new Error(`${failure ? `${failure.message} ` : ''}${error.message} Check Saved Messages for the probe marker.`);
    } finally {
      try {
        await run('disconnect', () => client.destroy());
      } catch (error) {
        failure ??= error;
      }
    }
  }
  if (failure && sending) throw new Error(`${failure.message} Check Saved Messages for any remaining probe marker.`);
  if (failure) throw failure;
  return result;
}

async function proxyFromFile(host, port, secretFile) {
  if (typeof host !== 'string' || !/^[a-z\d:][a-z\d.:-]*$/i.test(host) || !/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535 || typeof secretFile !== 'string' || !secretFile) {
    throw new Error('Provide a valid proxy host, port and secret file.');
  }
  let secret = (await readBoundedFile(secretFile, 1024, 'proxy secret')).toString('utf8').trim().toLowerCase();
  if (/^[\da-f]{32}$/.test(secret)) secret = `dd${secret}`;
  if (!/^(?:dd[\da-f]{32}|ee[\da-f]{32}(?:[\da-f]{2})+)$/.test(secret)) throw new Error('Invalid MTProto proxy secret.');
  return { host, port: Number(port), secret };
}

export async function readProxyMatrix(file) {
  let profiles;
  try {
    const data = await readBoundedFile(file, 32 * 1024, 'proxy matrix');
    profiles = JSON.parse(data.toString('utf8'));
  } catch {
    throw new Error('Supply a proxy matrix JSON file of at most 32 KiB.');
  }
  if (!Array.isArray(profiles) || profiles.length < 1 || profiles.length > 12) throw new Error('A proxy matrix needs between 1 and 12 profiles.');
  const routes = new Map();
  for (const profile of profiles) {
    if (typeof profile?.name !== 'string' || !/^[a-z\d][a-z\d-]{0,47}$/.test(profile.name) || routes.has(profile.name)) throw new Error('Each proxy matrix profile needs a unique lowercase name.');
    const { name, direct, host, port = 443, secretFile } = profile;
    if (direct === true) {
      if (host !== undefined || profile.port !== undefined || secretFile !== undefined) throw new Error(`Direct profile ${name} cannot specify proxy options.`);
      routes.set(name, null);
      continue;
    }
    if (typeof secretFile !== 'string' || !secretFile || (direct !== undefined && direct !== false)) throw new Error(`Proxy profile ${name} needs a path to a secret file.`);
    routes.set(name, await proxyFromFile(host, port, resolve(dirname(file), secretFile)));
  }
  return routes;
}

export async function runProxyMatrix(routes, createClient, options) {
  const results = [];
  for (const [name, proxy] of routes) {
    try {
      results.push({ name, route: proxy ? 'proxy' : 'direct', ok: true, ...(await runProxyProbe(createClient(proxy), options)) });
    } catch (error) {
      results.push({ name, route: proxy ? 'proxy' : 'direct', ok: false, error: error.message });
    }
  }
  return results;
}

async function main() {
  let values;
  try {
    ({ values } = parseArgs({
      options: {
        help: { type: 'boolean', short: 'h' },
        'session-file': { type: 'string' },
        credentials: { type: 'string' },
        'proxy-host': { type: 'string' },
        'proxy-port': { type: 'string' },
        'secret-file': { type: 'string' },
        direct: { type: 'boolean' },
        matrix: { type: 'string' },
        media: { type: 'boolean' },
        photo: { type: 'string' },
        timeout: { type: 'string', default: '30' },
      },
    }));
  } catch {
    throw new Error('Invalid proxy-test arguments. Run proxy-test --help.');
  }
  if (values.help) {
    process.stdout.write(usage);
    return;
  }
  if (!values['session-file']) throw new Error('Provide --session-file.');
  const timeout = Number(values.timeout);
  if (!/^\d+$/.test(values.timeout) || timeout < 1 || timeout > 120) throw new Error('Timeout must be between 1 and 120 seconds.');

  let apiId = process.env.TELEGRAM_API_ID;
  let apiHash = process.env.TELEGRAM_API_HASH;
  if (values.credentials) {
    const contents = await readBoundedFile(values.credentials, 4096, 'Telegram credentials');
    try {
      ({ apiId, apiHash } = JSON.parse(contents.toString('utf8')));
    } catch {
      throw new Error('Telegram credentials must be JSON containing apiId and apiHash.');
    }
  }
  if (!/^\d+$/.test(String(apiId)) || Number(apiId) < 1 || Number(apiId) > 2147483647 || typeof apiHash !== 'string' || !/^[\da-f]{32}$/i.test(apiHash)) {
    throw new Error('Supply a valid Telegram API ID and hash through --credentials or the documented environment variables.');
  }
  let proxy = null;
  let routes;
  const hasProxyOptions = ['proxy-host', 'proxy-port', 'secret-file'].some(option => values[option] !== undefined);
  if (values.matrix !== undefined) {
    if (values.direct || hasProxyOptions) throw new Error('Specify direct and proxy routes inside the matrix file.');
    routes = await readProxyMatrix(values.matrix);
  } else if (values.direct) {
    if (hasProxyOptions) throw new Error('Use either a proxy or --direct.');
  } else {
    proxy = await proxyFromFile(values['proxy-host'], values['proxy-port'] ?? '443', values['secret-file']);
  }
  const photo = values.photo ? await readBoundedFile(values.photo, 256 * 1024, 'probe photo') : null;
  if (photo && !photoType(photo)) throw new Error('Probe photo must be JPEG or PNG.');
  const session = (await readBoundedFile(values['session-file'], 8192, 'Telegram session')).toString('utf8').trim();
  let telegram;
  try {
    telegram = (await import('teleproto')).default;
  } catch {
    throw new Error('Could not load teleproto from this Hive Mind installation.');
  }
  const { Logger, MTProxyTransport, TelegramClient, sessions } = telegram;
  const createClient = route => {
    try {
      return new TelegramClient(new sessions.StringSession(session), Number(apiId), apiHash, {
        baseLogger: new Logger('none'),
        connectionRetries: 1,
        requestRetries: 1,
        floodSleepThreshold: 0,
        ...(route && { transport: new MTProxyTransport(route) }),
      });
    } catch {
      throw new Error('Could not initialize the Telegram client. Check the StringSession and proxy configuration.');
    }
  };
  const options = { photo, media: values.media, timeout };
  if (routes) {
    const results = await runProxyMatrix(routes, createClient, options);
    process.stdout.write(`${JSON.stringify({ results }, null, 2)}\n`);
    if (results.some(result => !result.ok)) process.exitCode = 1;
    return;
  }
  const result = await runProxyProbe(createClient(proxy), options);
  process.stdout.write(`${JSON.stringify({ route: proxy ? 'proxy' : 'direct', ...result }, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    await main();
  } catch (error) {
    process.stderr.write(`hive-manager: ${error.message}\n`);
    process.exitCode = 1;
  }
}
