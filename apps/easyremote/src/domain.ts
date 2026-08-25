import { resolveNs } from 'node:dns/promises';
import { domainToASCII } from 'node:url';

export function normalizeHostname(value: string): string {
  const trimmed = value.trim().replace(/\.$/, '');
  if (!trimmed || trimmed.includes('://') || /[/?#@:]/.test(trimmed)) {
    throw new Error('Enter a hostname, not a URL');
  }
  const hostname = domainToASCII(trimmed).toLowerCase();
  if (!hostname || hostname.length > 253 || !hostname.includes('.')) {
    throw new Error('Hostname must use a registrable domain');
  }
  const labels = hostname.split('.');
  if (labels.some((label) => !label || label.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label))) {
    throw new Error('Hostname contains an invalid DNS label');
  }
  return hostname;
}

export function normalizeNameserver(value: string): string {
  const hostname = normalizeHostname(value);
  if (!hostname.endsWith('.ns.cloudflare.com')) throw new Error('Nameserver must be assigned by Cloudflare');
  return hostname;
}

export async function verifyNameservers(
  domain: string,
  expected: string[],
  resolver: (hostname: string) => Promise<string[]> = resolveNs,
) {
  const hostname = normalizeHostname(domain);
  const wanted = [...new Set(expected.map(normalizeNameserver))];
  if (wanted.length !== 2) throw new Error('Exactly two distinct Cloudflare nameservers are required');
  const current = (await resolver(hostname)).map((value) => value.trim().replace(/\.$/, '').toLowerCase());
  const missing = wanted.filter((value) => !current.includes(value));
  return { active: missing.length === 0, expected: wanted, current, missing };
}
