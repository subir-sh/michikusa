'use client';

import type { PlaceCandidatesResult } from './use-place-candidates';

interface ReviewPanelProps {
  selectedPhotoId: number | null;
  data: PlaceCandidatesResult | null;
  loading: boolean;
  confirming: boolean;
  unassigning: boolean;
  error: string | null;
  onUnassign: () => Promise<void>;
}

export function ReviewPanel({
  selectedPhotoId,
  data,
  loading,
  confirming,
  unassigning,
  error,
  onUnassign,
}: ReviewPanelProps) {
  const busy = confirming || unassigning;

  return (
    <section className="panel review-panel">
      <h2>POI Review</h2>

      {selectedPhotoId === null && (
        <p>타임라인에서 `POI 후보` 또는 `수정`을 누른다.</p>
      )}

      {selectedPhotoId !== null && loading && <p>Google Places 조회 중…</p>}
      {selectedPhotoId !== null && confirming && <p>Place / Visit 저장 중…</p>}
      {selectedPhotoId !== null && unassigning && <p>확정 해제 중…</p>}

      {selectedPhotoId !== null && error && (
        <p className="import-error">{error}</p>
      )}

      {data && !loading && !error && (
        <div className="review-summary">
          <p>
            사진 #{data.photo.id} · {data.photo.category ?? '미분류'}
          </p>

          {data.assignment && (
            <div className="review-assignment">
              <strong>
                Visit #{data.assignment.visitId} · Place #{data.assignment.placeId}
              </strong>
              <p>현재 장소가 확정되어 있음</p>
              <button
                type="button"
                onClick={() => void onUnassign()}
                disabled={busy}
              >
                확정 해제
              </button>
            </div>
          )}

          {data.eligible ? (
            <>
              <strong>후보 {data.candidates.length}개</strong>
              <p>탐색 반경 {data.radius}m</p>
              <p>
                지도에서 주황색 후보를 누른다. 이미 확정된 사진이라면 다른 후보를
                선택해 바로 변경할 수 있다.
              </p>
            </>
          ) : (
            <p>{data.reason ?? '이 사진은 현재 POI 조회 대상이 아니다.'}</p>
          )}
        </div>
      )}
    </section>
  );
}
