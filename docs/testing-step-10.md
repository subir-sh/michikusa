## Step 10 — Review Queue

현재 날짜에서 `위치 있음 + 장소 관련 category + visitId 없음`인 사진을 별도 상태 컬럼 없이 미확정 queue로 계산한다.

### 테스트

1. SigLIP2 분류와 GPS 보정까지 끝낸 날짜를 연다.
2. `POI Review`의 `미확정 N장` 수를 확인한다.
3. `다음 미확정`을 누르면 처리할 사진이 선택되는지 확인한다.
4. 지도 후보에서 장소를 확정하면 해당 사진이 queue에서 빠지고 다음 미확정 사진으로 자동 이동하는지 확인한다.
5. 장소 확정을 해제하면 해당 사진이 다시 미확정 queue로 들어오는지 확인한다.
6. SigLIP2 분류나 GPS 추정을 새로 실행했을 때 queue 수가 즉시 갱신되는지 확인한다.

별도 Review entity나 processing state는 만들지 않는다.
