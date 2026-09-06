'use client';

import { useEffect, useState } from 'react';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export interface PlaceCandidate {
  placeId: string;
  name: string;
  latitude: number;
  longitude: number;
  primaryType: string | null;
  types: string[];
  formattedAddress: string | null;
  distanceMeters: number;
  score: number;
}

export interface PlaceCandidatesResult {
  photo: {
    id: number;
    category: string | null;
    latitude: number | null;
    longitude: number | null;
  };
  eligible: boolean;
  reason?: string;
  radius: number | null;
  candidates: PlaceCandidate[];
}

export function usePlaceCandidates(photoId: number | null) {
  const [data, setData] = useState<PlaceCandidatesResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (photoId === null) {
      setData(null);
      setError(null);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setData(null);

    void fetch(`${API_URL}/places/candidates?photoId=${photoId}`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(await response.text());
        return (await response.json()) as PlaceCandidatesResult;
      })
      .then((result) => setData(result))
      .catch((cause) => {
        if (controller.signal.aborted) return;
        setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [photoId]);

  return { data, loading, error };
}
