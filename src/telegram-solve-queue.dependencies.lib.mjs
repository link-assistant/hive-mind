/**
 * SolveQueue methods for items that wait for other tasks (issue #4069).
 *
 * Kept out of `telegram-solve-queue.lib.mjs` so that file stays under the
 * line limit. `installSolveQueueDependencyMethods` adds them to the class.
 *
 * @see ./telegram-solve-dependencies.lib.mjs
 * @see https://github.com/link-assistant/hive-mind/issues/4069
 */

import { canonicalizeGitHubUrl as canonicalizeQueueUrl } from './github-url-parser.lib.mjs';
import { t } from './i18n.lib.mjs';
import { escapeMarkdown } from './telegram-markdown.lib.mjs';
import { QUEUE_CONFIG } from './queue-config.lib.mjs';
import { formatQueueItemLink } from './telegram-solve-queue.helpers.lib.mjs';

const QUEUED = 'queued';

export const solveQueueDependencyMethods = {
  /** Every awaited task is done: queue the item like any other `/solve`. */
  async releaseWaitingItem({ item }, summary) {
    item.status = QUEUED;
    item.waitingReason = null;
    item.dependencySummary = summary;
    const toolQueue = this.getToolQueue(item.tool);
    toolQueue.push(item);
    if (this.autoStart) this.ensureConsumerRunning();
    await this.updateItemMessage(item, `${t('telegram.solve_after_released', { tasks: escapeMarkdown(summary) }, { locale: item.locale })}\n\n${item.infoBlock}`, false);
  },
  /** An awaited task failed (`success` mode): the item fails without starting. */
  async failWaitingItem({ item }, reason) {
    item.setFailed(reason);
    this.failed.push(item);
    while (this.failed.length > 100) this.failed.shift();
    this.stats.totalFailed++;
    await this.updateItemMessage(item, t('telegram.solve_rejected', { infoBlock: item.infoBlock, reason: t('telegram.solve_after_dependency_failed', { task: escapeMarkdown(reason) }, { locale: item.locale }) }, { locale: item.locale }), false);
  },
  /** Recheck items that wait for other tasks; never throws. */
  reconcileDependencies() {
    if (this.dependencies.size === 0) return Promise.resolve({ released: [], failed: [] });
    return this.dependencies.reconcile().catch(error => {
      console.error(`[solve_queue] Dependency recheck failed: ${error?.message || error}`);
      return { released: [], failed: [] };
    });
  },
  /** The launched (or launching) item whose session has this name. */
  findItemBySession(name) {
    if (!name) return null;
    const key = String(name).toLowerCase();
    const matches = item => item?.sessionName && String(item.sessionName).toLowerCase() === key;
    for (const item of this.processing.values()) if (matches(item)) return item;
    for (const list of [this.completed, this.failed]) {
      for (let i = list.length - 1; i >= 0; i--) if (matches(list[i])) return list[i];
    }
    return null;
  },
  /** The most recent finished (started, failed or cancelled) item for a URL. */
  findRecentByUrl(url) {
    const key = canonicalizeQueueUrl(url);
    const items = [...this.completed, ...this.failed, ...(this.cancelled || [])].filter(item => canonicalizeQueueUrl(item.url) === key);
    const at = item => new Date(item.sessionOutcome?.finishedAt || item.startedAt || item.createdAt).getTime() || 0;
    return items.sort((a, b) => at(b) - at(a))[0] || null;
  },
  /** Keep recently cancelled items so tasks waiting for them can tell (issue #4069). */
  rememberCancelled(item) {
    this.cancelled = this.cancelled || [];
    this.cancelled.push(item);
    while (this.cancelled.length > 100) this.cancelled.shift();
    this.reconcileDependencies();
  },
  /** The `/queue` section that lists tasks waiting for other tasks; empty when there are none. */
  formatWaitingForTasksSection({ locale = null } = {}) {
    const entries = this.dependencies.entries;
    if (entries.length === 0) return '';
    let section = `*${t('telegram.solve_after_queue_title', { count: entries.length }, { locale })}*\n`;
    for (const entry of entries.slice(0, QUEUE_CONFIG.MAX_DISPLAY_ITEMS_PER_QUEUE)) {
      const tasks = escapeMarkdown(entry.targets.map(target => target.label).join(', '));
      section += `  • ${formatQueueItemLink(entry.item.url)} (${entry.item.tool || 'claude'}) ⏳ ${tasks}\n`; // telegram-markdown-ok: formatQueueItemLink returns safe Markdown; labels are escaped
    }
    if (entries.length > QUEUE_CONFIG.MAX_DISPLAY_ITEMS_PER_QUEUE) section += `  …\n`;
    return `${section}\n`;
  },
  /**
   * A queued, running or waiting item for `url` that a new task for the same
   * link would duplicate. Items the new task waits for are not duplicates:
   * `/after` may run a link again once its current task is done.
   * @param {string} url
   * @param {object[]} [targets] - What the new task waits for
   * @returns {object|null}
   */
  findLaunchConflict(url, targets = []) {
    const awaited = new Set(targets.map(target => target.item).filter(Boolean));
    const key = canonicalizeQueueUrl(url);
    const candidates = [...Object.values(this.queues).flat(), ...this.processing.values(), ...this.dependencies.list()];
    return candidates.find(item => !awaited.has(item) && canonicalizeQueueUrl(item.url) === key) || null;
  },
};

/**
 * Add the dependency methods to a queue class.
 * @param {Function} QueueClass
 */
export function installSolveQueueDependencyMethods(QueueClass) {
  for (const [name, method] of Object.entries(solveQueueDependencyMethods)) {
    Object.defineProperty(QueueClass.prototype, name, { value: method, writable: true, configurable: true });
  }
}
