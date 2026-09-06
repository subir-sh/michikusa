'use client';

import { importLibrary, setOptions } from '@googlemaps/js-api-loader';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
const MAPS_API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? '';

let periodMapsConfigured = false;

type PeriodMode = 'month' | 'year';

interface PhotoDateCount {
  date: string;
}

interface PeriodPlaceSummary {
  placeId: number;
  latitude: number;
  longitude: number;
  category: string | null;
  visitCount: number;
  photoCount: number;
  firstVisitedAt: string;
  lastVisitedAt: string;
}

function configureMaps() {
  if (!MAPS_API_KEY || periodMapsConfigured) return;
  setOptions({
    key: MAPS_API_KEY,
    v: 'weekly',
    language: 'ko',
    region: 'KR',
  });
  periodMapsConfigured = true;
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString('ko-KR');
}

export function PeriodMapPanel() {
  const mapElement = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<PeriodMode>('month');
  const [dates, setDates] = useState<string[]>([]);
  const [period, setPeriod] = useState('');
  const [places, setPlaces] = useState<PeriodPlaceSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const periods = useMemo(() => {
    const values = dates.map((date) => (mode === 'month' ? date.slice(0, 7) : date.slice(0, 4)));
    return [...new Set(values)];
  }, [dates, mode]);

  const visitCount = useMemo(
    () => places.reduce((sum, place) => sum + place.visitCount, 0),
    [places],
  );
  const photoCount = useMemo(
    () => places.reduce((sum, place) => sum + place.photoCount, 0),
    [places],
  );

  const loadDates = useCallback(async () => {
    const response = await fetch(`${API_URL}/photos/dates`);
    if (!response.ok) throw new Error(await response.text());
    const rows = (await response.json()) as PhotoDateCount[];
    setDates(rows.map((row) => row.date));
  }, []);

  const loadSummary = useCallback(async () => {
    if (!period) {
      setPlaces([]);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const query = mode === 'month' ? `month=${period}` : `year=${period}`;
      const response = await fetch(`${API_URL}/visits/summary?${query}`);
      if (!response.ok) throw new Error(await response.text());
      setPlaces((await response.json()) as PeriodPlaceSummary[]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, [mode, period]);

  useEffect(() => {
    void loadDates().catch((cause) => {
      setError(cause instanceof Error ? cause.message : String(cause));
    });
  }, [loadDates]);

  useEffect(() => {
    if (!periods.includes(period)) {
      setPeriod(periods[0] ?? '');
    }
  }, [period, periods]);

  useEffect(() => {
    void loadSummary();
  }, [loadSummary]);

  useEffect(() => {
    const refresh = () => {
      void loadDates();
      void loadSummary();
    };
    window.addEventListener('michikusa:photos-imported', refresh);
    window.addEventListener('michikusa:place-changed', refresh);
    return () => {
      window.removeEventListener('michikusa:photos-imported', refresh);
      window.removeEventListener('michikusa:place-changed', refresh);
    };
  }, [loadDates, loadSummary]);

  useEffect(() => {
    if (!MAPS_API_KEY || !mapElement.current || places.length === 0) return;

    let cancelled = false;
    let clickListener: google.maps.MapsEventListener | undefined;

    async function renderMap() {
      configureMaps();
      await importLibrary('maps');
      if (cancelled || !mapElement.current) return;

      const first = places[0];
      const map = new google.maps.Map(mapElement.current, {
        center: { lat: first.latitude, lng: first.longitude },
        zoom: mode === 'month' ? 11 : 6,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false,
      });
      const bounds = new google.maps.LatLngBounds();
      const infoWindow = new google.maps.InfoWindow();

      for (const place of places) {
        const position = { lat: place.latitude, lng: place.longitude };
        bounds.extend(position);
        const feature = new google.maps.Data.Feature({
          id: `period-place:${place.placeId}`,
          geometry: new google.maps.Data.Point(position),
        });
        feature.setProperty('place', place);
        map.data.add(feature);
      }

      map.data.setStyle((feature) => {
        const place = feature.getProperty('place') as PeriodPlaceSummary;
        const scale = 6 + Math.min(12, Math.sqrt(place.visitCount) * 3);
        return {
          icon: {
            path: google.maps.SymbolPath.CIRCLE,
            scale,
            fillColor: '#111827',
            fillOpacity: 0.62,
            strokeColor: '#ffffff',
            strokeWeight: 1.5,
          },
        };
      });

      clickListener = map.data.addListener(
        'click',
        (event: google.maps.Data.MouseEvent) => {
          const place = event.feature.getProperty('place') as PeriodPlaceSummary;
          const content = document.createElement('div');
          content.className = 'map-info';

          const title = document.createElement('strong');
          title.textContent = `Place #${place.placeId}`;
          const counts = document.createElement('p');
          counts.textContent = `${place.category ?? 'place'} · 방문 ${place.visitCount}회 · 사진 ${place.photoCount}장`;
          const range = document.createElement('p');
          range.textContent = `${formatDate(place.firstVisitedAt)} ~ ${formatDate(place.lastVisitedAt)}`;
          content.append(title, counts, range);

          infoWindow.setContent(content);
          if (event.latLng) infoWindow.setPosition(event.latLng);
          infoWindow.open({ map });
        },
      );

      if (places.length === 1) {
        map.setCenter(bounds.getCenter());
        map.setZoom(mode === 'month' ? 15 : 12);
      } else {
        map.fitBounds(bounds, 48);
      }
    }

    void renderMap().catch((cause) => {
      setError(cause instanceof Error ? cause.message : String(cause));
    });

    return () => {
      cancelled = true;
      clickListener?.remove();
    };
  }, [mode, places]);

  return (
    <section className="panel period-map-panel">
      <div className="panel-header">
        <div>
          <h2>Period Map</h2>
          <p>
            {period
              ? `${period} · Place ${places.length}곳 · Visit ${visitCount}회 · 사진 ${photoCount}장`
              : '확정된 Visit을 월/연 단위로 본다.'}
          </p>
        </div>
        <div className="map-controls">
          <select
            value={mode}
            onChange={(event) => setMode(event.target.value as PeriodMode)}
            aria-label="기간 단위"
          >
            <option value="month">Month</option>
            <option value="year">Year</option>
          </select>
          <select
            value={period}
            onChange={(event) => setPeriod(event.target.value)}
            disabled={periods.length === 0}
            aria-label="기간 선택"
          >
            {periods.length === 0 && <option value="">기간 없음</option>}
            {periods.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="period-map-frame">
        <div ref={mapElement} className="map-canvas" />
        {!MAPS_API_KEY && (
          <div className="map-empty">
            <strong>Google Maps API key가 필요함</strong>
          </div>
        )}
        {MAPS_API_KEY && !loading && period && places.length === 0 && (
          <div className="map-empty">
            <strong>이 기간에는 확정된 Visit이 없음</strong>
            <span>Day Map에서 장소를 확정하면 여기에 집계된다.</span>
          </div>
        )}
      </div>

      {loading && <p className="map-status">집계 불러오는 중…</p>}
      {error && <p className="import-error">{error}</p>}
    </section>
  );
}
