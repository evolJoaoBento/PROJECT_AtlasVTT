import { createStore, type StoreApi } from 'zustand/vanilla';
import type { SessionPlayer } from './GmSession';

export interface OnlineSessionState {
  status: 'idle' | 'starting' | 'hosting' | 'error';
  peerId: string | null;
  joinUrl: string | null;
  players: SessionPlayer[];
  error: string | null;
}

const INITIAL_STATE: OnlineSessionState = { status: 'idle', peerId: null, joinUrl: null, players: [], error: null };

/** The online session as the GM's UI sees it, written by `OnlineSessionService`. */
export const onlineSessionStore: StoreApi<OnlineSessionState> = createStore<OnlineSessionState>(() => INITIAL_STATE);

export function resetOnlineSessionStore(): void {
  onlineSessionStore.setState(INITIAL_STATE);
}
