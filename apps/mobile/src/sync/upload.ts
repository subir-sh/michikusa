import * as ImageManipulator from 'expo-image-manipulator';
import type { PhotoCandidate } from '../photos/photo-scan';

export interface UploadProgress {
  total: number;
  processed: number;
  imported: number;
  skipped: number;
  failed: number;
}

export async function uploadCandidates(
  rawServerUrl: string,
  candidates: PhotoCandidate[],
  onProgress: (progress: UploadProgress) => void,
) {
  const serverUrl = normalizeServerUrl(rawServerUrl);
  const progress: UploadProgress = {
    total: candidates.length,
    processed: 0,
    imported: 0,
    skipped: 0,
    failed: 0,
  };

  onProgress({ ...progress });

  for (const candidate of candidates) {
    try {
      const scale = Math.min(
        1,
        1600 / Math.max(candidate.width, candidate.height),
      );
      const width = Math.max(1, Math.round(candidate.width * scale));
      const height = Math.max(1, Math.round(candidate.height * scale));

      const image = await ImageManipulator.manipulateAsync(
        candidate.uri,
        [{ resize: { width, height } }],
        {
          compress: 0.84,
          format: ImageManipulator.SaveFormat.JPEG,
        },
      );

      const form = new FormData();
      form.append(
        'file',
        {
          uri: image.uri,
          name: 'photo.jpg',
          type: 'image/jpeg',
        } as unknown as Blob,
      );
      form.append('assetId', candidate.assetId);
      form.append('capturedAt', candidate.capturedAt);
      form.append('category', candidate.category);

      if (candidate.latitude !== null) {
        form.append('latitude', String(candidate.latitude));
      }
      if (candidate.longitude !== null) {
        form.append('longitude', String(candidate.longitude));
      }

      const response = await fetch(`${serverUrl}/photos/mobile-sync`, {
        method: 'POST',
        body: form,
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      const result = (await response.json()) as {
        status: 'imported' | 'skipped';
      };

      if (result.status === 'imported') progress.imported += 1;
      else progress.skipped += 1;
    } catch {
      progress.failed += 1;
    }

    progress.processed += 1;
    onProgress({ ...progress });
  }

  return progress;
}

function normalizeServerUrl(value: string) {
  const trimmed = value.trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(trimmed)) {
    throw new Error('PC 서버 주소는 http:// 또는 https://로 시작해야 합니다.');
  }
  return trimmed;
}
