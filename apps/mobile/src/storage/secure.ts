import * as SecureStore from 'expo-secure-store';
import { HUB_HTTP_URL } from '../config';

const LEGACY_REFRESH_TOKEN_KEY = 'dsh.remote.refresh-token';
const HUB_BINDING_KEY = 'dsh.easyremote.hub-binding.v1';

export type HubBinding = {
  schemaVersion: 1;
  server: string;
  hubId?: string;
  refreshToken: string;
};

function parseHubBinding(raw: string | null): HubBinding | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<HubBinding>;
    if (value.schemaVersion !== 1 || typeof value.server !== 'string' || typeof value.refreshToken !== 'string') {
      return null;
    }
    const server = new URL(value.server);
    if (server.protocol !== 'https:' && server.protocol !== 'http:') return null;
    return {
      schemaVersion: 1,
      server: server.origin,
      refreshToken: value.refreshToken,
      ...(typeof value.hubId === 'string' && value.hubId ? { hubId: value.hubId } : {}),
    };
  } catch {
    return null;
  }
}

export async function readHubBinding(): Promise<HubBinding | null> {
  const binding = parseHubBinding(await SecureStore.getItemAsync(HUB_BINDING_KEY));
  if (binding) return binding;

  const legacyRefreshToken = await SecureStore.getItemAsync(LEGACY_REFRESH_TOKEN_KEY);
  if (!legacyRefreshToken) return null;
  const migrated: HubBinding = {
    schemaVersion: 1,
    server: HUB_HTTP_URL,
    refreshToken: legacyRefreshToken,
  };
  await writeHubBinding(migrated);
  await SecureStore.deleteItemAsync(LEGACY_REFRESH_TOKEN_KEY);
  return migrated;
}

export async function writeHubBinding(binding: HubBinding) {
  await SecureStore.setItemAsync(HUB_BINDING_KEY, JSON.stringify(binding), {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

export async function clearHubBinding() {
  await Promise.all([
    SecureStore.deleteItemAsync(HUB_BINDING_KEY),
    SecureStore.deleteItemAsync(LEGACY_REFRESH_TOKEN_KEY),
  ]);
}
