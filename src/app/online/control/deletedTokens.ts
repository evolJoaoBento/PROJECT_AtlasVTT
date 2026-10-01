/**
 * Drops the assignments of tokens deleted from the presented scene. A token is deleted
 * when it was in the live store and is gone from it while the same map stays loaded:
 * holding the scene, loading a map, presenting another scene or clearing removes
 * nothing, so assignments come back with their scene.
 */
import type { PresentedSceneInfo } from '../../services/PresentedScene';
import type { ViewAtlasState } from '../../storeFactory';
import type { PresentedSceneSource } from '../scene/sceneSources';
import type { TokenControl } from './TokenControl';

type Tokens = ViewAtlasState['objects']['tokens'];

/** The loaded map's tokens; null while a map loads, when the store holds no scene of its own. */
function loadedTokens(state: ViewAtlasState): Tokens | null {
  return state.isMapLoading ? null : state.objects.tokens;
}

export function watchDeletedTokens(presented: PresentedSceneSource, control: TokenControl): () => void {
  let stopStore: (() => void) | null = null;
  const detach = (): void => {
    stopStore?.();
    stopStore = null;
  };
  const attach = (scene: PresentedSceneInfo): void => {
    detach();
    let previous = loadedTokens(scene.store.getState());
    stopStore = scene.store.subscribe((state) => {
      const tokens = loadedTokens(state);
      if (tokens === previous) return;
      const before = previous;
      previous = tokens;
      if (!tokens || !before) return;
      const gone = control.assignedTokens().filter((id) => Object.hasOwn(before, id) && !Object.hasOwn(tokens, id));
      if (gone.length > 0) control.dropTokens(gone);
    });
  };
  const stopListening = presented.subscribe({
    presented: (scene) => attach(scene),
    held: () => detach(),
    cleared: () => detach(),
  });
  const current = presented.current();
  if (current && !presented.isHeld()) attach(current);
  return () => {
    stopListening();
    detach();
  };
}
