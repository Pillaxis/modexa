import {
  getMeta,
  setMeta,
  storedSession,
  listModels,
  photoCleanupQueue,
} from "./local-store.js";
import { syncOwner } from "./sync.js";

export const retryDelay = (attempt) =>
  Math.min(300000, 5000 * 2 ** Math.min(6, Math.max(0, attempt - 1)));

// Durable diagnostics and retry scheduling, shared by page and service worker.
// No progress UI or toast is emitted by this module.
export async function runBackgroundSync(
  client,
  owner,
  notify = () => {},
  pull = false,
) {
  const sameOwner = async () => (await storedSession())?.user?.id === owner;
  if (!(await sameOwner())) return false;
  const key = `sync-health:${owner}`,
    previous = await getMeta(key);
  try {
    const ran = await syncOwner(client, owner, notify, pull);
    if (!ran) return false;
    if (!(await sameOwner())) return false;
    const pending = (await listModels(owner)).filter((row) => row.dirty);
    const deleted = (await getMeta(`deleted:${owner}`)) || [];
    const photos = await photoCleanupQueue(owner);
    await setMeta(key, {
      lastAttempt: Date.now(),
      lastSuccess: Date.now(),
      attempts: 0,
      nextRetry: 0,
      pending: pending.length + deleted.length + photos.length,
      blocked: pending.filter((row) =>
        ["conflict", "quota"].includes(row.sync_status),
      ).length,
      errorCode: null,
    });
    return true;
  } catch (error) {
    if (await sameOwner()) {
      const attempts = (previous?.attempts || 0) + 1;
      await setMeta(key, {
        ...previous,
        lastAttempt: Date.now(),
        attempts,
        nextRetry: Date.now() + retryDelay(attempts),
        // Store a code only: no tokens, provider responses or personal data.
        errorCode: String(
          error?.code || error?.status || error?.name || "NETWORK",
        ).slice(0, 60),
      });
    }
    throw error;
  }
}
