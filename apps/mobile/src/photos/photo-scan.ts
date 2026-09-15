import * as MediaLibrary from 'expo-media-library/legacy';
import { classifyImage, type VisionLabel } from '../native/vision';

export type PoiCategory =
  | 'food'
  | 'restaurant'
  | 'landmark'
  | 'accommodation'
  | 'transit'
  | 'nature'
  | 'street';

export interface PhotoCandidate {
  assetId: string;
  filename: string;
  uri: string;
  capturedAt: string;
  latitude: number | null;
  longitude: number | null;
  width: number;
  height: number;
  category: PoiCategory;
  labels: VisionLabel[];
}

export interface ScanProgress {
  total: number;
  processed: number;
  candidates: number;
  unavailable: number;
  failed: number;
}

export interface ScanResult {
  candidates: PhotoCandidate[];
  progress: ScanProgress;
}

const CATEGORY_TERMS: Record<PoiCategory, string[]> = {
  food: [
    'food',
    'dish',
    'meal',
    'cuisine',
    'dessert',
    'beverage',
    'drink',
    'coffee',
    'tea',
    'bakery',
    'bread',
    'cake',
    'noodle',
    'rice',
    'meat',
    'seafood',
    'sushi',
  ],
  restaurant: [
    'restaurant',
    'dining',
    'diner',
    'cafe',
    'cafeteria',
    'bar',
    'pub',
  ],
  landmark: [
    'landmark',
    'monument',
    'temple',
    'shrine',
    'church',
    'cathedral',
    'castle',
    'tower',
    'bridge',
    'museum',
    'statue',
  ],
  accommodation: ['hotel', 'resort', 'motel', 'hostel', 'lodging', 'bedroom'],
  transit: [
    'train',
    'railway',
    'subway',
    'metro',
    'station',
    'airport',
    'airplane',
    'bus',
    'tram',
    'ferry',
    'ship',
  ],
  nature: [
    'mountain',
    'waterfall',
    'lake',
    'beach',
    'ocean',
    'sea',
    'forest',
    'park',
    'garden',
    'landscape',
    'river',
  ],
  street: [
    'street',
    'road',
    'city',
    'building',
    'architecture',
    'storefront',
    'shop',
    'market',
    'sign',
  ],
};

export async function requestPhotoAccess() {
  return MediaLibrary.requestPermissionsAsync();
}

export async function countPhotos(start: Date, endExclusive: Date) {
  const page = await MediaLibrary.getAssetsAsync({
    first: 1,
    mediaType: MediaLibrary.MediaType.photo,
    createdAfter: start,
    createdBefore: endExclusive,
  });
  return page.totalCount;
}

export async function scanPhotos(
  start: Date,
  endExclusive: Date,
  onProgress: (progress: ScanProgress) => void,
): Promise<ScanResult> {
  const assets = await loadAssets(start, endExclusive);
  const progress: ScanProgress = {
    total: assets.length,
    processed: 0,
    candidates: 0,
    unavailable: 0,
    failed: 0,
  };
  const candidates: PhotoCandidate[] = [];

  onProgress({ ...progress });

  for (const asset of assets) {
    try {
      if (asset.mediaSubtypes?.includes('screenshot')) {
        progress.processed += 1;
        onProgress({ ...progress });
        continue;
      }

      const info = await MediaLibrary.getAssetInfoAsync(asset, {
        shouldDownloadFromNetwork: false,
      });

      if (!info.localUri || info.isNetworkAsset) {
        progress.unavailable += 1;
        progress.processed += 1;
        onProgress({ ...progress });
        continue;
      }

      const labels = await classifyImage(info.localUri);
      const category = findPoiCategory(labels);
      if (category) {
        candidates.push({
          assetId: asset.id,
          filename: asset.filename,
          uri: info.localUri,
          capturedAt: new Date(asset.creationTime).toISOString(),
          latitude: info.location?.latitude ?? null,
          longitude: info.location?.longitude ?? null,
          width: asset.width,
          height: asset.height,
          category,
          labels,
        });
        progress.candidates += 1;
      }
    } catch {
      progress.failed += 1;
    }

    progress.processed += 1;
    onProgress({ ...progress });
  }

  return {
    candidates,
    progress,
  };
}

async function loadAssets(start: Date, endExclusive: Date) {
  const assets: MediaLibrary.Asset[] = [];
  let after: string | undefined;

  do {
    const page = await MediaLibrary.getAssetsAsync({
      first: 200,
      after,
      mediaType: MediaLibrary.MediaType.photo,
      createdAfter: start,
      createdBefore: endExclusive,
      sortBy: [[MediaLibrary.SortBy.creationTime, true]],
    });

    assets.push(...page.assets);
    after = page.hasNextPage ? page.endCursor : undefined;
  } while (after);

  return assets;
}

function findPoiCategory(labels: VisionLabel[]): PoiCategory | null {
  let best:
    | {
        category: PoiCategory;
        confidence: number;
      }
    | undefined;

  for (const label of labels) {
    if (label.confidence < 0.1) continue;
    const identifier = label.identifier.toLowerCase();

    for (const [category, terms] of Object.entries(CATEGORY_TERMS) as Array<
      [PoiCategory, string[]]
    >) {
      if (!terms.some((term) => identifier.includes(term))) continue;
      if (!best || label.confidence > best.confidence) {
        best = {
          category,
          confidence: label.confidence,
        };
      }
    }
  }

  return best?.category ?? null;
}
