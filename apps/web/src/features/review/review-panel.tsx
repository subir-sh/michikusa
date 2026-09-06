'use client';

import type { PlaceCandidatesResult } from './use-place-candidates';

interface ReviewPanelProps {
  selectedPhotoId: number | null;
  data: PlaceCandidatesResult | null;
  loading: boolean;
  confirming: boolean;
  error: string | null;
}

export function ReviewPanel({
  selectedPhotoId,
  data,
  loading,
  confirming,
  error,
}: ReviewPanelProps) {
  return (
    <section className="panel review-panel">
      <h2>POI 후보</h2>

      {selectedPhotoId === null && (
        <p>타임라인에서 장소 관련 사진의 `POI 후보`를 누른다.</p>
      )}

      {selectedPhotoId !== null && loading && <p>Google Places 조회 중…</p>}
      {selectedPhotoId !== null && confirming && <p>Place / Visit 저장 중…</p>}

      {selectedPhotoId !== null && error && (
        <p className="import-error">{error}</p>
      )}

      {data && !loading && !error && (
        <div className="review-summary">
          <p>
            사진 #{data.photo.id} · {data.photo.category ?? '미분류'}
          </p>
          {data.eligible ? (
            <>
              <strong>후보 {data.candidates.length}개</strong>
              <p>탐색 반경 {data.radius}m</p>
              <p>지도에서 주황색 후보를 누르고 `이 장소로 확정`을 선택한다.</p>
            </>
          ) : (
            <p>{data.reason ?? '이 사진은 현재 POI 조회 대상이 아니다.'}</p>
          )}
        </div>
      )}
    </section>
  );
}
