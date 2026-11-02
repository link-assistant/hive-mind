// Exact-source selected OAuth experiment. Other backends need their own native
// canonical authority before they can be enabled under this selector.
import process from 'node:process';
import { validateNativeGeminiClient } from './reads.mjs';

const refused = () => new Error('Gemini canonical authentication is unavailable or unsafe.');
const alternateAuthorities = ['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_APPLICATION_CREDENTIALS', 'GOOGLE_CLOUD_ACCESS_TOKEN', 'GOOGLE_GENAI_USE_VERTEXAI', 'GOOGLE_GENAI_USE_GCA', 'GEMINI_FORCE_ENCRYPTED_FILE_STORAGE', 'CODE_ASSIST_ENDPOINT', 'CODE_ASSIST_API_VERSION', 'GOOGLE_GEMINI_BASE_URL', 'GOOGLE_VERTEX_BASE_URL', 'GOOGLE_GENAI_API_VERSION', 'GEMINI_API_KEY_AUTH_MECHANISM'];
const credentialHeaders = new Set(['authorization', 'proxy-authorization', 'cookie', 'x-goog-api-key', 'x-api-key', 'host', ':authority']);
let selectedAuthority;

function headersSafe(headers) {
  if (headers === undefined) return;
  if (!headers || ![null, Object.prototype].includes(Object.getPrototypeOf(headers))) throw refused();
  for (const [name, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(headers))) {
    if (!Object.hasOwn(descriptor, 'value') || !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/u.test(name) || credentialHeaders.has(name.toLowerCase()) || typeof descriptor.value !== 'string' || /[\0\r\n]/u.test(descriptor.value)) throw refused();
  }
}

export function assertNativeGeminiAuthority(content, configuration) {
  try {
    if (selectedAuthority === undefined) selectedAuthority = process.env.GEMINI_AUTH_HOME;
    if (selectedAuthority === undefined) return;
    if (process.env.GEMINI_AUTH_HOME !== selectedAuthority) throw refused();
    if (!content || content.authType !== 'oauth-personal' || content.apiKey !== undefined || content.baseUrl !== undefined || content.vertexai !== undefined) throw refused();
    if (alternateAuthorities.some(name => process.env[name] !== undefined || configuration?.env?.[name] !== undefined)) throw refused();
    if (configuration?.env?.GEMINI_AUTH_HOME !== undefined && configuration.env.GEMINI_AUTH_HOME !== process.env.GEMINI_AUTH_HOME) throw refused();
    headersSafe(content.customHeaders);
    // Match the native comma separator, then validate every effective header.
    const custom = process.env.GEMINI_CLI_CUSTOM_HEADERS;
    if (custom) {
      for (const entry of custom.split(/,(?=\s*[^,:]+:)/u)) {
        if (!entry.trim()) continue;
        const separator = entry.indexOf(':');
        if (separator < 1) throw refused();
        headersSafe({ [entry.slice(0, separator).trim()]: entry.slice(separator + 1).trim() });
      }
    }
  } catch {
    throw refused();
  }
}

export async function validateNativeGeminiRequest(client, options, configuration, target) {
  assertNativeGeminiAuthority({ authType: 'oauth-personal', customHeaders: options?.headers }, configuration);
  if (selectedAuthority === undefined) return;
  const assertCurrent = () => {
    assertNativeGeminiAuthority({ authType: 'oauth-personal', customHeaders: options?.headers }, configuration);
    try {
      const url = new globalThis.URL(target);
      if (url.origin !== 'https://cloudcode-pa.googleapis.com' || url.username || url.password || url.search || url.hash || url.href !== target || !/^\/v1internal[:/][A-Za-z][A-Za-z0-9/._-]*$/u.test(url.pathname)) throw refused();
    } catch {
      throw refused();
    }
  };
  assertCurrent();
  await validateNativeGeminiClient(client);
  assertCurrent();
}
