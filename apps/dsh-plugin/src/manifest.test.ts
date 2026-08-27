import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function loadBrowserPlugin(client: string) {
  let handoff: { factory: (require: (specifier: string) => unknown) => {
    inject: string[];
    apply: (ctx: { get: (name: string) => unknown }) => void;
  } } | undefined;
  const browser = {
    __ModuleLoader__: {
      load(value: typeof handoff) { handoff = value; },
    },
  };
  new Function('window', `"use strict";\n${client}`)(browser);
  if (!handoff) throw new Error('browser plugin did not register with the module loader');
  return handoff.factory((specifier) => {
    if (specifier === 'react') return { createElement() {}, Fragment: Symbol('Fragment') };
    throw new Error(`unexpected browser dependency: ${specifier}`);
  });
}

describe('DSH plugin manifest', () => {
  it('ships the same version and required host services as the package', () => {
    const root = resolve(import.meta.dirname, '..');
    const manifest = JSON.parse(readFileSync(resolve(root, 'dsh.plugin.json'), 'utf8'));
    const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));

    expect(manifest.version).toBe(pkg.version);
    expect(pkg.name).toBe('@hakimedes/dsh-easyremote-connector');
    expect(manifest.name).toBe(pkg.name);
    expect(manifest.entry.name).toBe(pkg.name);
    expect(manifest.entry.inject).toContain('apiProxy');
  });

  it('registers the browser client under the published package id', () => {
    const root = resolve(import.meta.dirname, '..');
    const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
    const client = readFileSync(resolve(root, 'client-bundle', 'client.js'), 'utf8');

    expect(client).toContain(`window.__ModuleLoader__.load({ id: '${pkg.name}'`);
    expect(client).toContain("slots.inject('settings.section'");
    expect(client).toContain('Refresh connection QR');
  });

  it('waits for the slot service before mounting the Remote settings section', () => {
    const root = resolve(import.meta.dirname, '..');
    const client = readFileSync(resolve(root, 'client-bundle', 'client.js'), 'utf8');
    const plugin = loadBrowserPlugin(client);
    const services = new Map<string, unknown>();
    const registrations: string[] = [];
    let started = false;
    const startWhenReady = () => {
      if (started || !plugin.inject.every((name) => services.has(name))) return;
      started = true;
      plugin.apply({ get: (name) => services.get(name) });
    };

    startWhenReady();
    services.set('slots', {
      inject(_name: string, register: () => void) { register(); },
      register(options: { id: string }) { registrations.push(options.id); },
    });
    startWhenReady();

    expect(registrations).toEqual(['dsh-remote']);
  });
});
