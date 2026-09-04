# Hive Mind router wiring, as pinned at commit e062446e

Captured 2026-09-04 from `src/router-isolation.lib.mjs` and `src/router-sidecar.lib.mjs`.
Line numbers are `file:line` from that commit.

## Router image pin

```
55:export const ROUTER_SIDECAR_IMAGE = 'ghcr.io/link-assistant/router:0.119.0';
```

## Base URLs handed to the agentic CLIs (legacy, pre-router-1.0 route shapes)

```js
88: * `/v1/messages` at its root, so `ANTHROPIC_BASE_URL` needs no path suffix.
206: * host's REST base as `https://<host>/api/v3/` with no plaintext option, so the
267:    ['url.' + `${routerUrl}git/` + '.insteadOf', 'https://github.com/'],
277: * `ANTHROPIC_BASE_URL` is the important one: Claude Code sends *every* request
306:    taskEnv.ANTHROPIC_BASE_URL = baseUrl;
312:    // OPENAI_BASE_URL and needs the generated provider entry written by
314:    taskEnv.OPENAI_BASE_URL = `${baseUrl}/v1`;
334: * Codex 0.147 ignores `OPENAI_BASE_URL` (measured: it kept calling
340:  return `model_provider = "${CODEX_PROVIDER_ID}"\n\n[model_providers.${CODEX_PROVIDER_ID}]\nname = "Hive Mind Router"\nbase_url = "${baseUrl}/v1"\nenv_key = "OPENAI_API_KEY"\nwire_api = "responses"\n`;
```

## Credential mounts

```js
// Vendor credential homes inside the sidecar. The router reads each from its
// matching `*_HOME` variable; mounting them here is what makes the sidecar the
// only point of contact with the subscription (R3). `~/.config/gh` is mounted
// read-only: the router only ever reads the token out of `hosts.yml`, and a
// writable mount would let a proxied call rewrite the operator's own gh state.
export const ROUTER_CREDENTIAL_MOUNTS = Object.freeze([Object.freeze({ home: '.claude', target: '/data/claude', envVar: 'CLAUDE_CODE_HOME' }), Object.freeze({ home: '.codex', target: '/data/codex', envVar: 'CODEX_HOME' }), Object.freeze({ home: '.gemini', target: '/data/gemini', envVar: 'GEMINI_HOME' }), Object.freeze({ home: '.qwen', target: '/data/qwen', envVar: 'QWEN_HOME' })]);

/** The gh credential the router presents upstream, mounted read-only (R12). */
export const ROUTER_GH_CONFIG_MOUNT = Object.freeze({ home: '.config/gh', target: '/data/gh', envVar: 'GH_CONFIG_DIR', readOnly: true });

/**
 * Tools whose CLI speaks the Anthropic Messages API. The router serves
 * `/v1/messages` at its root, so `ANTHROPIC_BASE_URL` needs no path suffix.
 */
const ANTHROPIC_TOOLS = new Set(['claude', 'agent']);

/** Provider id written into a routed task's `config.toml` (codex). */
const CODEX_PROVIDER_ID = 'hive-mind-router';

const normalizeTool = tool => String(tool || 'claude').toLowerCase();

const isFalsey = value =>
  ['0', 'false', 'no'].includes(
    String(value || '')
      .trim()
      .toLowerCase()
  );

/**
 * Is router isolation requested for this run?
 *
 * The flag is the primary switch; `HIVE_MIND_USE_ROUTER` exists so the Telegram
 * bot and nested `solve` invocations inherit the decision without every layer
 * having to thread an argument through.
 */
```

## Model catalogue route referenced by Hive Mind

```js
380: * the call, GET /v1/models advertises `{"id":"formal-ai","owned_by":
493:    gaps.push(`The router resolves exact model ids only, as advertised by GET /v1/models — an alias like '${requested}' is rejected, and the refusal lists the ids it would have accepted. Use one of those (for example claude-sonnet-4-5-20250929).`);
```
