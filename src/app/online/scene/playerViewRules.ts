// src/app/online/scene/playerViewRules.ts
import type { AtlasSettings } from '../../services/SettingsService';

/** The `localPlayerView` settings online players follow. */
export const PLAYER_VIEW_RULE_KEYS = [
  'showGrid', 'showTokenHP', 'showTokenStress', 'showTokenNameplates', 'showWidgets', 'showInitiative',
] as const;

export type PlayerViewRules = Pick<AtlasSettings['localPlayerView'], typeof PLAYER_VIEW_RULE_KEYS[number]>;

/** Only the six rules, each strictly true or false. */
export function pickPlayerViewRules(settings: PlayerViewRules): PlayerViewRules {
  return {
    showGrid: settings.showGrid === true,
    showTokenHP: settings.showTokenHP === true,
    showTokenStress: settings.showTokenStress === true,
    showTokenNameplates: settings.showTokenNameplates === true,
    showWidgets: settings.showWidgets === true,
    showInitiative: settings.showInitiative === true,
  };
}

export function samePlayerViewRules(a: PlayerViewRules, b: PlayerViewRules): boolean {
  return PLAYER_VIEW_RULE_KEYS.every((key) => a[key] === b[key]);
}
