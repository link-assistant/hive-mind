/* eslint-disable no-await-in-loop -- launch attempts are retried one after another with a delay */
/**
 * Bot launcher with exponential backoff retry for Telegraf polling mode.
 *
 * Handles transient errors (409 Conflict, network errors, 5xx) by retrying
 * with exponential backoff. Non-retryable errors (401 Unauthorized) cause
 * immediate exit.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1240
 * @see https://core.telegram.org/bots/api#getupdates
 */

/**
 * Default configuration for the retry mechanism.
 */
export const LAUNCHER_DEFAULTS = {
  baseDelayMs: 1000, // Initial retry delay: 1 second
  maxDelayMs: 10 * 60 * 1000, // Maximum retry delay: 10 minutes
  backoffMultiplier: 2, // Exponential growth factor
  jitterFraction: 0.1, // 10% random jitter to prevent thundering herd
};

/**
 * Error codes that should NOT be retried (fatal errors).
 * 401 = Invalid bot token -- retrying won't help.
 */
const NON_RETRYABLE_CODES = new Set([401]);

/**
 * Determines whether a given error is retryable.
 *
 * Retryable: 409 (Conflict), 429 (Rate limit), 5xx (Server errors),
 *            network/fetch errors (no code or ECONNRESET, ETIMEDOUT, etc.)
 * Non-retryable: 401 (Unauthorized/invalid token)
 *
 * @param {Error} error - The error to classify
 * @returns {boolean} true if the error is retryable
 */
export function isRetryableError(error) {
  if (NON_RETRYABLE_CODES.has(error.code)) {
    return false;
  }
  return true;
}

/**
 * Calculates the delay before the next retry attempt using exponential backoff
 * with jitter.
 *
 * Formula: min(baseDelay * multiplier^(attempt-1), maxDelay) + random jitter
 *
 * @param {number} attempt - Current attempt number (1-based)
 * @param {object} [options] - Configuration options
 * @param {number} [options.baseDelayMs] - Base delay in milliseconds
 * @param {number} [options.maxDelayMs] - Maximum delay cap in milliseconds
 * @param {number} [options.backoffMultiplier] - Exponential growth factor
 * @param {number} [options.jitterFraction] - Fraction of delay to use as jitter (0-1)
 * @returns {number} Delay in milliseconds before next retry
 */
export function calculateRetryDelay(attempt, options = {}) {
  const { baseDelayMs = LAUNCHER_DEFAULTS.baseDelayMs, maxDelayMs = LAUNCHER_DEFAULTS.maxDelayMs, backoffMultiplier = LAUNCHER_DEFAULTS.backoffMultiplier, jitterFraction = LAUNCHER_DEFAULTS.jitterFraction } = options;

  const exponentialDelay = baseDelayMs * Math.pow(backoffMultiplier, attempt - 1);
  const cappedDelay = Math.min(exponentialDelay, maxDelayMs);
  const jitter = cappedDelay * jitterFraction * Math.random();
  return Math.round(cappedDelay + jitter);
}

/**
 * Formats a delay in milliseconds as a human-readable string.
 *
 * @param {number} delayMs - Delay in milliseconds
 * @returns {string} Human-readable delay (e.g., "5s", "2m 30s", "10m")
 */
export function formatDelay(delayMs) {
  const totalSeconds = Math.round(delayMs / 1000);
  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (seconds === 0) {
    return `${minutes}m`;
  }
  return `${minutes}m ${seconds}s`;
}

/**
 * Launches a Telegraf bot with retry logic and exponential backoff.
 *
 * On each attempt:
 * 1. Deletes any existing webhook (to prevent webhook/polling conflict)
 * 2. Calls bot.launch() in polling mode
 *
 * If bot.launch() fails:
 * - For retryable errors (409, network, 5xx): waits with exponential backoff
 *   and retries
 * - For non-retryable errors (401): exits immediately
 *
 * @param {object} bot - Telegraf bot instance
 * @param {object} launchOptions - Options passed to bot.launch()
 * @param {object} [retryOptions] - Retry configuration
 * @param {number} [retryOptions.baseDelayMs] - Initial retry delay (default: 1000)
 * @param {number} [retryOptions.maxDelayMs] - Maximum retry delay (default: 600000)
 * @param {number} [retryOptions.backoffMultiplier] - Growth factor (default: 2)
 * @param {number} [retryOptions.jitterFraction] - Jitter fraction (default: 0.1)
 * @param {boolean} [retryOptions.verbose] - Enable verbose logging
 * @param {Function} [retryOptions.onRetry] - Callback on each retry: (attempt, error, delayMs) => void
 * @param {Function} [retryOptions.onLaunch] - Callback when Telegraf reports that launch has started
 * @param {AbortSignal} [retryOptions.signal] - AbortSignal to cancel retry loop
 * @returns {Promise<void>} Resolves when bot is successfully launched
 * @throws {Error} If a non-retryable error occurs or signal is aborted
 */
export async function launchBotWithRetry(bot, launchOptions, retryOptions = {}) {
  const { verbose = false, onRetry, onLaunch, signal, ...backoffConfig } = retryOptions;
  let attempt = 0;
  let launchNotified = false;

  const notifyLaunched = () => {
    if (launchNotified || typeof onLaunch !== 'function') return;
    launchNotified = true;
    try {
      const result = onLaunch();
      if (result && typeof result.catch === 'function') {
        result.catch(error => console.error(`[telegram-bot-launcher] onLaunch callback failed: ${error.message}`));
      }
    } catch (error) {
      console.error(`[telegram-bot-launcher] onLaunch callback failed: ${error.message}`);
    }
  };

  while (true) {
    // Check if abort was requested (e.g., during shutdown)
    if (signal?.aborted) {
      const abortError = new Error('Bot launch aborted');
      abortError.code = 'ABORT';
      throw abortError;
    }

    attempt++;

    try {
      // Step 1: Delete webhook to prevent webhook/polling conflict
      if (verbose) console.log(`[VERBOSE] Launch attempt ${attempt}: deleting webhook...`);
      await bot.telegram.deleteWebhook({ drop_pending_updates: true });

      if (verbose) console.log(`[VERBOSE] Launch attempt ${attempt}: starting polling...`);

      // Step 2: Launch bot in polling mode. In Telegraf long-polling mode the
      // launch promise may stay pending while polling is active, so use the
      // launch callback for startup side effects such as session monitoring.
      await bot.launch(launchOptions, notifyLaunched);

      // Success -- bot is running
      notifyLaunched();
      if (attempt > 1) {
        console.log(`✅ Bot launched successfully after ${attempt} attempts`);
      }
      return;
    } catch (error) {
      // Check if the error is retryable
      if (!isRetryableError(error)) {
        console.error(`❌ Non-retryable error (${error.code}): ${error.message}`);
        throw error;
      }

      // Calculate delay with exponential backoff
      const delayMs = calculateRetryDelay(attempt, backoffConfig);

      console.warn(`⚠️  Bot launch attempt ${attempt} failed` + ` (${error.code || 'unknown'}): ${error.message}.` + ` Retrying in ${formatDelay(delayMs)}...`);

      if (verbose) {
        console.warn(`[VERBOSE] Retry delay: ${delayMs}ms, next attempt: ${attempt + 1}`);
        if (error.response) {
          console.warn('[VERBOSE] API response:', JSON.stringify(error.response));
        }
      }

      // Notify retry callback if provided
      if (onRetry) {
        onRetry(attempt, error, delayMs);
      }

      // Wait before retrying (interruptible via AbortSignal)
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, delayMs);

        if (signal) {
          const onAbort = () => {
            clearTimeout(timer);
            reject(new Error('Bot launch aborted during retry wait'));
          };
          if (signal.aborted) {
            clearTimeout(timer);
            reject(new Error('Bot launch aborted during retry wait'));
            return;
          }
          // `{ once: true }` removes the abort listener after it fires; on the
          // natural-timeout path it is released when the AbortSignal is collected.
          signal.addEventListener('abort', onAbort, { once: true });
        }
      });
    }
  }
}

/** Log Telegram identity and delivery settings after polling starts. */
export async function logPollingStartupDiagnostics(bot) {
  console.log('[VERBOSE] Bot launched successfully');
  console.log('[VERBOSE] Polling is active, waiting for messages...');

  // Get bot info and webhook status for diagnostics
  try {
    const botInfo = await bot.telegram.getMe();
    const webhookInfo = await bot.telegram.getWebhookInfo();
    console.log('[VERBOSE] Bot info:');
    console.log('[VERBOSE]   Username: @' + botInfo.username);
    console.log('[VERBOSE]   Bot ID:', botInfo.id);
    console.log('[VERBOSE] Webhook info:');
    console.log('[VERBOSE]   URL:', webhookInfo.url || 'none (polling mode)');
    console.log('[VERBOSE]   Pending updates:', webhookInfo.pending_update_count);
    if (webhookInfo.last_error_date) {
      console.log('[VERBOSE]   Last error:', new Date(webhookInfo.last_error_date * 1000).toISOString());
      console.log('[VERBOSE]   Error message:', webhookInfo.last_error_message);
    }

    console.log('[VERBOSE]');
    console.log('[VERBOSE] ⚠️  IMPORTANT: If bot is not receiving messages in group chats:');
    console.log('[VERBOSE]   1. Privacy Mode: Check if bot has privacy mode enabled in @BotFather');
    console.log('[VERBOSE]      - Send /setprivacy to @BotFather');
    console.log('[VERBOSE]      - Select @' + botInfo.username);
    console.log('[VERBOSE]      - Choose "Disable" to receive all group messages');
    console.log('[VERBOSE]      - IMPORTANT: Remove bot from group and re-add after changing!');
    console.log('[VERBOSE]   2. Admin Status: Make bot an admin in the group (admins see all messages)');
    console.log('[VERBOSE]   3. Run diagnostic: node experiments/test-telegram-bot-privacy-mode.mjs');
    console.log('[VERBOSE]');
  } catch (err) {
    console.log('[VERBOSE] Could not fetch bot info:', err.message);
  }
  console.log('[VERBOSE] Send a message to the bot to test message reception');
}
