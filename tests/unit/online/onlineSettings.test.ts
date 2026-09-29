import { describe, expect, it } from 'vitest';
import { DEFAULT_ONLINE_SETTINGS, DEFAULT_STUN, formatTurnServers, parseTurnServers, peerServerOptions } from '../../../src/app/online/onlineSettings';

describe('online settings', () => {
  it('uses the PeerJS cloud and public STUN by default', () => {
    expect(peerServerOptions(DEFAULT_ONLINE_SETTINGS)).toEqual({ iceServers: [{ urls: DEFAULT_STUN }] });
  });

  it('points at a custom signaling server and adds TURN servers', () => {
    const options = peerServerOptions({
      ...DEFAULT_ONLINE_SETTINGS,
      signaling: { mode: 'custom', host: 'peer.example.org', port: 443, path: '/myapp', key: 'k', secure: true },
      turnServers: [{ urls: 'turn:relay.example.org:3478', username: 'u', credential: 'c' }],
    });
    expect(options).toEqual({
      host: 'peer.example.org', port: 443, path: '/myapp', key: 'k', secure: true,
      iceServers: [{ urls: DEFAULT_STUN }, { urls: 'turn:relay.example.org:3478', username: 'u', credential: 'c' }],
    });
  });

  it('reads TURN servers one per line and writes them back', () => {
    const text = '# relay\nturn:a.example:3478 alice secret\n\nturns:b.example:5349 bob pw\nhttp://nope x y\n';
    const servers = parseTurnServers(text);
    expect(servers).toEqual([
      { urls: 'turn:a.example:3478', username: 'alice', credential: 'secret' },
      { urls: 'turns:b.example:5349', username: 'bob', credential: 'pw' },
    ]);
    expect(parseTurnServers(formatTurnServers(servers))).toEqual(servers);
  });
});
