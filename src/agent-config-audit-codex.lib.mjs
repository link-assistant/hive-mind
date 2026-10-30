/** Global prompt overrides consumed by the pinned native Codex ConfigToml.
 * Reuse this list for user repair and read-only managed admission. These are
 * registrations; never follow their file paths or change prompt source data.
 */
export const CODEX_GLOBAL_INSTRUCTION_KEYS = Object.freeze(['instructions', 'developer_instructions', 'model_instructions_file', 'compact_prompt', 'experimental_compact_prompt_file', 'experimental_realtime_ws_backend_prompt', 'experimental_realtime_ws_startup_context', 'experimental_realtime_start_instructions']);
