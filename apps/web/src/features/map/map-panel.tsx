'use client';

import { importLibrary, setOptions } from '@googlemaps/js-api-loader';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
const MAPS_API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? '';

let mapsConfigured = false;

interface Photo {
  id: number;
  capturedAt: string;
  latitude: number | null;
  longitude: number | null;
}

interface PhotoDateCount {
  date: string;
  count: number;
}

function configureMaps() {
  if (!MAPS_API_KEY || mapsConfigured) return;

  setOptions({
    key: MAPS_API_KEY,
    v: 'weekly',
    language: 'ko',
    region: 'KR',
  });
  mapsConfigured = true;
}

export function MapPanel() {
  const mapElement = useRef<HTMLDivElement>(null);
  const [dates, setDates] = useState<PhotoDateCount[]>([]);
  const [selectedDate, setSelectedDate] = useState('');
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const gpsPhotos = useMemo(
    () =>
      photos.filter(
        (photo): photo is Photo & { latitude: number; longitude: number } =>
          photo.latitude !== null && photo.longitude !== null,
      ),
    [photos],
  );

  const loadDates = useCallback(async () => {
    const response = await fetch(`${API_URL}/photos/dates`);
    if (!response.ok) throw new Error(await response.text());

    const nextDates = (await response.json()) as PhotoDateCount[];
    setDates(nextDates);
    setSelectedDate((current) => {
      if (current && nextDates.some((item) => item.date === current)) return current;
      return nextDates[0]?.date ?? '';
    });
  }, []);

  const loadPhotos = useCallback(async (date: string) => {
    if (!date) {
      setPhotos([]);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await fetch(
        `${API_URL}/photos?date=${encodeURIComponent(date)}`,
      );
      if (!response.ok) throw new Error(await response.text());
      setPhotos((await response.json()) as Photo[]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      await loadDates();
      if (selectedDate) await loadPhotos(selectedDate);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [loadDates, loadPhotos, selectedDate]);

  useEffect(() => {
    void loadDates().catch((cause) => {
      setError(cause instanceof Error ? cause.message : String(cause));
    });
  }, [loadDates]);

  useEffect(() => {
    void loadPhotos(selectedDate);
  }, [loadPhotos, selectedDate]);

  useEffect(() => {
    const handleImported = () => void refresh();
    window.addEventListener('michikusa:photos-imported', handleImported);
    return () => window.removeEventListener('michikusa:photos-imported', handleImported);
  }, [refresh]);

  useEffect(() => {
    if (!MAPS_API_KEY || !mapElement.current || gpsPhotos.length === 0) return;

    let cancelled = false;
    let clickListener: google.maps.MapsEventListener | undefined;

    async function renderMap() {
      configureMaps();
      await importLibrary('maps');

      if (cancelled || !mapElement.current) return;

      const first = gpsPhotos[0];
      const map = new google.maps.Map(mapElement.current, {
        center: { lat: first.latitude, lng: first.longitude },
        zoom: 14,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false,
      });

      const bounds = new google.maps.LatLngBounds();
      const infoWindow = new google.maps.InfoWindow();

      for (const photo of gpsPhotos) {
        const position = { lat: photo.latitude, lng: photo.longitude };
        bounds.extend(position);

        const feature = new google.maps.Data.Feature({
          id: photo.id,
          geometry: new google.maps.Data.Point(position),
        });
        feature.setProperty('photo', photo);
        map.data.add(feature);
      }

      map.data.setStyle({
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 6,
          fillColor: '#2563eb',
          fillOpacity: 0.9,
          strokeColor: '#ffffff',
          strokeWeight: 1.5,
        },
      });

      clickListener = map.data.addListener('click', (event) => {
        const photo = event.feature.getProperty('photo') as Photo;
        const content = document.createElement('div');
        content.className = 'map-info';

        const image = document.createElement('img');
        image.src = `${API_URL}/photos/${photo.id}/preview`;
        image.alt = '사진 미리보기';

        const time = document.createElement('p');
        time.textContent = new Date(photo.capturedAt).toLocaleString('ko-KR');

        content.append(image, time);
        infoWindow.setContent(content);
        if (event.latLng) infoWindow.setPosition(event.latLng);
        infoWindow.open({ map });
      });

      if (gpsPhotos.length === 1) {
        map.setCenter(bounds.getCenter());
        map.setZoom(16);
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
  }, [gpsPhotos]);

  return (
    <section className="panel map-panel">
      <div className="panel-header">
        <div>
          <h2>Raw GPS Map</h2>
          <p>
            {selectedDate
              ? `${selectedDate} · GPS ${gpsPhotos.length} / 전체 ${photos.length}`
              : 'GPS가 있는 사진을 가져오면 날짜별로 표시한다.'}
          </p>
        </div>
        <div className="map-controls">
          <select
            value={selectedDate}
            onChange={(event) => setSelectedDate(event.target.value)}
            disabled={dates.length === 0}
            aria-label="날짜 선택"
          >
            {dates.length === 0 && <option value="">날짜 없음</option>}
            {dates.map((item) => (
              <option key={item.date} value={item.date}>
                {item.date} ({item.count})
              </option>
            ))}
          </select>
          <button type="button" onClick={() => void refresh()} disabled={loading}>
            새로고침
          </button>
        </div>
      </div>

      <div className="map-frame">
        <div ref={mapElement} className="map-canvas" />
        {!MAPS_API_KEY && (
          <div className="map-empty">
            <strong>Google Maps API key가 필요함</strong>
            <span>apps/web/.env.local에 NEXT_PUBLIC_GOOGLE_MAPS_API_KEY를 설정한다.</span>
          </div>
        )}
        {MAPS_API_KEY && !loading && gpsPhotos.length === 0 && (
          <div className="map-empty">
            <strong>표시할 GPS 사진이 없음</strong>
            <span>사진을 가져오거나 다른 날짜를 선택한다.</span>
          </div>
        )}
      </div>

      {loading && <p className="map-status">불러오는 중…</p>}
      {error && <p className="import-error">{error}</p>}
    </section>
  );
}
