/**
 * Formal AI wiring for Codex executions.
 *
 * Codex reads its provider from `CODEX_HOME/config.toml`. Hive Mind runs Codex
 * in a repository-scoped CODEX_HOME whose config the capability preflight
 * rewrites from the operator config before every iteration (first run,
 * auto-restart, auto-continue, resume). Formal AI writes its provider block
 * into a separate isolated home, so each iteration has to bring that block into
 * the scoped home again, and nothing may start Codex unless the config it is
 * about to load really names the Formal AI server: without the block Codex
 * falls back to the operator's OpenAI/ChatGPT provider (issue #2146).
 *
 * @see https://github.com/link-assistant/hive-mind/issues/3212
 */

import fs from 'node:fs/promises';
import path from 'node:path';

import { setTomlTableBoolean } from './codex-capability-preflight.lib.mjs';
import { isFormalAiModel } from './models/index.mjs';

export const FORMAL_AI_PROVIDER_NOT_CONFIGURED = 'Formal AI provider not configured';

/** Codex's own provider ids; a Formal AI run must never select one of them. */
const CODEX_BUILT_IN_PROVIDERS = new Set(['openai', 'oss', 'ollama', 'lmstudio']);

/** Codex answers this when a non-OpenAI model is sent to the ChatGPT backend. */
const CHATGPT_MODEL_REJECTION = /model is not supported when using codex with a chatgpt account/i;

const notConfigured = detail => {
  const error = new Error(`${FORMAL_AI_PROVIDER_NOT_CONFIGURED}: ${detail}`);
  error.isConfigurationError = true;
  return error;
};

const unquote = value => value.trim().replace(/^["']|["']$/g, '');

/**
 * Read the provider selection out of a Codex config.toml: the root-level
 * `model_provider` / `model_catalog_json` keys and every
 * `[model_providers.<id>]` table. Line-wise on purpose; Codex appends
 * `[projects."…"]` trust tables and the like, which are irrelevant here.
 */
export const readCodexProviderConfig = text => {
  const config = { modelProvider: null, modelCatalogJson: null, providers: {} };
  let section = '';
  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const line = rawLine.replace(/\s+#.*$/, '').trim();
    if (!line || line.startsWith('#')) continue;
    const header = line.match(/^\[\[?([^\]]+)\]\]?$/);
    if (header) {
      section = header[1].trim().replace(/"/g, '');
      continue;
    }
    const assignment = line.match(/^([A-Za-z0-9_.-]+)\s*=\s*(.+)$/);
    if (!assignment) continue;
    const [, key, value] = assignment;
    if (section === '' && key === 'model_provider') config.modelProvider = unquote(value);
    if (section === '' && key === 'model_catalog_json') config.modelCatalogJson = unquote(value);
    const provider = section.match(/^model_providers\.(.+)$/);
    if (provider) {
      config.providers[provider[1]] ||= {};
      config.providers[provider[1]][key] = unquote(value);
    }
  }
  return config;
};

const originOf = value => {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
};

/**
 * Copy the Formal AI provider config into the repository-scoped CODEX_HOME and
 * point the invocation at that home, so the execution keeps the environment the
 * capability preflight verified (issue #2254) and still talks to Formal AI.
 */
export const pinFormalAiCodexHome = async ({ toolInvocation, capabilityPreflight, log = async () => {}, fsImpl = fs }) => {
  if (!toolInvocation?.formalAi || toolInvocation.prepared) return;
  const formalCodexHome = toolInvocation.env?.CODEX_HOME;
  const scopedCodexHome = capabilityPreflight?.codexHome;
  if (!scopedCodexHome || !formalCodexHome) return;
  if (formalCodexHome === scopedCodexHome) {
    await log(`   🧭 Formal AI Codex home is already the verified capability state: ${scopedCodexHome}`, { verbose: true });
    return;
  }
  let formalConfig;
  try {
    formalConfig = await fsImpl.readFile(path.join(formalCodexHome, 'config.toml'), 'utf8');
  } catch (error) {
    throw notConfigured(`could not read the generated Codex config ${path.join(formalCodexHome, 'config.toml')} (${error.message})`);
  }
  const remoteSafeConfig = setTomlTableBoolean({ config: formalConfig, table: 'features', key: 'remote_plugin', value: false });
  // Issue #3785: plugins stay off unless the verified scope selected some.
  const safeFormalConfig = setTomlTableBoolean({ config: remoteSafeConfig, table: 'features', key: 'plugins', value: (capabilityPreflight.plugins?.length || 0) > 0 });
  await fsImpl.writeFile(path.join(scopedCodexHome, 'config.toml'), safeFormalConfig);
  toolInvocation.env.CODEX_HOME = scopedCodexHome;
  await log(`   🧭 Formal AI config copied from ${formalCodexHome}`, { verbose: true });
  await log(`   🧭 Formal AI pinned to verified Codex capability state: ${scopedCodexHome}`, { verbose: true });
};

/**
 * Check that the model metadata Formal AI registered for Codex is readable and
 * lists `model`. Codex otherwise warns "Model metadata for `<model>` not found"
 * and runs on fallback metadata. The catalog is written by `formal-ai with`
 * (`model_catalog_json`); Hive Mind only verifies it.
 *
 * @returns {Promise<string|null>} a problem description, or null when registered.
 */
const findModelMetadataProblem = async ({ codexHome, catalogPath, model, fsImpl }) => {
  if (!catalogPath) return 'the config has no model_catalog_json';
  const resolved = path.isAbsolute(catalogPath) ? catalogPath : path.join(codexHome, catalogPath);
  try {
    const catalog = JSON.parse(await fsImpl.readFile(resolved, 'utf8'));
    const slugs = (catalog?.models || []).map(entry => entry?.slug);
    return slugs.includes(model) ? null : `${resolved} does not list "${model}" (lists: ${slugs.join(', ') || 'none'})`;
  } catch (error) {
    return `${resolved} could not be read (${error.message})`;
  }
};

/**
 * Fail closed unless the config Codex is about to load routes the model to the
 * Formal AI server. Called immediately before Codex starts, after every edit
 * to CODEX_HOME.
 *
 * @returns {Promise<object|null>} `{ codexHome, providerId, baseUrl, modelMetadata }`,
 *   or null for runs that do not use Formal AI.
 * @throws {Error} "Formal AI provider not configured: …" (`isConfigurationError`).
 */
export const assertFormalAiCodexConfig = async ({ toolInvocation, model = 'formal-ai', log = async () => {}, fsImpl = fs }) => {
  if (!toolInvocation?.formalAi || toolInvocation.prepared) return null;
  const codexHome = toolInvocation.env?.CODEX_HOME;
  if (!codexHome) throw notConfigured('CODEX_HOME is not set, so Codex would load the operator config');
  const configPath = path.join(codexHome, 'config.toml');
  let text;
  try {
    text = await fsImpl.readFile(configPath, 'utf8');
  } catch (error) {
    throw notConfigured(`${configPath} could not be read (${error.message})`);
  }
  const config = readCodexProviderConfig(text);
  const providerId = config.modelProvider;
  if (!providerId || CODEX_BUILT_IN_PROVIDERS.has(providerId)) {
    throw notConfigured(`${configPath} selects model_provider "${providerId ?? '(unset)'}", so Codex would send the request to its built-in OpenAI/ChatGPT backend`);
  }
  const baseUrl = config.providers[providerId]?.base_url;
  if (!baseUrl) throw notConfigured(`${configPath} selects model_provider "${providerId}" but has no [model_providers.${providerId}] base_url`);
  const expectedOrigin = toolInvocation.baseUrl ? originOf(toolInvocation.baseUrl) : null;
  if (expectedOrigin && originOf(baseUrl) !== expectedOrigin) {
    throw notConfigured(`${configPath} routes model_provider "${providerId}" to ${baseUrl}, not to the Formal AI server ${toolInvocation.baseUrl}`);
  }
  const metadataProblem = await findModelMetadataProblem({ codexHome, catalogPath: config.modelCatalogJson, model, fsImpl });
  await log(`   🧭 Formal AI provider "${providerId}" → ${baseUrl} (${configPath})`, { verbose: true });
  if (metadataProblem) {
    await log(`⚠️ Formal AI: model metadata for "${model}" is not registered for Codex: ${metadataProblem}. Codex will use fallback metadata.`, { level: 'warning' });
  } else {
    await log(`   🧭 Formal AI model metadata registered: ${config.modelCatalogJson}`, { verbose: true });
  }
  return { codexHome, providerId, baseUrl, modelMetadata: metadataProblem ? { registered: false, problem: metadataProblem } : { registered: true, catalog: config.modelCatalogJson } };
};

/**
 * In a Formal AI run, Codex answering "The '<model>' model is not supported when
 * using Codex with a ChatGPT account" means the request went to the ChatGPT
 * backend instead of Formal AI: a configuration error, not an account or
 * authentication problem.
 */
export const classifyFormalAiCodexFailure = ({ model, errorSummary }) => {
  if (!isFormalAiModel(model) || !errorSummary?.hasError || !CHATGPT_MODEL_REJECTION.test(errorSummary.message || '')) return errorSummary;
  return {
    ...errorSummary,
    kind: 'configuration',
    isConfigurationError: true,
    originalMessage: errorSummary.message,
    message: `${FORMAL_AI_PROVIDER_NOT_CONFIGURED}: Codex sent the request to its ChatGPT backend instead of the Formal AI server (${errorSummary.message})`,
  };
};
