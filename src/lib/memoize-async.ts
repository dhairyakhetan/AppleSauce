/**
 * One call per key. While a call for a key is running, or once it succeeded, a
 * second call with the same key gets the same promise instead of asking the
 * server again. A call that fails (or returns a value `keep` rejects, such as a
 * null link) is forgotten, so a retry really retries.
 *
 * Used where many components on one screen ask for the same thing, for example
 * every question of one paper wanting that paper's page pictures.
 */
export function memoizeAsync<K extends string, V>(fn: (key: K) => Promise<V>, keep: (value: V) => boolean = () => true): (key: K) => Promise<V> {
  const cache = new Map<K, Promise<V>>();
  return (key: K) => {
    const hit = cache.get(key);
    if (hit) return hit;
    const p = fn(key).then(
      (v) => {
        if (!keep(v)) cache.delete(key);
        return v;
      },
      (e) => {
        cache.delete(key);
        throw e;
      },
    );
    cache.set(key, p);
    return p;
  };
}
