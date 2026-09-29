import { describe, expect, it } from 'vitest';
import { buildJoinUrl, parseJoinFragment } from '../../../src/app/online/joinLink';
import { DEFAULT_ONLINE_SETTINGS, DEFAULT_STUN } from '../../../src/app/online/onlineSettings';

describe('join links', () => {
  it('puts only the id in the fragment on the default server', () => {
    const url = buildJoinUrl('https://example.github.io/atlas-vtt/', 'abc_DEF-123', DEFAULT_ONLINE_SETTINGS);
    expect(url).toBe('https://example.github.io/atlas-vtt/#id=abc_DEF-123');
    expect(parseJoinFragment(new URL(url).hash)).toEqual({ hostId: 'abc_DEF-123', server: { iceServers: [{ urls: DEFAULT_STUN }] } });
  });

  it('carries a custom server and TURN relays, and reads them back', () => {
    const settings = {
      ...DEFAULT_ONLINE_SETTINGS,
      signaling: { mode: 'custom' as const, host: 'peer.example.org', port: 9000, path: '/', key: 'peerjs', secure: true },
      turnServers: [{ urls: 'turn:relay.example.org:3478', username: 'u', credential: 'c' }],
    };
    const url = buildJoinUrl('https://example.github.io/atlas-vtt#old', 'gm1', settings);
    expect(url.startsWith('https://example.github.io/atlas-vtt#id=gm1&signal=')).toBe(true);
    expect(parseJoinFragment(new URL(url).hash)).toEqual({
      hostId: 'gm1',
      server: {
        host: 'peer.example.org', port: 9000, path: '/', key: 'peerjs', secure: true,
        iceServers: [{ urls: DEFAULT_STUN }, { urls: 'turn:relay.example.org:3478', username: 'u', credential: 'c' }],
      },
    });
  });

  it('refuses incomplete or broken fragments', () => {
    expect(parseJoinFragment('')).toBeNull();
    expect(parseJoinFragment('#')).toBeNull();
    expect(parseJoinFragment('#id=')).toBeNull();
    expect(parseJoinFragment('#id=has spaces')).toBeNull();
    expect(parseJoinFragment('#id=ok&signal=%%%')).toBeNull();
    expect(parseJoinFragment('#id=ok&ice=bm90IGpzb24')).toBeNull();
  });
});
