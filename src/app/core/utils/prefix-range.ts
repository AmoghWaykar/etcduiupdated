/**
 * Computes exclusive range_end for etcd prefix range queries.
 * Returns all keys in [prefix, prefixEnd) where prefixEnd is the smallest key strictly after the prefix namespace.
 * @see https://etcd.io/docs/v3.5/learning/api/
 */
export function prefixExclusiveEnd(prefix: string): string {
  const bytes = new TextEncoder().encode(prefix);
  const end = new Uint8Array(bytes.length);
  end.set(bytes);
  for (let i = end.length - 1; i >= 0; i--) {
    if (end[i] < 0xff) {
      end[i]++;
      return new TextDecoder().decode(end.subarray(0, i + 1));
    }
  }
  // Entire prefix is 0xff bytes — fall back to appending a byte (extremely rare for app names).
  const extended = new Uint8Array(bytes.length + 1);
  extended.set(bytes);
  extended[bytes.length] = 0;
  return new TextDecoder().decode(extended);
}
