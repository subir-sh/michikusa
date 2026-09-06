import { ImportPanel } from '../features/import/import-panel';
import { MapPanel } from '../features/map/map-panel';
import { ReviewPanel } from '../features/review/review-panel';
import { TimelinePanel } from '../features/timeline/timeline-panel';

export default function Home() {
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
        <MapPanel />
        <aside className="sidebar">
          <ImportPanel />
          <TimelinePanel />
          <ReviewPanel />
        </aside>
      </section>
    </main>
  );
}
