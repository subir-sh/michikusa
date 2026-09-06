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
        <p className="subtitle">Photos, places, and the paths between them.</p>
      </header>

      <section className="workspace">
        <MapPanel />
        <aside className="sidebar">
          <TimelinePanel />
          <ReviewPanel />
        </aside>
      </section>
    </main>
  );
}
