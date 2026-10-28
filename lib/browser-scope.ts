/** Browser-only namespace; never keep participant identity in server module state. */
function prefix(): string {
  if (typeof document === "undefined" || document.documentElement.dataset.pilotMode !== "true") return "";
  const id = document.documentElement.dataset.pilotParticipant ?? "";
  if (!/^[a-f0-9-]{36}$/u.test(id)) throw new Error("Tester browser storage identity is unavailable.");
  return `rf-pilot:${id}:`;
}

export function scopedDatabaseName(name: string): string { return prefix() + name; }

export function scopedLocalStorage(): Storage {
  const store = window.localStorage;
  const scope = prefix();
  if (!scope) return store;
  const keys = () => Array.from({ length: store.length }, (_, index) => store.key(index)).filter((key): key is string => key !== null && key.startsWith(scope));
  return {
    get length() { return keys().length; },
    getItem: (key) => store.getItem(scope + key),
    setItem: (key, value) => store.setItem(scope + key, value),
    removeItem: (key) => store.removeItem(scope + key),
    key: (index) => keys()[index]?.slice(scope.length) ?? null,
    clear: () => keys().forEach((key) => store.removeItem(key)),
  };
}
