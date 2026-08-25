import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadConnectorConfig, watchConnectorConfig } from './connector-config.js';

const disposers: Array<() => void> = [];

afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
});

describe('Connector config', () => {
  it('prefers the EasyRemote config file and normalizes optional values', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'dsh-connector-config-')), 'connector.json');
    writeFileSync(path, JSON.stringify({
      schemaVersion: 1,
      hubUrl: 'https://temporary.trycloudflare.com/',
      nodeName: '  Studio Mac  ',
      defaultCwd: '/workspace/project',
    }));

    expect(loadConnectorConfig({
      path,
      environment: {
        DSH_REMOTE_HUB_URL: 'https://fallback.example',
        DSH_REMOTE_NODE_NAME: 'Fallback Node',
      },
      fallbackNodeName: 'Host Name',
    })).toEqual({
      schemaVersion: 1,
      hubUrl: 'https://temporary.trycloudflare.com',
      nodeName: 'Studio Mac',
      defaultCwd: '/workspace/project',
      source: 'file',
    });
  });

  it('uses environment variables as a compatibility fallback', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'dsh-connector-config-')), 'missing.json');
    expect(loadConnectorConfig({
      path,
      environment: {
        DSH_REMOTE_HUB_URL: 'https://fallback.example/',
        DSH_REMOTE_DEFAULT_CWD: '/legacy/cwd',
      },
      fallbackNodeName: 'Host Name',
    })).toMatchObject({
      hubUrl: 'https://fallback.example',
      nodeName: 'Host Name',
      defaultCwd: '/legacy/cwd',
      source: 'environment',
    });
  });

  it('notifies the running Connector when the Hub URL changes', async () => {
    const path = join(mkdtempSync(join(tmpdir(), 'dsh-connector-watch-')), 'connector.json');
    writeFileSync(path, JSON.stringify({ schemaVersion: 1, hubUrl: 'https://one.example' }));
    const onChange = vi.fn();
    const dispose = watchConnectorConfig(path, onChange, vi.fn(), 20);
    disposers.push(dispose);

    await new Promise((resolve) => setTimeout(resolve, 30));
    writeFileSync(path, JSON.stringify({ schemaVersion: 1, hubUrl: 'https://two.example' }));
    await vi.waitFor(() => expect(onChange).toHaveBeenCalled(), { timeout: 1_000 });
  });
});
