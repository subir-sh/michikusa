'use client';

import { useCallback, useEffect, useState } from 'react';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

interface Photo {
  id: number;
  capturedAt: string;
  latitude: number | null;
  longitude: number | null;
}

interface TimelinePanelProps {
  selectedDate: string;
}

function formatTime(value: string) {
  return new Date(value).toLocaleTimeString('ko-KR', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

export function TimelinePanel({ selectedDate }: TimelinePanelProps) {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  useEffect(() => {
    void loadPhotos();
  }, [loadPhotos]);

  useEffect(() => {
    const handleImported = () => void loadPhotos();
    window.addEventListener('michikusa:photos-imported', handleImported);
    return () => window.removeEventListener('michikusa:photos-imported', handleImported);
  }, [loadPhotos]);

  return (
    <section className="panel timeline-panel">
      <div className="timeline-header">
        <div>
          <h2>Day Timeline</h2>
          <p>{selectedDate ? `${selectedDate} · ${photos.length}장` : '날짜를 선택한다.'}</p>
        </div>
      </div>

      {!selectedDate && <p className="timeline-empty">표시할 날짜가 없음</p>}
      {selectedDate && !loading && photos.length === 0 && (
        <p className="timeline-empty">이 날짜에는 사진이 없음</p>
      )}

      {photos.length > 0 && (
        <ol className="timeline-list">
          {photos.map((photo) => {
            const hasGps = photo.latitude !== null && photo.longitude !== null;

            return (
              <li key={photo.id} className="timeline-item">
                <div className="timeline-time">{formatTime(photo.capturedAt)}</div>
                <img
                  src={`${API_URL}/photos/${photo.id}/preview`}
                  alt={`${formatTime(photo.capturedAt)} 사진`}
                  loading="lazy"
                />
                <div className="timeline-meta">
                  <span>{hasGps ? 'GPS 있음' : 'GPS 없음'}</span>
                  {hasGps && (
                    <small>
                      {photo.latitude?.toFixed(5)}, {photo.longitude?.toFixed(5)}
                    </small>
                  )}
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
