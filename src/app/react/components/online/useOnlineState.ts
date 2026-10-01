import { useEffect, useReducer, useSyncExternalStore } from 'react';
import type { TokenControl } from '../../../online/control/TokenControl';
import { onlineSessionStore, type OnlineSessionState } from '../../../online/onlineSessionStore';
import { readPresentedScene, subscribePresentedScene, type PresentedSceneSummary } from '../../../online/ui/presentedSceneSummary';
import { presentedScene } from '../../../services/PresentedScene';

const subscribePresenting = (onChange: () => void): (() => void) =>
  presentedScene.subscribe({ presented: onChange, held: onChange, cleared: onChange });
const isPresenting = (): boolean => presentedScene.current() !== null;

/** The online session as the GM's UI sees it. */
export function useOnlineSession(): OnlineSessionState {
  return useSyncExternalStore(onlineSessionStore.subscribe, onlineSessionStore.getState);
}

/** The presented scene: its tab, name and characters. */
export function usePresentedSceneSummary(): PresentedSceneSummary {
  return useSyncExternalStore(subscribePresentedScene, readPresentedScene);
}

/**
 * Whether any scene is presented. Cheaper than the summary, which follows the presented
 * store's tokens (every frame of a token drag): for the always-mounted command palette.
 */
export function usePresenting(): boolean {
  return useSyncExternalStore(subscribePresenting, isPresenting);
}

/** Renders again whenever the session's token assignments change. */
export function useTokenControlVersion(control: TokenControl | null): void {
  const [, refresh] = useReducer((version: number) => version + 1, 0);
  useEffect(() => control?.onChange(() => refresh()), [control]);
}
