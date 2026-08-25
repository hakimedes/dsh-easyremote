type CacheEntry<T> = {
  promise: Promise<T>;
  settled: boolean;
};

export class CommandReplayCache<T> {
  private readonly entries = new Map<string, CacheEntry<T>>();

  constructor(private readonly maxEntries = 500) {}

  execute(commandId: string, operation: () => Promise<T>): Promise<T> {
    const existing = this.entries.get(commandId);
    if (existing) return existing.promise;

    const entry: CacheEntry<T> = {
      settled: false,
      promise: Promise.resolve().then(operation),
    };
    this.entries.set(commandId, entry);
    void entry.promise.finally(() => {
      entry.settled = true;
      this.trim();
    }).catch(() => {
      // The original promise remains the sole observable rejection.
    });
    this.trim();
    return entry.promise;
  }

  private trim() {
    if (this.entries.size <= this.maxEntries) return;
    for (const [key, entry] of this.entries) {
      if (!entry.settled) continue;
      this.entries.delete(key);
      if (this.entries.size <= this.maxEntries) break;
    }
  }
}
