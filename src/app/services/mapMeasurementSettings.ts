import { resolveMeasurementSettings, type MeasurementSettings } from '../grid/measurementFormat';
import type { ViewAtlasState } from '../storeFactory';
import type { CollectionGridDefaults } from '../types/collectionSettingsTypes';
import type { AssetService } from './AssetService';

/** The grid defaults of the collection holding the map at `mapPath`; null for a map outside a collection. */
export function collectionGridDefaultsFor(assetService: AssetService, mapPath: string | null): CollectionGridDefaults | null {
  const collectionId = mapPath ? assetService.getCollectionForMap(mapPath) : null;
  return (collectionId ? assetService.getCollectionSettings(collectionId).gridDefaults : undefined) ?? null;
}

/** Measurement settings for the map in `state`, read from its collection when it has one. */
export function mapMeasurementSettings(
  assetService: AssetService,
  state: Pick<ViewAtlasState, 'mapPath' | 'grid'>,
): MeasurementSettings {
  return resolveMeasurementSettings(collectionGridDefaultsFor(assetService, state.mapPath) ?? undefined, state.grid);
}
