'use client';

import type { PlaceCandidatesResult } from './use-place-candidates';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

interface ReviewPanelProps {
  selectedPhotoId: number | null;
  data: PlaceCandidatesResult | null;
  loading: boolean;
  confirming: boolean;
  unassigning: boolean;
  error: string | null;
  unresolvedCount: number;
  queueLoading: boolean;
  onNextUnresolved: () => void;
  onUnassign: () => Promise<void>;
}

export function ReviewPanel({
  selectedPhotoId,
  data,
  loading,
  confirming,
  unassigning,
  error,
  unresolvedCount,
  queueLoading,
  onNextUnresolved,
  onUnassign,
}: ReviewPanelProps) {
  const busy = confirming || unassigning;

  return (
    <section className="panel review-panel">
      <div className="review-header">
        <div>
          <h2>POI Review</h2>
          <p>{queueLoading ? '미확정 계산 중…' : `미확정 ${unresolvedCount}장`}</p>
        </div>
        <button
          type="button"
          onClick={onNextUnresolved}
          disabled={queueLoading || unresolvedCount === 0 || busy}
        >
          다음 미확정
        </button>
      </div>

      {selectedPhotoId === null && unresolvedCount > 0 && (
        <p>다음 미확정을 누르거나 타임라인에서 사진을 선택한다.</p>
      )}
      {selectedPhotoId === null && !queueLoading && unresolvedCount === 0 && (
        <p>현재 날짜의 장소 관련 사진은 모두 처리됨.</p>
      )}

      {selectedPhotoId !== null && (
        <img
          className="review-photo"
          src={`${API_URL}/photos/${selectedPhotoId}/preview`}
          alt="선택한 사진"
        />
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
                지도에서 주황색 후보를 고른다. 확정하면 다음 미확정 사진으로 자동
                이동한다.
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
