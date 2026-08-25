import { describe, expect, it } from 'vitest';

import { normalizeHostname, normalizeNameserver, verifyNameservers } from './domain.js';

describe('deep setup domain checks', () => {
  it('normalizes an internationalized hostname and rejects URLs or local names', () => {
    expect(normalizeHostname(' DSH.Example.COM. ')).toBe('dsh.example.com');
    expect(() => normalizeHostname('https://dsh.example.com/path')).toThrow(/hostname/i);
    expect(() => normalizeHostname('localhost')).toThrow(/registrable/i);
  });

  it('requires the public NS answer to exactly include both assigned nameservers', async () => {
    const resolve = async () => ['LIA.NS.CLOUDFLARE.COM', 'walt.ns.cloudflare.com.'];
    await expect(verifyNameservers('example.com', [
      'lia.ns.cloudflare.com',
      'walt.ns.cloudflare.com',
    ], resolve)).resolves.toMatchObject({ active: true });
    await expect(verifyNameservers('example.com', [
      'lia.ns.cloudflare.com',
      'missing.ns.cloudflare.com',
    ], resolve)).resolves.toMatchObject({ active: false, missing: ['missing.ns.cloudflare.com'] });
  });

  it('accepts only Cloudflare nameserver hostnames', () => {
    expect(normalizeNameserver(' Lia.NS.Cloudflare.com. ')).toBe('lia.ns.cloudflare.com');
    expect(() => normalizeNameserver('ns.example.com')).toThrow(/Cloudflare/i);
  });
});
