'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

interface DiagnosticsData {
  photos: {
    total: number;
    originalGps: number;
    inferredGps: number;
    missingGps: number;
    classified: number;
    unclassified: number;
    confirmed: number;
    unresolvedPoi: number;
  };
  archive: {
    visits: number;
    places: number;
    days: number;
  };
  categories: Record<string, number>;
}

export function DiagnosticsPanel() {
  const [data, setData] = useState<DiagnosticsData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`${API_URL}/photos/diagnostics`);
      if (!response.ok) throw new Error(await response.text());
      setData((await response.json()) as DiagnosticsData);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, []);

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

  const categorySummary = useMemo(() => {
    if (!data) return '';
    return Object.entries(data.categories)
      .map(([category, count]) => `${category} ${count}`)
      .join(' · ');
  }, [data]);

  return (
    <section className="panel diagnostics-panel">
      <div className="diagnostics-header">
        <h2>Diagnostics</h2>
        <button type="button" onClick={() => void load()} disabled={loading}>
          새로고침
        </button>
      </div>

      {!data && !loading && !error && <p>아직 데이터가 없음</p>}
      {loading && !data && <p>집계 중…</p>}
      {error && <p className="import-error">{error}</p>}

      {data && (
        <>
          <div className="diagnostics-grid">
            <Metric label="사진" value={data.photos.total} />
            <Metric label="원본 GPS" value={data.photos.originalGps} />
            <Metric label="추정 GPS" value={data.photos.inferredGps} />
            <Metric label="GPS 없음" value={data.photos.missingGps} />
            <Metric label="분류 완료" value={data.photos.classified} />
            <Metric label="미분류" value={data.photos.unclassified} />
            <Metric label="미확정 POI" value={data.photos.unresolvedPoi} />
            <Metric label="확정 사진" value={data.photos.confirmed} />
            <Metric label="Visit" value={data.archive.visits} />
            <Metric label="Place" value={data.archive.places} />
            <Metric label="기록 날짜" value={data.archive.days} />
          </div>
          {categorySummary && <p className="diagnostics-categories">{categorySummary}</p>}
        </>
      )}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="diagnostics-metric">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}
