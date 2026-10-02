/**
 * The token moves world (`tokenMoveFixtures.ts`) with the player tools' GM side: the dice host
 * on an in-memory dice feed, rolling every die in the middle, and the laser relay, with a laser
 * hub on the presented view as `PixiRendererOrchestrator` gives every view.
 */
import { LaserHub, type RemoteLaser } from '../../../src/app/pixi/laser/LaserHub';
import type { ControlMessage } from '../../../src/app/online/protocol';
import type { DiceFeed } from '../../../src/app/online/diceFeed';
import { DiceHost } from '../../../src/app/online/tools/DiceHost';
import { LaserRelay } from '../../../src/app/online/tools/LaserRelay';
import type { DiceRollResult } from '../../../src/app/tools/diceRolling';
import { moveWorld, type MovePlayer } from './tokenMoveFixtures';

export type MemoryDiceFeed = DiceFeed & { readonly published: DiceRollResult[]; listening(): number };

/** Atlas's dice event without the document: what `publish` gets, every listener hears. */
export function memoryDiceFeed(): MemoryDiceFeed {
  const listeners = new Set<(result: DiceRollResult) => void>();
  const published: DiceRollResult[] = [];
  return {
    published,
    listening: () => listeners.size,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    publish: (result) => {
      published.push(result);
      for (const listener of [...listeners]) listener(result);
    },
  };
}

/** Rolls the middle of every die: a d4 rolls 3, a d6 4, a d8 5, a d20 11. */
export const MIDDLE_ROLL = (): number => 0.5;

type Laser = Extract<ControlMessage, { type: 'laser' }>;
type DiceLog = Extract<ControlMessage, { type: 'dice-log' }>;

export function toolsWorld(options: Parameters<typeof moveWorld>[0] = {}) {
  const world = moveWorld({ rules: { showTokenNameplates: true }, ...options });
  const feed = memoryDiceFeed();
  const hub = new LaserHub();
  const shown: RemoteLaser[] = [];
  hub.onRemote((laser) => shown.push(laser));
  Object.assign(world.view.renderer!, { getLaserHub: () => hub });
  const dice = new DiceHost({ session: world.gm, presented: world.presented, projection: world.broadcaster, feed, random: MIDDLE_ROLL });
  const lasers = new LaserRelay({ session: world.gm, presented: world.presented, projection: world.broadcaster });
  dice.start();
  lasers.start();
  return {
    ...world, feed, hub, shown, dice, lasers,
    /** The dice logs the GM sent `player`, in order. */
    logs: (player: MovePlayer): DiceLog[] => player.received.filter((message): message is DiceLog => message.type === 'dice-log'),
    /** The lasers the GM sent `player`, in order. */
    lasersOf: (player: MovePlayer): Laser[] => player.received.filter((message): message is Laser => message.type === 'laser'),
    sceneId: (): string => world.broadcaster.currentProjection()?.sceneId ?? 'none',
    finish(): void {
      lasers.stop();
      dice.stop();
      world.finish();
    },
  };
}
