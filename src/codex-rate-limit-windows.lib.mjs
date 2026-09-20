/**
 * Classify raw Codex windows by duration instead of response position.
 *
 * Historically the primary window was five hours and the secondary window was
 * weekly. Weekly-only accounts can put the weekly value in the primary slot.
 */
export function classifyCodexRateLimitWindows(rateLimit) {
  const primary = rateLimit?.primary_window;
  const secondary = rateLimit?.secondary_window;
  const windows = [primary, secondary].filter(Boolean);
  const hasDurationMetadata = windows.some(window => Number.isFinite(Number(window?.limit_window_seconds)));

  if (!hasDurationMetadata) {
    return { sessionWindow: primary, weeklyWindow: secondary };
  }

  const sessionWindow = windows.find(window => {
    const seconds = Number(window?.limit_window_seconds);
    return Number.isFinite(seconds) && seconds > 0 && seconds < 24 * 60 * 60;
  });
  const weeklyWindow = windows.find(window => {
    const seconds = Number(window?.limit_window_seconds);
    return Number.isFinite(seconds) && seconds >= 24 * 60 * 60;
  });

  return { sessionWindow, weeklyWindow };
}
