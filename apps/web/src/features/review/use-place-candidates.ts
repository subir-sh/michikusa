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

export interface VisitAssignment {
  visitId: number;
  placeId: number;
  googlePlaceId: string;
}

export interface PlaceCandidatesResult {
  photo: {
    id: number;
    category: string | null;
    latitude: number | null;
    longitude: number | null;
    visitId: number | null;
  };
  assignment: VisitAssignment | null;
  eligible: boolean;
  reason?: string;
  radius: number | null;
  candidates: PlaceCandidate[];
}

export interface ConfirmPlaceResult {
  photoId: number;
  placeId: number;
  visitId: number;
  googlePlaceId: string;
  createdPlace: boolean;
  createdVisit: boolean;
  replaced: boolean;
  previousVisitId: number | null;
  visitMergeWindowHours: number;
}

export interface UnassignPlaceResult {
  photoId: number;
  previousVisitId: number | null;
  previousPlaceId: number | null;
  deletedVisit: boolean;
  deletedPlace: boolean;
}

export function usePlaceCandidates(photoId: number | null) {
  const [data, setData] = useState<PlaceCandidatesResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [unassigning, setUnassigning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (photoId === null) {
      setData(null);
      setError(null);
      setLoading(false);
      setConfirming(false);
      setUnassigning(false);
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

  async function confirm(googlePlaceId: string): Promise<ConfirmPlaceResult> {
    if (photoId === null) throw new Error('No photo selected');

    setConfirming(true);
    setError(null);

    try {
      const response = await fetch(`${API_URL}/places/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ photoId, googlePlaceId }),
      });
      if (!response.ok) throw new Error(await response.text());

      const result = (await response.json()) as ConfirmPlaceResult;
      window.dispatchEvent(
        new CustomEvent('michikusa:place-changed', { detail: result }),
      );
      return result;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setError(message);
      throw cause;
    } finally {
      setConfirming(false);
    }
  }

  async function unassign(): Promise<UnassignPlaceResult> {
    if (photoId === null) throw new Error('No photo selected');

    setUnassigning(true);
    setError(null);

    try {
      const response = await fetch(`${API_URL}/places/unassign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ photoId }),
      });
      if (!response.ok) throw new Error(await response.text());

      const result = (await response.json()) as UnassignPlaceResult;
      setData((current) =>
        current
          ? {
              ...current,
              photo: { ...current.photo, visitId: null },
              assignment: null,
            }
          : current,
      );
      window.dispatchEvent(
        new CustomEvent('michikusa:place-changed', { detail: result }),
      );
      return result;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setError(message);
      throw cause;
    } finally {
      setUnassigning(false);
    }
  }

  return {
    data,
    loading,
    confirming,
    unassigning,
    error,
    confirm,
    unassign,
  };
}
