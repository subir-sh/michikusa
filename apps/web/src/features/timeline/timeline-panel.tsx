'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

const CATEGORY_LABELS: Record<string, string> = {
  food: '음식',
  restaurant: '식당/카페',
  landmark: '관광지/랜드마크',
  accommodation: '숙소',
  transit: '교통',
  nature: '자연/공원',
  street: '거리/도시',
  people: '사람',
  screenshot: '스크린샷/문서',
  other: '기타',
};

const POI_ELIGIBLE_CATEGORIES = new Set([
  'food',
  'restaurant',
  'landmark',
  'accommodation',
  'transit',
  'nature',
  'street',
]);

interface Photo {
  id: number;
  capturedAt: string;
  latitude: number | null;
  longitude: number | null;
  locationInferred: boolean;
  category: string | null;
  visitId: number | null;
}

interface ClassificationResult {
  requested: number;
  classified: number;
  device: 'cpu' | 'cuda' | null;
  failed: Array<{ id: number; error: string }>;
}

interface LocationInferenceResult {
  attempted: number;
  inferred: number;
  skipped: number;
  maxGapMinutes: number;
  maxAnchorDistanceMeters: number;
}

interface ClearInferredLocationsResult {
  cleared: number;
  blocked: number;
}

interface TimelinePanelProps {
  selectedDate: string;
  selectedPhotoId: number | null;
  onSelectedPhotoChange: (photoId: number | null) => void;
}

function formatTime(value: string) {
  return new Date(value).toLocaleTimeString('ko-KR', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

export function TimelinePanel({
  selectedDate,
  selectedPhotoId,
  onSelectedPhotoChange,
}: TimelinePanelProps) {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [loading, setLoading] = useState(false);
  const [classifying, setClassifying] = useState(false);
  const [inferring, setInferring] = useState(false);
  const [clearingInferred, setClearingInferred] = useState(false);
  const [classificationResult, setClassificationResult] =
    useState<ClassificationResult | null>(null);
  const [locationResult, setLocationResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const unclassifiedCount = useMemo(
    () => photos.filter((photo) => photo.category === null).length,
    [photos],
  );
  const missingLocationCount = useMemo(
    () =>
      photos.filter(
        (photo) => photo.latitude === null || photo.longitude === null,
      ).length,
    [photos],
  );
  const inferredLocationCount = useMemo(
    () => photos.filter((photo) => photo.locationInferred).length,
    [photos],
  );

  const loadPhotos = useCallback(async () => {
    if (!selectedDate) {
      setPhotos([]);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await fetch(
        `${API_URL}/photos?date=${encodeURIComponent(selectedDate)}`,
      );
      if (!response.ok) throw new Error(await response.text());
      setPhotos((await response.json()) as Photo[]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, [selectedDate]);

  const classifySelectedDate = useCallback(async () => {
    if (!selectedDate || unclassifiedCount === 0) return;

    setClassifying(true);
    setError(null);
    setClassificationResult(null);

    try {
      const response = await fetch(`${API_URL}/photos/classify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: selectedDate, limit: 200 }),
      });

      if (!response.ok) throw new Error(await response.text());

      const result = (await response.json()) as ClassificationResult;
      setClassificationResult(result);
      await loadPhotos();
      window.dispatchEvent(new Event('michikusa:classification-changed'));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setClassifying(false);
    }
  }, [loadPhotos, selectedDate, unclassifiedCount]);

  const inferLocations = useCallback(async () => {
    if (!selectedDate || missingLocationCount === 0) return;

    setInferring(true);
    setError(null);
    setLocationResult(null);

    try {
      const response = await fetch(`${API_URL}/photos/infer-locations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: selectedDate }),
      });
      if (!response.ok) throw new Error(await response.text());

      const result = (await response.json()) as LocationInferenceResult;
      setLocationResult(
        `GPS 추정 ${result.inferred}/${result.attempted} · anchor ${result.maxGapMinutes}분 / ${result.maxAnchorDistanceMeters}m`,
      );
      onSelectedPhotoChange(null);
      await loadPhotos();
      window.dispatchEvent(new Event('michikusa:locations-changed'));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setInferring(false);
    }
  }, [loadPhotos, missingLocationCount, onSelectedPhotoChange, selectedDate]);

  const clearInferredLocations = useCallback(async () => {
    if (!selectedDate || inferredLocationCount === 0) return;

    setClearingInferred(true);
    setError(null);
    setLocationResult(null);

    try {
      const response = await fetch(`${API_URL}/photos/clear-inferred-locations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: selectedDate }),
      });
      if (!response.ok) throw new Error(await response.text());

      const result = (await response.json()) as ClearInferredLocationsResult;
      setLocationResult(
        `추정 GPS 초기화 ${result.cleared}장${result.blocked > 0 ? ` · Visit 연결로 유지 ${result.blocked}장` : ''}`,
      );
      onSelectedPhotoChange(null);
      await loadPhotos();
      window.dispatchEvent(new Event('michikusa:locations-changed'));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setClearingInferred(false);
    }
  }, [inferredLocationCount, loadPhotos, onSelectedPhotoChange, selectedDate]);

  useEffect(() => {
    setClassificationResult(null);
    setLocationResult(null);
    onSelectedPhotoChange(null);
    void loadPhotos();
  }, [loadPhotos, onSelectedPhotoChange]);

  useEffect(() => {
    const handleImported = () => void loadPhotos();
    const handlePlaceChanged = () => void loadPhotos();
    const handleLocationsChanged = () => void loadPhotos();
    window.addEventListener('michikusa:photos-imported', handleImported);
    window.addEventListener('michikusa:place-changed', handlePlaceChanged);
    window.addEventListener('michikusa:locations-changed', handleLocationsChanged);
    return () => {
      window.removeEventListener('michikusa:photos-imported', handleImported);
      window.removeEventListener('michikusa:place-changed', handlePlaceChanged);
      window.removeEventListener('michikusa:locations-changed', handleLocationsChanged);
    };
  }, [loadPhotos]);

  return (
    <section className="panel timeline-panel">
      <div className="timeline-header">
        <div className="timeline-title-row">
          <div>
            <h2>Day Timeline</h2>
            <p>
              {selectedDate
                ? `${selectedDate} · ${photos.length}장 · GPS 없음 ${missingLocationCount} · 추정 ${inferredLocationCount}`
                : '날짜를 선택한다.'}
            </p>
          </div>
          <div className="timeline-actions">
            <button
              type="button"
              onClick={() => void classifySelectedDate()}
              disabled={!selectedDate || unclassifiedCount === 0 || classifying}
            >
              {classifying ? '분류 중…' : 'SigLIP2'}
            </button>
            <button
              type="button"
              onClick={() => void inferLocations()}
              disabled={!selectedDate || missingLocationCount === 0 || inferring}
            >
              {inferring ? '추정 중…' : 'GPS 추정'}
            </button>
            <button
              type="button"
              onClick={() => void clearInferredLocations()}
              disabled={
                !selectedDate || inferredLocationCount === 0 || clearingInferred
              }
            >
              {clearingInferred ? '초기화 중…' : '추정 초기화'}
            </button>
          </div>
        </div>
        {classificationResult && (
          <p className="classification-result">
            분류 {classificationResult.classified}/{classificationResult.requested}
            {classificationResult.device
              ? ` · ${classificationResult.device.toUpperCase()}`
              : ''}
            {classificationResult.failed.length > 0
              ? ` · 실패 ${classificationResult.failed.length}`
              : ''}
          </p>
        )}
        {locationResult && <p className="classification-result">{locationResult}</p>}
      </div>

      {!selectedDate && <p className="timeline-empty">표시할 날짜가 없음</p>}
      {selectedDate && !loading && photos.length === 0 && (
        <p className="timeline-empty">이 날짜에는 사진이 없음</p>
      )}

      {photos.length > 0 && (
        <ol className="timeline-list">
          {photos.map((photo) => {
            const hasGps = photo.latitude !== null && photo.longitude !== null;
            const canReviewPoi =
              hasGps &&
              photo.category !== null &&
              POI_ELIGIBLE_CATEGORIES.has(photo.category);
            const selected = photo.id === selectedPhotoId;

            return (
              <li
                key={photo.id}
                className={`timeline-item${selected ? ' timeline-item-selected' : ''}`}
              >
                <div className="timeline-time">{formatTime(photo.capturedAt)}</div>
                <img
                  src={`${API_URL}/photos/${photo.id}/preview`}
                  alt={`${formatTime(photo.capturedAt)} 사진`}
                  loading="lazy"
                />
                <div className="timeline-meta">
                  <span>
                    {photo.category
                      ? CATEGORY_LABELS[photo.category] ?? photo.category
                      : '미분류'}
                  </span>
                  <small>
                    {photo.locationInferred
                      ? '추정 GPS'
                      : hasGps
                        ? 'GPS 있음'
                        : 'GPS 없음'}
                  </small>
                  {photo.visitId !== null && (
                    <small className="visit-badge">Visit #{photo.visitId}</small>
                  )}
                  <button
                    type="button"
                    className="poi-button"
                    disabled={!canReviewPoi}
                    onClick={() =>
                      onSelectedPhotoChange(selected ? null : photo.id)
                    }
                  >
                    {selected
                      ? '닫기'
                      : photo.visitId !== null
                        ? '수정'
                        : 'POI 후보'}
                  </button>
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {loading && <p className="map-status">불러오는 중…</p>}
      {error && <p className="import-error">{error}</p>}
    </section>
  );
}
