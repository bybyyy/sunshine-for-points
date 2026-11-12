// localStorage wrapper. Storage can be blocked (private mode, strict
// settings), so every call is wrapped and the app simply forgets instead of
// breaking.

const KEY = "sunshine-for-points:v1";
const CACHE_PREFIX = "sunshine-for-points:cache:";

export function loadSaved() {
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function save(snapshot) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(snapshot));
  } catch {
    // Nothing to do: the settings just won't be remembered.
  }
}

/** Returns a cached API response if it is younger than maxAgeMs, otherwise null. */
export function readCache(name, maxAgeMs) {
  try {
    const entry = JSON.parse(window.localStorage.getItem(CACHE_PREFIX + name));
    if (entry && Date.now() - entry.savedAt < maxAgeMs) {
      return entry.value;
    }
  } catch {
    // Missing or unreadable cache: fetch fresh data instead.
  }
  return null;
}

export function writeCache(name, value) {
  try {
    window.localStorage.setItem(CACHE_PREFIX + name, JSON.stringify({ savedAt: Date.now(), value }));
  } catch {
    // Storage full or blocked: the next visit fetches again.
  }
}
