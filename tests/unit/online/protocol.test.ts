import { describe, expect, it } from 'vitest';
import { decodeControl, encodeControl, normalizePlayerName, MAX_CONTROL_MESSAGE_BYTES } from '../../../src/app/online/protocol';
import { randomId } from '../../../src/app/online/ids';

describe('online protocol', () => {
  it('round-trips every message type', () => {
    const messages = [
      { v: 1, type: 'join', name: 'Anna', playerKey: 'k1', client: { kind: 'web', version: '0.5.0' } },
      { v: 1, type: 'admitted', playerId: 'p1', session: { title: 'Vault' } },
      { v: 1, type: 'denied', reason: 'kicked' },
      { v: 1, type: 'presence', players: [{ playerId: 'p1', name: 'Anna', connected: true }] },
      { v: 1, type: 'ping', t: 5 },
      { v: 1, type: 'pong', t: 5 },
      { v: 1, type: 'bye', reason: 'ended' },
    ] as const;
    for (const message of messages) {
      expect(decodeControl(encodeControl(message))).toEqual({ kind: 'message', message });
    }
  });

  it('refuses another protocol version', () => {
    expect(decodeControl(JSON.stringify({ v: 2, type: 'ping', t: 1 }))).toEqual({ kind: 'version' });
  });

  it('ignores types it does not know, for newer peers', () => {
    expect(decodeControl(JSON.stringify({ v: 1, type: 'snapshot', scene: {} }))).toEqual({ kind: 'ignored' });
  });

  it('rejects malformed input', () => {
    expect(decodeControl('not json').kind).toBe('invalid');
    expect(decodeControl(42).kind).toBe('invalid');
    expect(decodeControl(JSON.stringify({ v: 1, type: 'denied', reason: 'bored' })).kind).toBe('invalid');
    expect(decodeControl(JSON.stringify({ v: 1, type: 'join', name: 'A', playerKey: 7, client: { kind: 'web', version: '1' } })).kind).toBe('invalid');
    expect(decodeControl(JSON.stringify({ v: 1, type: 'presence', players: [{ playerId: 'p', name: 'A' }] })).kind).toBe('invalid');
  });

  it('rejects oversized messages', () => {
    const big = JSON.stringify({ v: 1, type: 'bye', reason: 'x'.repeat(MAX_CONTROL_MESSAGE_BYTES) });
    expect(decodeControl(big)).toEqual({ kind: 'invalid', reason: 'too-large' });
  });

  it('normalizes player names and refuses empty ones', () => {
    expect(normalizePlayerName('  Anna   the\tBold  ')).toBe('Anna the Bold');
    expect(normalizePlayerName('Bob\u0000\u0007')).toBe('Bob');
    expect(normalizePlayerName('   ')).toBeNull();
    expect(normalizePlayerName(12)).toBeNull();
    expect(normalizePlayerName('x'.repeat(41))).toBeNull();
    expect(normalizePlayerName('<b>Eve</b>')).toBe('<b>Eve</b>'); // kept as text; the UI never renders HTML
  });

  it('makes long unguessable ids', () => {
    const a = randomId();
    expect(a).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(randomId()).not.toBe(a);
  });
});
