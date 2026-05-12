import { t } from './i18n.lib.mjs';

function tr(key, params = {}, locale = null) {
  return t(key, params, { locale });
}

function addLine(parts, key, params, locale) {
  parts.push(tr(key, params, locale));
}

export function buildTelegramInfoBlock({ locale = null, requester = '', urlKind = 'url', url = '', optionsRaw = '', lockedOptions = '' } = {}) {
  const labelKey = urlKind === 'issue' ? 'telegram.info_issue_label' : urlKind === 'pullRequest' ? 'telegram.info_pull_request_label' : 'telegram.info_url_label';
  let infoBlock = `${tr('telegram.info_requested_by_label', {}, locale)}: ${requester}\n${tr(labelKey, {}, locale)}: ${url}`;
  if (optionsRaw) infoBlock += `\n\n${tr('telegram.info_options_label', {}, locale)}: ${optionsRaw}`;
  if (lockedOptions) infoBlock += `${optionsRaw ? '\n' : '\n\n'}${tr('telegram.info_locked_options_label', {}, locale)}: ${lockedOptions}`;
  return infoBlock;
}

export function buildSolveQueuedMessage({ locale = null, tool = 'claude', position = 1, infoBlock = '', reason = '' } = {}) {
  let message = tr('telegram.solve_queued', { tool, position }, locale);
  if (infoBlock) message += `\n\n${infoBlock}`;
  if (reason) message += `\n\n${tr('telegram.waiting_label', {}, locale)}: ${reason}`;
  return message;
}

export function buildTelegramHelpMessage({ locale = null, chatId, chatType = '', chatTitle = '', topicId = null, isStopped = false, stopInfo = null, stopReason = '', solveEnabled = true, taskEnabled = true, hiveEnabled = true, solveOverrides = [], hiveOverrides = [], showLimitsEnabled = false, isolationBackend = null, modelDescription = '', restrictedMode = false, authorized = null, allowTopicHint = '' } = {}) {
  const message = [];
  addLine(message, 'telegram.help_title', {}, locale);
  message.push('');

  if (isStopped) {
    addLine(message, 'telegram.help_status_stopped', {}, locale);
    addLine(message, 'telegram.help_reason', { reason: stopReason }, locale);
    if (stopInfo?.stoppedAt) addLine(message, 'telegram.help_stopped', { stoppedAt: stopInfo.stoppedAt.toISOString() }, locale);
    addLine(message, 'telegram.help_resume', {}, locale);
    message.push('');
  }

  addLine(message, 'telegram.help_diagnostic_information', {}, locale);
  addLine(message, 'telegram.help_chat_id', { chatId }, locale);
  if (topicId) addLine(message, 'telegram.help_topic_id', { topicId }, locale);
  addLine(message, 'telegram.help_chat_type', { chatType }, locale);
  addLine(message, 'telegram.help_chat_title', { chatTitle }, locale);
  message.push('');
  addLine(message, 'telegram.help_available_commands', {}, locale);
  message.push('');

  if (solveEnabled) {
    addLine(message, 'telegram.help_solve_enabled', {}, locale);
    addLine(message, 'telegram.help_solve_usage', {}, locale);
    addLine(message, 'telegram.help_solve_example', {}, locale);
    addLine(message, 'telegram.help_solve_alias_detail', {}, locale);
    addLine(message, 'telegram.help_solve_reply', {}, locale);
    if (solveOverrides.length > 0) addLine(message, 'telegram.help_locked_options', { options: solveOverrides.join(' ') }, locale);
    message.push('');
  } else {
    addLine(message, 'telegram.help_solve_disabled', {}, locale);
    message.push('');
  }

  if (taskEnabled) {
    addLine(message, 'telegram.help_task_enabled', {}, locale);
    addLine(message, 'telegram.help_task_usage', {}, locale);
    addLine(message, 'telegram.help_task_example', {}, locale);
    addLine(message, 'telegram.help_split_enabled', {}, locale);
    addLine(message, 'telegram.help_split_usage', {}, locale);
    addLine(message, 'telegram.help_split_example', {}, locale);
    message.push('');
  } else {
    addLine(message, 'telegram.help_task_disabled', {}, locale);
    message.push('');
  }

  if (hiveEnabled) {
    addLine(message, 'telegram.help_hive_enabled', {}, locale);
    addLine(message, 'telegram.help_hive_usage', {}, locale);
    addLine(message, 'telegram.help_hive_example', {}, locale);
    if (hiveOverrides.length > 0) addLine(message, 'telegram.help_locked_options', { options: hiveOverrides.join(' ') }, locale);
    message.push('');
  } else {
    addLine(message, 'telegram.help_hive_disabled', {}, locale);
    message.push('');
  }

  const simpleCommandKeys = ['telegram.help_solve_queue', 'telegram.help_limits', 'telegram.help_version', 'telegram.help_language', 'telegram.help_accept_invites', 'telegram.help_merge', 'telegram.help_merge_usage', 'telegram.help_merge_description', 'telegram.help_subscribe', 'telegram.help_help', 'telegram.help_stop_start', 'telegram.help_stop_uuid', 'telegram.help_log', 'telegram.help_terminal_watch'];
  for (const key of simpleCommandKeys) addLine(message, key, {}, locale);
  message.push('');
  addLine(message, 'telegram.help_notifications', {}, locale);
  if (isolationBackend) addLine(message, 'telegram.help_isolation_mode', { isolationBackend }, locale);
  message.push('');
  addLine(message, 'telegram.help_group_note', {}, locale);
  message.push('');
  addLine(message, 'telegram.help_common_options', {}, locale);
  addLine(message, 'telegram.help_model_option', { modelDescription }, locale);
  addLine(message, 'telegram.help_base_branch_option', {}, locale);
  addLine(message, 'telegram.help_think_option', {}, locale);
  addLine(message, 'telegram.help_verbose_option', {}, locale);
  if (showLimitsEnabled) addLine(message, 'telegram.help_show_limits_option', {}, locale);
  addLine(message, 'telegram.help_tip', {}, locale);

  if (restrictedMode) {
    message.push('');
    addLine(message, 'telegram.help_restricted_mode', { authorized: authorized ? tr('telegram.yes', {}, locale) : tr('telegram.no', {}, locale) }, locale);
    if (!authorized && allowTopicHint) addLine(message, 'telegram.help_allow_topic_hint', { allowTopicHint }, locale);
  }

  message.push('');
  message.push('');
  addLine(message, 'telegram.help_troubleshooting_header', {}, locale);
  addLine(message, 'telegram.help_troubleshooting_body', {}, locale);
  return message.join('\n');
}
