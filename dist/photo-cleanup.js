import {
  photoCleanupQueue,
  acknowledgePhotoCleanup,
  getModel,
  storedSession,
} from "./local-store.js";

// Called under syncOwner's lease. Never remove bytes still referenced by a row.
export async function cleanRemovedPhotos(client, owner) {
  for (const { id, paths } of await photoCleanupQueue(owner)) {
    if ((await storedSession())?.user?.id !== owner) return;
    const local = await getModel(owner, id);
    if (local?.dirty) continue;
    const result = await client
      .from("models")
      .select("images")
      .eq("user_id", owner)
      .eq("id", id)
      .maybeSingle();
    if (result.error) throw result.error;
    if (result.data && !Array.isArray(result.data.images))
      throw Error("Photo references unavailable");
    const referenced = new Set(
      [...(local?.images || []), ...(result.data?.images || [])].map(
        (i) => i.path,
      ),
    );
    const removable = paths.filter(
      (path) => path.startsWith(owner + "/") && !referenced.has(path),
    );
    if (!removable.length) continue;
    if ((await storedSession())?.user?.id !== owner) return;
    // A new local edit may have appeared while checking the remote row.
    const latest = await getModel(owner, id);
    if (latest?.dirty) continue;
    const safe = removable.filter(
      (path) => !latest?.images?.some((i) => i.path === path),
    );
    for (let offset = 0; offset < safe.length; offset += 100) {
      if ((await storedSession())?.user?.id !== owner) return;
      const batch = safe.slice(offset, offset + 100);
      const removed = await client.storage.from("model-images").remove(batch);
      if (removed.error) throw removed.error;
      await acknowledgePhotoCleanup(owner, id, batch);
    }
  }
}
