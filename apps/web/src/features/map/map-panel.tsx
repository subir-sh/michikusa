'use client';

import { importLibrary, setOptions } from '@googlemaps/js-api-loader';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PlaceCandidate } from '../review/use-place-candidates';

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
  gpsCount: number;
}

interface MapPanelProps {
  selectedDate: string;
  onSelectedDateChange: (date: string) => void;
  selectedPhotoId: number | null;
  placeCandidates: PlaceCandidate[];
  onConfirmPlace: (googlePlaceId: string) => Promise<void>;
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

export function MapPanel({
  selectedDate,
  onSelectedDateChange,
  selectedPhotoId,
  placeCandidates,
  onConfirmPlace,
}: MapPanelProps) {
  const mapElement = useRef<HTMLDivElement>(null);
  const [dates, setDates] = useState<PhotoDateCount[]>([]);
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

    if (!selectedDate || !nextDates.some((item) => item.date === selectedDate)) {
      onSelectedDateChange(nextDates[0]?.date ?? '');
    }
  }, [onSelectedDateChange, selectedDate]);

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
    const handleConfirmed = () => void refresh();
    window.addEventListener('michikusa:photos-imported', handleImported);
    window.addEventListener('michikusa:place-confirmed', handleConfirmed);
    return () => {
      window.removeEventListener('michikusa:photos-imported', handleImported);
      window.removeEventListener('michikusa:place-confirmed', handleConfirmed);
    };
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

      const allBounds = new google.maps.LatLngBounds();
      const infoWindow = new google.maps.InfoWindow();

      for (const photo of gpsPhotos) {
        const position = { lat: photo.latitude, lng: photo.longitude };
        allBounds.extend(position);

        const feature = new google.maps.Data.Feature({
          id: photo.id,
          geometry: new google.maps.Data.Point(position),
        });
        feature.setProperty('kind', 'photo');
        feature.setProperty('photo', photo);
        feature.setProperty('selected', photo.id === selectedPhotoId);
        map.data.add(feature);
      }

      for (const candidate of placeCandidates) {
        const feature = new google.maps.Data.Feature({
          id: `candidate:${candidate.placeId}`,
          geometry: new google.maps.Data.Point({
            lat: candidate.latitude,
            lng: candidate.longitude,
          }),
        });
        feature.setProperty('kind', 'candidate');
        feature.setProperty('candidate', candidate);
        map.data.add(feature);
      }

      map.data.setStyle((feature) => {
        const kind = feature.getProperty('kind') as string;
        const selected = feature.getProperty('selected') === true;

        if (kind === 'candidate') {
          return {
            icon: {
              path: google.maps.SymbolPath.CIRCLE,
              scale: 8,
              fillColor: '#f59e0b',
              fillOpacity: 0.95,
              strokeColor: '#ffffff',
              strokeWeight: 2,
            },
          };
        }

        return {
          icon: {
            path: google.maps.SymbolPath.CIRCLE,
            scale: selected ? 8 : 6,
            fillColor: selected ? '#dc2626' : '#2563eb',
            fillOpacity: 0.9,
            strokeColor: '#ffffff',
            strokeWeight: selected ? 2 : 1.5,
          },
        };
      });

      clickListener = map.data.addListener('click', (event) => {
        const kind = event.feature.getProperty('kind') as string;
        const content = document.createElement('div');
        content.className = 'map-info';

        if (kind === 'candidate') {
          const candidate = event.feature.getProperty(
            'candidate',
          ) as PlaceCandidate;
          const title = document.createElement('strong');
          title.textContent = candidate.name;

          const detail = document.createElement('p');
          const type = candidate.primaryType ?? 'place';
          detail.textContent = `${type} · ${candidate.distanceMeters}m · score ${candidate.score.toFixed(3)}`;

          content.append(title, detail);
          if (candidate.formattedAddress) {
            const address = document.createElement('p');
            address.textContent = candidate.formattedAddress;
            content.append(address);
          }

          const confirmButton = document.createElement('button');
          confirmButton.type = 'button';
          confirmButton.className = 'map-confirm-button';
          confirmButton.textContent = '이 장소로 확정';
          confirmButton.addEventListener('click', async () => {
            confirmButton.disabled = true;
            confirmButton.textContent = '저장 중…';
            try {
              await onConfirmPlace(candidate.placeId);
              infoWindow.close();
            } catch {
              confirmButton.disabled = false;
              confirmButton.textContent = '다시 시도';
            }
          });
          content.append(confirmButton);
        } else {
          const photo = event.feature.getProperty('photo') as Photo;
          const image = document.createElement('img');
          image.src = `${API_URL}/photos/${photo.id}/preview`;
          image.alt = '사진 미리보기';

          const time = document.createElement('p');
          time.textContent = new Date(photo.capturedAt).toLocaleString('ko-KR');
          content.append(image, time);
        }

        infoWindow.setContent(content);
        if (event.latLng) infoWindow.setPosition(event.latLng);
        infoWindow.open({ map });
      });

      if (placeCandidates.length > 0 && selectedPhotoId !== null) {
        const focusBounds = new google.maps.LatLngBounds();
        const selectedPhoto = gpsPhotos.find(
          (photo) => photo.id === selectedPhotoId,
        );
        if (selectedPhoto) {
          focusBounds.extend({
            lat: selectedPhoto.latitude,
            lng: selectedPhoto.longitude,
          });
        }
        for (const candidate of placeCandidates) {
          focusBounds.extend({ lat: candidate.latitude, lng: candidate.longitude });
        }
        map.fitBounds(focusBounds, 72);
      } else if (gpsPhotos.length === 1) {
        map.setCenter(allBounds.getCenter());
        map.setZoom(16);
      } else {
        map.fitBounds(allBounds, 48);
      }
    }

    void renderMap().catch((cause) => {
      setError(cause instanceof Error ? cause.message : String(cause));
    });

    return () => {
      cancelled = true;
      clickListener?.remove();
    };
  }, [gpsPhotos, onConfirmPlace, placeCandidates, selectedPhotoId]);

  return (
    <section className="panel map-panel">
      <div className="panel-header">
        <div>
          <h2>Raw GPS Map</h2>
          <p>
            {selectedDate
              ? `${selectedDate} · GPS ${gpsPhotos.length} / 전체 ${photos.length}${placeCandidates.length > 0 ? ` · POI 후보 ${placeCandidates.length}` : ''}`
              : '사진을 가져오면 날짜별로 표시한다.'}
          </p>
        </div>
        <div className="map-controls">
          <select
            value={selectedDate}
            onChange={(event) => onSelectedDateChange(event.target.value)}
            disabled={dates.length === 0}
            aria-label="날짜 선택"
          >
            {dates.length === 0 && <option value="">날짜 없음</option>}
            {dates.map((item) => (
              <option key={item.date} value={item.date}>
                {item.date} ({item.gpsCount}/{item.count})
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
            <strong>이 날짜에는 GPS 사진이 없음</strong>
            <span>타임라인에서는 GPS 없는 사진도 확인할 수 있다.</span>
          </div>
        )}
      </div>

      {loading && <p className="map-status">불러오는 중…</p>}
      {error && <p className="import-error">{error}</p>}
    </section>
  );
}
