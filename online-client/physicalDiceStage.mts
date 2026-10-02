// online-client/physicalDiceStage.mts
/**
 * The join page's 3D dice table: Atlas's dice engine (three.js and cannon-es) wearing the default
 * dice pack, which is bundled with the page. The overlay imports this module only when a player
 * first throws physical dice, so none of it is in the page's first download.
 */
import { DiceEngine, type DicePack } from '../src/app/physical-dice/engine/DiceEngine';
import { createDiceSettings } from '../src/app/physical-dice/engine/diceSettings';
import defaultPack from '../dice/Texture-Pack-Default/pack.json';
import type { DiceStage } from './physicalDiceOverlay.mts';

/**
 * The default pack's face sheets, as `pack.json` names them. Each is a literal, so Vite bundles
 * the image with the page; `tests/unit/online/physicalDiceStage.test.ts` checks them against the pack.
 */
export const DEFAULT_PACK_TEXTURES: Readonly<Record<string, string>> = {
  d4: new URL('../dice/Texture-Pack-Default/d4_Numbers.png', import.meta.url).href,
  d6: new URL('../dice/Texture-Pack-Default/d6_Numbers.png', import.meta.url).href,
  d8: new URL('../dice/Texture-Pack-Default/d8_Numbers.png', import.meta.url).href,
  d10: new URL('../dice/Texture-Pack-Default/d10_Numbers.png', import.meta.url).href,
  d100: new URL('../dice/Texture-Pack-Default/d10_Percent_Numbers.png', import.meta.url).href,
  d12: new URL('../dice/Texture-Pack-Default/d12_Numbers.png', import.meta.url).href,
  d20: new URL('../dice/Texture-Pack-Default/d20_Numbers.png', import.meta.url).href,
};

/**
 * The engine was written for Obsidian, which gives every window a global `createEl`; it makes its
 * canvases with it. The page has none, so it gets a plain one.
 */
function provideCreateEl(): void {
  const scope = globalThis as { createEl?: unknown };
  if (typeof scope.createEl !== 'function') scope.createEl = (tag: string): HTMLElement => document.createElement(tag);
}

function hasWebGl(): boolean {
  const probe = document.createElement('canvas');
  return Boolean(probe.getContext('webgl2') ?? probe.getContext('webgl'));
}

export function createDiceStage(host: HTMLElement): DiceStage {
  if (!hasWebGl()) throw new Error('WebGL is not available');
  provideCreateEl();
  const engine = new DiceEngine(host, createDiceSettings());
  engine.setPack(defaultPack as unknown as DicePack);
  engine.setPackTextures({ ...DEFAULT_PACK_TEXTURES });
  const layout = (): void => {
    const rect = host.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) engine.updateSize(rect.width, rect.height);
  };
  new ResizeObserver(layout).observe(host);
  return {
    show: (types) => {
      layout();
      engine.isViewActive = true;
      engine.clearAllDice();
      for (const type of types) engine.createSingleDice(type, null);
    },
    throwAll: async () => {
      await engine.roll();
    },
    takeLastRoll: () => engine.takeLastRoll()?.map((die) => ({ ...(die.index === undefined ? {} : { index: die.index }), value: die.value })) ?? null,
    caughtCount: () => engine.getDiceStatus().filter((die) => die.status === 'caught').length,
    rerollCaught: () => {
      engine.rerollCaughtDice();
    },
    rollInProgress: () => engine.rollInProgress,
    onSettled: (listener) => {
      engine.onRollComplete = () => listener();
    },
    clear: () => {
      engine.clearAllDice();
      engine.isViewActive = false;
    },
  };
}
