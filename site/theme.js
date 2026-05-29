// Theme handling for the download page: an explicit System / Light / Dark
// switch backed by localStorage, plus a live subscription to the OS theme so
// "System" reflects changes without a reload.

export const THEME_STORAGE_KEY = 'hive-mind:theme';
export const themeModes = ['system', 'light', 'dark'];

export function systemTheme() {
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches) {
    return 'dark';
  }

  return 'light';
}

export function readThemeMode() {
  if (typeof window === 'undefined' || !window.localStorage) {
    return 'system';
  }

  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);

    return themeModes.includes(stored) ? stored : 'system';
  } catch {
    return 'system';
  }
}

export function writeThemeMode(mode) {
  if (typeof window === 'undefined' || !window.localStorage) {
    return;
  }

  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, mode);
  } catch {
    // Storage may be unavailable (private mode); the in-memory state still works.
  }
}

export function resolveTheme(mode) {
  return mode === 'system' ? systemTheme() : mode;
}
