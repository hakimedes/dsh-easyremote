declare const process: { env: Record<string, string | undefined> };

const DEFAULT_HUB_HTTP_URL = 'https://dsh.infomind.cc';

function stripTrailingSlash(value: string) {
  return value.replace(/\/+$/, '');
}

export const HUB_HTTP_URL = stripTrailingSlash(process.env.EXPO_PUBLIC_HUB_URL || DEFAULT_HUB_HTTP_URL);
export const HUB_WSS_URL = HUB_HTTP_URL.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:');
export const APP_VERSION = '0.3.0';
export const APP_SCHEME = 'dshremote';
export const ALLOW_LOCAL_HUB = process.env.EXPO_PUBLIC_ALLOW_LOCAL_HUB === 'true';
export const APP_VARIANT = process.env.EXPO_PUBLIC_APP_VARIANT === 'internal' ? 'internal' : 'community';
export const IS_COMMUNITY_BUILD = APP_VARIANT === 'community';
export const FIXED_HUB_SERVER = IS_COMMUNITY_BUILD ? null : HUB_HTTP_URL;

export function realtimeUrl(server = HUB_WSS_URL) {
  return `${stripTrailingSlash(server).replace(/^http:/, 'ws:').replace(/^https:/, 'wss:')}/v1/realtime`;
}

export function apiUrl(path: string, server = HUB_HTTP_URL) {
  return `${stripTrailingSlash(server)}${path.startsWith('/') ? path : `/${path}`}`;
}
