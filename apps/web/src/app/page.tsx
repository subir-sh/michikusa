'use client';

import { useState } from 'react';
import { DiagnosticsPanel } from '../features/diagnostics/diagnostics-panel';
import { ImportPanel } from '../features/import/import-panel';
import { MapPanel } from '../features/map/map-panel';
import { PeriodMapPanel } from '../features/map/period-map-panel';
import { ReviewPanel } from '../features/review/review-panel';
import { usePlaceCandidates } from '../features/review/use-place-candidates';
import { useReviewQueue } from '../features/review/use-review-queue';
import { TimelinePanel } from '../features/timeline/timeline-panel';

export default function Home() {
  const [selectedDate, setSelectedDate] = useState('');
  const [selectedPhotoId, setSelectedPhotoId] = useState<number | null>(null);
  const placeCandidates = usePlaceCandidates(selectedPhotoId);
  const reviewQueue = useReviewQueue(selectedDate);

  function handleDateChange(date: string) {
    setSelectedDate(date);
    setSelectedPhotoId(null);
  }

  function handleNextUnresolved() {
    setSelectedPhotoId(reviewQueue.nextAfter(selectedPhotoId));
  }

  async function handleConfirmPlace(googlePlaceId: string) {
    const nextPhotoId = reviewQueue.nextAfter(selectedPhotoId);
    await placeCandidates.confirm(googlePlaceId);
    setSelectedPhotoId(nextPhotoId);
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
        <div className="main-column">
          <MapPanel
            selectedDate={selectedDate}
            onSelectedDateChange={handleDateChange}
            selectedPhotoId={selectedPhotoId}
            placeCandidates={placeCandidates.data?.candidates ?? []}
            hasAssignment={placeCandidates.data?.assignment !== null}
            onConfirmPlace={handleConfirmPlace}
          />
          <PeriodMapPanel />
        </div>
        <aside className="sidebar">
          <ImportPanel />
          <DiagnosticsPanel />
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
            unresolvedCount={reviewQueue.unresolvedCount}
            queueLoading={reviewQueue.loading}
            onNextUnresolved={handleNextUnresolved}
            onUnassign={handleUnassignPlace}
          />
        </aside>
      </section>
    </main>
  );
}
