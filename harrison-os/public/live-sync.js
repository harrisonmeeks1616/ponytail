// One cheap foreground change check; content is fetched only when the current view is stale.
// The cursor advances only after a guarded render. A typing/navigation race must retry.
export function createLivePull({ readVersion, viewKey, blocked, epoch, refresh, pending = () => {} }) {
  const applied = new Map();
  let running = null;
  async function check() {
    const key = viewKey();
    const version = await readVersion();
    if (!version || key !== viewKey()) return false;
    if (applied.get(key) === version) { pending(false); return true; }
    pending(true);
    if (blocked()) return false;
    const generation = epoch();
    const guard = () => key === viewKey() && generation === epoch() && !blocked();
    const rendered = await refresh(guard);
    if (rendered === false || !guard()) return false;
    applied.set(key, version);
    pending(false);
    return true;
  }
  return {
    poll() {
      if (running) return running;
      running = check().catch(() => false).finally(() => { running = null; });
      return running;
    },
  };
}
