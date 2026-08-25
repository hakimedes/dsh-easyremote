import { describe, expect, it } from 'vitest';
import { parsePairingQr, PairingQrError } from './qr';

const token = 'a'.repeat(64);

describe('parsePairingQr', () => {
  it('accepts the production DSH pairing payload', () => {
    expect(parsePairingQr(`dshremote://pair?server=https%3A%2F%2Fdsh.infomind.cc&token=${token}`)).toEqual({
      server: 'https://dsh.infomind.cc',
      pairToken: token,
    });
  });

  it('accepts an arbitrary HTTPS Community Hub and preserves its stable hubId', () => {
    const hubId = '9afef32a-0c8b-4a7b-91ab-40d866e2cb45';
    expect(parsePairingQr(`dshremote://pair?server=https%3A%2F%2Fremote.example.org&token=${token}&hubId=${hubId}`)).toEqual({
      server: 'https://remote.example.org',
      pairToken: token,
      hubId,
    });
  });

  it('keeps the internal build pinned to its configured Hub', () => {
    expect(() => parsePairingQr(
      `dshremote://pair?server=https%3A%2F%2Fremote.example.org&token=${token}`,
      { expectedServer: 'https://dsh.infomind.cc' },
    )).toThrow('different DSH server');
  });

  it('rejects a QR with the wrong scheme', () => {
    expect(() => parsePairingQr(`https://dsh.infomind.cc/pair?token=${token}`)).toThrow(PairingQrError);
  });

  it('allows localhost only when explicitly enabled', () => {
    expect(() => parsePairingQr(`dshremote://pair?server=http%3A%2F%2Flocalhost%3A8787&token=${token}`)).toThrow();
    expect(parsePairingQr(`dshremote://pair?server=http%3A%2F%2Flocalhost%3A8787&token=${token}`, { allowLocal: true })).toEqual({
      server: 'http://localhost:8787',
      pairToken: token,
    });
  });

  it('rejects a malformed hubId', () => {
    expect(() => parsePairingQr(
      `dshremote://pair?server=https%3A%2F%2Fremote.example.org&token=${token}&hubId=not-a-uuid`,
    )).toThrow('invalid Hub identity');
  });
});
