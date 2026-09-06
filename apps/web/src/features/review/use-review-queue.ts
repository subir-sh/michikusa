'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
const POI_ELIGIBLE_CATEGORIES = new Set([
  'food',
  'restaurant',
  'landmark',
  'accommodation',
  'transit',
  'nature',
  'street',
]);

interface QueuePhoto {
  id: number;
  latitude: number | null;
  longitude: number | null;
  category: string | null;
  visitId: number | null;
}

export function useReviewQueue(selectedDate: string) {
  const [photos, setPhotos] = useState<QueuePhoto[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!selectedDate) {
      setPhotos([]);
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(
        `${API_URL}/photos?date=${encodeURIComponent(selectedDate)}`,
      );
      if (!response.ok) throw new Error(await response.text());
      setPhotos((await response.json()) as QueuePhoto[]);
    } finally {
      setLoading(false);
    }
  }, [selectedDate]);

  const unresolved = useMemo(
    () =>
      photos.filter(
        (photo) =>
          photo.visitId === null &&
          photo.latitude !== null &&
          photo.longitude !== null &&
          photo.category !== null &&
          POI_ELIGIBLE_CATEGORIES.has(photo.category),
      ),
    [photos],
  );

  const nextAfter = useCallback(
    (photoId: number | null) => {
      if (unresolved.length === 0) return null;
      if (photoId === null) return unresolved[0].id;

      const index = unresolved.findIndex((photo) => photo.id === photoId);
      if (index === -1) return unresolved[0].id;
      if (unresolved.length === 1) return null;

      return unresolved[(index + 1) % unresolved.length].id;
    },
    [unresolved],
  );

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const refresh = () => void load();
    window.addEventListener('michikusa:photos-imported', refresh);
    window.addEventListener('michikusa:classification-changed', refresh);
    window.addEventListener('michikusa:locations-changed', refresh);
    window.addEventListener('michikusa:place-changed', refresh);
    return () => {
      window.removeEventListener('michikusa:photos-imported', refresh);
      window.removeEventListener('michikusa:classification-changed', refresh);
      window.removeEventListener('michikusa:locations-changed', refresh);
      window.removeEventListener('michikusa:place-changed', refresh);
    };
  }, [load]);

  return {
    unresolvedCount: unresolved.length,
    loading,
    nextAfter,
  };
}
