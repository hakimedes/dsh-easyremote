import { describe, expect, it, vi } from 'vitest';

import {
  WizardActionGate,
  authorizeWizardRequest,
  createWizardSecrets,
  renderWizardHtml,
  startWizardServer,
  wizardListenOptions,
} from './wizard.js';

describe('localhost setup wizard', () => {
  it('binds only to IPv4 loopback with an ephemeral port', () => {
    expect(wizardListenOptions()).toEqual({ host: '127.0.0.1', port: 0 });
  });

  it('requires its HttpOnly session and CSRF token for mutations', () => {
    const secrets = createWizardSecrets();
    const common = {
      host: '127.0.0.1:43123',
      expectedHost: '127.0.0.1:43123',
      sessionToken: secrets.sessionToken,
      csrfToken: secrets.csrfToken,
    };
    expect(authorizeWizardRequest({
      ...common,
      method: 'POST',
      cookie: `dsh_easyremote_session=${secrets.sessionToken}`,
      csrf: secrets.csrfToken,
      origin: 'http://127.0.0.1:43123',
    })).toEqual({ ok: true });
    expect(authorizeWizardRequest({ ...common, method: 'POST' })).toMatchObject({ ok: false, status: 401 });
    expect(authorizeWizardRequest({
      ...common,
      method: 'POST',
      cookie: `dsh_easyremote_session=${secrets.sessionToken}`,
      csrf: secrets.csrfToken,
      origin: 'https://attacker.example',
    })).toMatchObject({ ok: false, status: 403 });
  });

  it('renders both setup paths without embedding the session token', () => {
    const html = renderWizardHtml({
      csrfToken: 'csrf-only',
      version: '0.2.0',
      apkUrl: 'https://github.com/hakimedes/dsh-easyremote/releases/latest/download/community.apk',
      apkQrSvg: '<svg id="apk-qr"></svg>',
    });
    expect(html).toContain('快速启动');
    expect(html).toContain('深度配置');
    expect(html).toContain('探索未至之境');
    expect(html).toContain('csrf-only');
    expect(html).toContain('Community APK');
    expect(html).toContain('安装完成后返回本页继续配置连接');
    expect(html).toContain('apk-qr');
    expect(html).toContain('连接手机');
    expect(html).not.toContain('ADB 一键安装');
    expect(html).not.toContain('install-adb');
    expect(html.indexOf('data-stage="apk"')).toBeLessThan(html.indexOf('data-stage="pairing"'));
    expect(html).not.toContain('dsh_easyremote_session');
  });

  it('keeps both setup paths available after configuration so a failed Connector install can be retried', () => {
    const html = renderWizardHtml({ csrfToken: 'csrf', version: '0.2.0', controlMode: true });
    expect(html).toContain('本机控制台');
    expect(html).toContain('data-action="quick"');
    expect(html).toContain('data-action="deep"');
    expect(html).toContain('data-action="provision"');
  });

  it('rejects replayed or concurrent action request IDs', async () => {
    const gate = new WizardActionGate();
    let release!: () => void;
    const task = vi.fn(() => new Promise<void>((resolve) => { release = resolve; }));
    const first = gate.run('request-1', task);
    await expect(gate.run('request-1', task)).rejects.toThrow(/already used/i);
    release();
    await first;
    await expect(gate.run('request-1', task)).rejects.toThrow(/already used/i);
  });

  it('exchanges the launch token for a cookie before serving local state', async () => {
    const server = await startWizardServer({
      version: '0.2.0',
      getState: async () => ({ message: 'ready' }),
      getPairing: async () => ({
        schemaVersion: 1,
        status: 'pairing',
        hub: 'https://dsh.example.com',
        nodeName: 'Studio Mac',
        nodeId: null,
        qrPayload: `dshremote://pair?server=${encodeURIComponent('https://dsh.example.com')}&token=${'a'.repeat(64)}`,
        pairingExpiresAt: Date.now() + 60_000,
        updatedAt: Date.now(),
      }),
      actions: {},
    });
    try {
      const exchange = await fetch(server.launchUrl, { redirect: 'manual' });
      expect(exchange.status).toBe(303);
      const cookie = exchange.headers.get('set-cookie');
      expect(cookie).toContain('HttpOnly');
      const replay = await fetch(server.launchUrl, { redirect: 'manual' });
      expect(replay.status).toBe(401);
      const response = await fetch(`${server.origin}/api/state`, { headers: { cookie: cookie!.split(';')[0] } });
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ message: 'ready' });
      const pairingResponse = await fetch(`${server.origin}/api/pairing`, { headers: { cookie: cookie!.split(';')[0] } });
      expect(pairingResponse.status).toBe(200);
      const pairing = await pairingResponse.json() as Record<string, unknown>;
      expect(pairing).toMatchObject({ status: 'pairing', nodeName: 'Studio Mac', ready: true });
      expect(pairing.qrSvg).toContain('<svg');
      expect(pairing).not.toHaveProperty('qrPayload');
    } finally {
      await server.close();
    }
  });

  it('answers the browser favicon request without a console-visible 404', async () => {
    const server = await startWizardServer({
      version: '0.2.0',
      getState: async () => ({ message: 'ready' }),
      actions: {},
    });
    try {
      const exchange = await fetch(server.launchUrl, { redirect: 'manual' });
      const cookie = exchange.headers.get('set-cookie')!.split(';')[0];
      const response = await fetch(`${server.origin}/favicon.ico`, {
        headers: { cookie },
      });

      expect(response.status).toBe(204);
      expect(await response.text()).toBe('');
    } finally {
      await server.close();
    }
  });
});
