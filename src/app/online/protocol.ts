/**
 * The online play wire format. Shared with the web player page, so this file
 * imports nothing but the scene wire format beside it: no Obsidian, no PIXI, no PeerJS.
 */
import type { SceneCamera } from './scene/sceneCamera';
import type { PlayerDrawing, PlayerFogOp, PlayerSceneBody, ScenePatchBody } from './scene/sceneTypes';
import {
  isDrawingRecords, isFogRecords, isLastSeq, isPlayerSceneBody, isSceneCamera, isSceneCount, isSceneId, isScenePatchBody, isSceneSeq,
} from './scene/sceneValidation';
export const PROTOCOL_VERSION = 1;
export const MAX_CONTROL_MESSAGE_BYTES = 256 * 1024;
export const MAX_PLAYER_NAME_LENGTH = 40;
/** The most tokens one player may control, and so the longest `token-control` list. */
export const MAX_CONTROLLED_TOKENS = 256;

export type DenyReason = 'denied' | 'kicked' | 'full' | 'version' | 'ended';
const DENY_REASONS: readonly DenyReason[] = ['denied', 'kicked', 'full', 'version', 'ended'];

export interface PresencePlayer {
  playerId: string;
  name: string;
  connected: boolean;
}

export type ControlMessage =
  | { v: 1; type: 'join'; name: string; playerKey: string; client: { kind: 'web' | 'obsidian'; version: string } }
  | { v: 1; type: 'admitted'; playerId: string; session: { title: string } }
  | { v: 1; type: 'denied'; reason: DenyReason }
  | { v: 1; type: 'presence'; players: PresencePlayer[] }
  | { v: 1; type: 'ping'; t: number }
  | { v: 1; type: 'pong'; t: number }
  | { v: 1; type: 'bye'; reason: string }
  | { v: 1; type: 'scene-snapshot'; seq: number; scene: PlayerSceneBody; fogParts: number; drawingParts: number }
  | { v: 1; type: 'scene-fog'; seq: number; part: number; records: Record<string, PlayerFogOp> }
  | { v: 1; type: 'scene-drawings'; seq: number; part: number; records: Record<string, PlayerDrawing> }
  | {
    v: 1; type: 'scene-patch'; seq: number;
    set: ScenePatchBody['set']; upsert: ScenePatchBody['upsert']; remove: ScenePatchBody['remove'];
  }
  | { v: 1; type: 'scene-clear'; seq: number }
  | { v: 1; type: 'scene-resync'; seq: number }
  | ({ v: 1; type: 'scene-camera' } & SceneCamera)
  /** GM to one player: the tokens that player may move, for this session. */
  | { v: 1; type: 'token-control'; tokenIds: string[] }
  /** Player to GM, once per drop: where the player let go of one of their tokens, in world units. */
  | { v: 1; type: 'token-move'; sceneId: string; tokenId: string; x: number; y: number }
  /** GM to the player who sent the move: it failed a check, so the token stays where the scene has it. */
  | { v: 1; type: 'token-move-refused'; tokenId: string };

/** What an admitted player may send besides `ping`, `pong` and `bye`; the GM drops every other type from a player. */
export const PLAYER_MESSAGE_TYPES: ReadonlySet<ControlMessage['type']> = new Set<ControlMessage['type']>(['scene-resync', 'token-move']);

export type Decoded =
  | { kind: 'message'; message: ControlMessage }
  | { kind: 'ignored' }
  | { kind: 'version' }
  | { kind: 'invalid'; reason: string };

type Fields = Record<string, unknown>;

const isString = (value: unknown, max = 1024): value is string => typeof value === 'string' && value.length <= max;
const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const isRecord = (value: unknown): value is Fields => typeof value === 'object' && value !== null && !Array.isArray(value);

/** Checks the fields of each known type; returns whether the shape is right. */
const VALIDATORS: Record<ControlMessage['type'], (m: Fields) => boolean> = {
  join: (m) => isString(m.name, 200) && isString(m.playerKey, 64) && m.playerKey.length > 0
    && isRecord(m.client) && (m.client.kind === 'web' || m.client.kind === 'obsidian') && isString(m.client.version, 32),
  admitted: (m) => isString(m.playerId, 64) && isRecord(m.session) && isString(m.session.title, 200),
  denied: (m) => DENY_REASONS.includes(m.reason as DenyReason),
  presence: (m) => Array.isArray(m.players) && m.players.length <= 64 && m.players.every((p) =>
    isRecord(p) && isString(p.playerId, 64) && isString(p.name, 200) && typeof p.connected === 'boolean'),
  ping: (m) => isNumber(m.t),
  pong: (m) => isNumber(m.t),
  bye: (m) => isString(m.reason, 200),
  'scene-snapshot': (m) => isSceneSeq(m.seq) && isSceneCount(m.fogParts) && isSceneCount(m.drawingParts)
    && isPlayerSceneBody(m.scene),
  'scene-fog': (m) => isSceneSeq(m.seq) && isSceneCount(m.part) && isFogRecords(m.records),
  'scene-drawings': (m) => isSceneSeq(m.seq) && isSceneCount(m.part) && isDrawingRecords(m.records),
  'scene-patch': (m) => isSceneSeq(m.seq) && isScenePatchBody(m),
  'scene-clear': (m) => isSceneSeq(m.seq),
  'scene-resync': (m) => isLastSeq(m.seq),
  'scene-camera': (m) => isSceneCamera(m),
  'token-control': (m) => Array.isArray(m.tokenIds) && m.tokenIds.length <= MAX_CONTROLLED_TOKENS
    && m.tokenIds.every((id) => isSceneId(id)),
  // Any number: one JSON reads as Infinity (`1e400`) is the GM's check to refuse, not a broken message.
  'token-move': (m) => isSceneId(m.sceneId) && isSceneId(m.tokenId) && typeof m.x === 'number' && typeof m.y === 'number',
  'token-move-refused': (m) => isSceneId(m.tokenId),
};

export function encodeControl(message: ControlMessage): string {
  return JSON.stringify(message);
}

export function decodeControl(raw: unknown): Decoded {
  if (typeof raw !== 'string') return { kind: 'invalid', reason: 'not-text' };
  if (raw.length > MAX_CONTROL_MESSAGE_BYTES) return { kind: 'invalid', reason: 'too-large' };
  // Check UTF-8 byte length only if string is potentially large
  if (raw.length > MAX_CONTROL_MESSAGE_BYTES / 3) {
    const byteLength = new TextEncoder().encode(raw).length;
    if (byteLength > MAX_CONTROL_MESSAGE_BYTES) return { kind: 'invalid', reason: 'too-large' };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { kind: 'invalid', reason: 'not-json' };
  }
  if (!isRecord(parsed) || typeof parsed.type !== 'string') return { kind: 'invalid', reason: 'no-type' };
  if (parsed.v !== PROTOCOL_VERSION) return { kind: 'version' };
  const type = parsed.type as ControlMessage['type'];
  if (!Object.hasOwn(VALIDATORS, type)) return { kind: 'ignored' };
  const validate = VALIDATORS[type];
  return validate(parsed)
    ? { kind: 'message', message: parsed as unknown as ControlMessage }
    : { kind: 'invalid', reason: `bad-${type}` };
}

/** A player's display name, cleaned up; null when nothing usable is left or it is too long. */
export function normalizePlayerName(name: unknown): string | null {
  if (typeof name !== 'string') return null;
  const cleaned = name
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '') // delete non-whitespace control chars
    .replace(/[\t\n\r]/g, ' ') // replace whitespace control chars with space
    .replace(/\s+/g, ' ') // collapse whitespace
    .trim();
  return cleaned.length > 0 && cleaned.length <= MAX_PLAYER_NAME_LENGTH ? cleaned : null;
}
