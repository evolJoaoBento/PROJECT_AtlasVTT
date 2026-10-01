import { afterEach, describe, expect, it } from 'vitest';
import { createStore } from 'zustand/vanilla';
import { readPresentedScene } from '../../../src/app/online/ui/presentedSceneSummary';
import { presentedScene, type PresentedView } from '../../../src/app/services/PresentedScene';
import { createTabMetaStore } from '../../../src/app/stores/tabMetaStore';

afterEach(() => { presentedScene.clear(); });

describe('presented scene summary', () => {
  it('keeps the same summary while a token drag changes nothing it shows', () => {
    const tabMetaStore = createTabMetaStore();
    const tab = tabMetaStore.getState().addTab('Tavern.atlasmap', 'Tavern');
    tabMetaStore.getState().setActiveTab(tab);
    const hero = { id: 'hero', kind: 'character', name: 'Hero', x: 0 };
    const atlasStore = createStore(() => ({ isMapLoading: false, objects: { tokens: { hero } } }));
    presentedScene.present({ tabMetaStore, atlasStore, register: () => {} } as unknown as PresentedView, tab);

    const before = readPresentedScene();
    expect(before.characters).toEqual([{ id: 'hero', name: 'Hero' }]);

    atlasStore.setState({ objects: { tokens: { hero: { ...hero, x: 40 } } } });
    expect(readPresentedScene()).toBe(before);

    atlasStore.setState({ objects: { tokens: { hero: { ...hero, name: 'Heroine' } } } });
    expect(readPresentedScene().characters).toEqual([{ id: 'hero', name: 'Heroine' }]);
  });
});
