import { describe, expect, it } from 'vitest';
import { DEFAULT_PACK_TEXTURES } from '../../../online-client/physicalDiceStage.mts';
import pack from '../../../dice/Texture-Pack-Default/pack.json';

describe("the join page's dice pack", () => {
  it("bundles each die's face sheet as the default pack names it", () => {
    const dice = pack.dice as Record<string, { texture?: string }>;
    expect(Object.keys(DEFAULT_PACK_TEXTURES).sort()).toEqual(Object.keys(dice).sort());
    for (const [type, url] of Object.entries(DEFAULT_PACK_TEXTURES)) {
      expect(url.endsWith(`/dice/Texture-Pack-Default/${dice[type]?.texture}`)).toBe(true);
    }
  });
});
