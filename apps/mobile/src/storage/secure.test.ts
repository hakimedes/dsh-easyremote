import { beforeEach, describe, expect, it, vi } from 'vitest';

const secureStore = vi.hoisted(() => ({
  values: new Map<string, string>(),
  getItemAsync: vi.fn(async (key: string) => secureStore.values.get(key) ?? null),
  setItemAsync: vi.fn(async (key: string, value: string) => { secureStore.values.set(key, value); }),
  deleteItemAsync: vi.fn(async (key: string) => { secureStore.values.delete(key); }),
}));

vi.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
  getItemAsync: secureStore.getItemAsync,
  setItemAsync: secureStore.setItemAsync,
  deleteItemAsync: secureStore.deleteItemAsync,
}));

import { clearHubBinding, readHubBinding, writeHubBinding } from './secure';

describe('secure Hub binding', () => {
  beforeEach(() => {
    secureStore.values.clear();
    vi.clearAllMocks();
  });

  it('stores the server, Hub identity, and refresh credential as one protected record', async () => {
    const binding = {
      schemaVersion: 1 as const,
      server: 'https://my-hub.example',
      hubId: '9afef32a-0c8b-4a7b-91ab-40d866e2cb45',
      refreshToken: 'refresh-token',
    };

    await writeHubBinding(binding);
    await expect(readHubBinding()).resolves.toEqual(binding);
    expect(secureStore.setItemAsync).toHaveBeenCalledWith(
      expect.any(String),
      JSON.stringify(binding),
      { keychainAccessible: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY' },
    );

    await clearHubBinding();
    await expect(readHubBinding()).resolves.toBeNull();
  });

  it('migrates the legacy refresh token to the internal Hub without losing login', async () => {
    secureStore.values.set('dsh.remote.refresh-token', 'legacy-refresh');

    await expect(readHubBinding()).resolves.toEqual({
      schemaVersion: 1,
      server: 'https://dsh.infomind.cc',
      refreshToken: 'legacy-refresh',
    });
    expect(secureStore.values.has('dsh.remote.refresh-token')).toBe(false);
  });
});
