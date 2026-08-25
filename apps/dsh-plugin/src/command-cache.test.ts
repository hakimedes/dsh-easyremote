import { describe, expect, it, vi } from 'vitest';

import { CommandReplayCache } from './command-cache.js';

describe('CommandReplayCache', () => {
  it('executes a duplicated command once and replays the same result', async () => {
    const cache = new CommandReplayCache<number>(100);
    const execute = vi.fn(async () => 42);

    const [first, retry] = await Promise.all([
      cache.execute('command-1', execute),
      cache.execute('command-1', execute),
    ]);

    expect(first).toBe(42);
    expect(retry).toBe(42);
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
