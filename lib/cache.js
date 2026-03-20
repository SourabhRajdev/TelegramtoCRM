/**
 * Simple in-memory cache with TTL
 */
class Cache {
  constructor(ttlMs = 60000) {
    this.store = new Map();
    this.ttl = ttlMs;
  }

  get(key) {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expires) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  set(key, value, ttlSeconds = null) {
    const ttl = ttlSeconds ? ttlSeconds * 1000 : this.ttl;
    this.store.set(key, {
      value,
      expires: Date.now() + ttl,
    });
  }

  delete(key) {
    return this.store.delete(key);
  }

  clear() {
    this.store.clear();
  }

  size() {
    return this.store.size;
  }
}

module.exports = Cache;
