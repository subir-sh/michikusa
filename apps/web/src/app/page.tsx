'use client';

import { useState } from 'react';
import { ImportPanel } from '../features/import/import-panel';
import { MapPanel } from '../features/map/map-panel';
import { ReviewPanel } from '../features/review/review-panel';
import { usePlaceCandidates } from '../features/review/use-place-candidates';
import { TimelinePanel } from '../features/timeline/timeline-panel';

export default function Home() {
  const [selectedDate, setSelectedDate] = useState('');
  const [selectedPhotoId, setSelectedPhotoId] = useState<number | null>(null);
  const placeCandidates = usePlaceCandidates(selectedPhotoId);

  function handleDateChange(date: string) {
    setSelectedDate(date);
    setSelectedPhotoId(null);
  }

  async function handleConfirmPlace(googlePlaceId: string) {
    await placeCandidates.confirm(googlePlaceId);
    setSelectedPhotoId(null);
  }

  async function handleUnassignPlace() {
    await placeCandidates.unassign();
  }

  return (
    <main className="page">
      <header className="header">
        <div>
          <p className="eyebrow">道草</p>
          <h1>Michikusa</h1>
        </div>
        <p className="subtitle">사진으로 과거의 장소와 하루의 경로를 다시 본다.</p>
      </header>

      <section className="workspace">
        <MapPanel
          selectedDate={selectedDate}
          onSelectedDateChange={handleDateChange}
          selectedPhotoId={selectedPhotoId}
          placeCandidates={placeCandidates.data?.candidates ?? []}
          hasAssignment={placeCandidates.data?.assignment !== null}
          onConfirmPlace={handleConfirmPlace}
        />
        <aside className="sidebar">
          <ImportPanel />
          <TimelinePanel
            selectedDate={selectedDate}
            selectedPhotoId={selectedPhotoId}
            onSelectedPhotoChange={setSelectedPhotoId}
          />
          <ReviewPanel
            selectedPhotoId={selectedPhotoId}
            data={placeCandidates.data}
            loading={placeCandidates.loading}
            confirming={placeCandidates.confirming}
            unassigning={placeCandidates.unassigning}
            error={placeCandidates.error}
            onUnassign={handleUnassignPlace}
          />
        </aside>
      </section>
    </main>
  );
}
