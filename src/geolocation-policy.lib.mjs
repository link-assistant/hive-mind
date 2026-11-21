/** Location disclosure is opt-in for every runner (issue #4023). */
import { promptText } from './prompt-text.lib.mjs';

export const SHARE_GEOLOCATION_OPTION = Object.freeze({
  type: 'boolean',
  description: 'Allow the AI tool to collect and share geolocation when the task needs it. Location sharing is disabled by default.',
  default: false,
});

export const isGeolocationSharingEnabled = (argv = {}) => argv?.shareGeolocation === true || argv?.['share-geolocation'] === true;

/** Neutralize timezone hints in CLI-generated environment context and child tools. */
export const buildGeolocationEnv = (argv = {}) => (isGeolocationSharingEnabled(argv) ? {} : { TZ: 'UTC' });

/**
 * Empty tables merge with inherited location values in Codex. Redact every
 * supported field explicitly, preserving search mode, filters and context size.
 * Empty strings carry no user or host location; no global config is rewritten.
 */
export const buildCodexGeolocationConfigArgs = (argv = {}) => (isGeolocationSharingEnabled(argv) ? [] : ['-c', 'tools.web_search.location={country="",region="",city="",timezone=""}']);

export function withGeolocationPolicy(systemPrompt, argv = {}) {
  const directive = promptText(isGeolocationSharingEnabled(argv) ? 'prompt.system.geolocation.allowed' : 'prompt.system.geolocation.private');
  // The Claude review executor and agent-commander also accept custom prompts.
  // Keep their policy boundary idempotent when the standard builder ran first.
  return systemPrompt?.includes(directive) ? systemPrompt : [systemPrompt, directive].filter(Boolean).join('\n\n');
}
