import { existsSync, readFileSync, unwatchFile, watchFile } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export type ConnectorConfigFile = {
  schemaVersion: 1;
  hubUrl: string;
  publicOrigin?: string;
  nodeName?: string;
  defaultCwd?: string;
};

export type ResolvedConnectorConfig = ConnectorConfigFile & {
  nodeName: string;
  source: 'file' | 'environment';
};

type LoadOptions = {
  path?: string;
  environment?: Record<string, string | undefined>;
  fallbackNodeName?: string;
};

export function connectorConfigPath(environment: Record<string, string | undefined> = process.env) {
  return environment.DSH_EASYREMOTE_CONFIG_PATH || join(homedir(), '.dsh-easyremote', 'connector.json');
}

export function asHttpUrl(value: string) {
  const parsed = new URL(value.trim());
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Hub URL must use http:// or https://');
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('Hub URL must be an origin without credentials, query, or fragment');
  }
  return parsed.origin;
}

function optionalString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function loadConnectorConfig(options: LoadOptions = {}): ResolvedConnectorConfig {
  const environment = options.environment ?? process.env;
  const path = options.path ?? connectorConfigPath(environment);
  const fallbackNodeName = options.fallbackNodeName || 'DSH Node';

  if (existsSync(path)) {
    let value: unknown;
    try {
      value = JSON.parse(readFileSync(path, 'utf8'));
    } catch (error) {
      throw new Error(`Connector config is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('Connector config must be a JSON object');
    }
    const config = value as Record<string, unknown>;
    if (config.schemaVersion !== 1 || typeof config.hubUrl !== 'string') {
      throw new Error('Connector config requires schemaVersion 1 and hubUrl');
    }
    return {
      schemaVersion: 1,
      hubUrl: asHttpUrl(config.hubUrl),
      ...(typeof config.publicOrigin === 'string' ? { publicOrigin: asHttpUrl(config.publicOrigin) } : {}),
      nodeName: optionalString(config.nodeName) || fallbackNodeName,
      ...(optionalString(config.defaultCwd) ? { defaultCwd: optionalString(config.defaultCwd) } : {}),
      source: 'file',
    };
  }

  return {
    schemaVersion: 1,
    hubUrl: asHttpUrl(environment.DSH_REMOTE_HUB_URL || 'https://dsh.infomind.cc'),
    nodeName: optionalString(environment.DSH_REMOTE_NODE_NAME) || fallbackNodeName,
    ...(optionalString(environment.DSH_REMOTE_DEFAULT_CWD)
      ? { defaultCwd: optionalString(environment.DSH_REMOTE_DEFAULT_CWD) }
      : {}),
    source: 'environment',
  };
}

export function watchConnectorConfig(
  path: string,
  onChange: () => void,
  onError: (error: unknown) => void,
  interval = 1_000,
) {
  let previous = existsSync(path) ? readFileSync(path, 'utf8') : null;
  const listener = () => {
    try {
      const next = existsSync(path) ? readFileSync(path, 'utf8') : null;
      if (next === previous) return;
      previous = next;
      onChange();
    } catch (error) {
      onError(error);
    }
  };
  watchFile(path, { interval, persistent: false }, listener);
  return () => unwatchFile(path, listener);
}
