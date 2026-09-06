## Step 11 — Month / Year Period Map

확정된 Visit을 월/연 단위로 Place별 집계해서 본다. Day Map처럼 경로를 그리지 않는다.

### 표시

- Place별 marker
- marker 크기: 해당 기간의 Visit 수가 많을수록 커짐
- 상단 요약: Place 수 / Visit 수 / 사진 수
- marker 클릭: Place ID, category, 방문 수, 사진 수, 첫/마지막 방문일

### 테스트

1. 서로 다른 날짜에 Place / Visit을 여러 개 확정한다.
2. `Period Map`에서 `Month`를 선택하고 해당 월을 고른다.
3. 그 달에 확정한 Place만 보이는지 확인한다.
4. 같은 Place를 여러 번 방문한 경우 marker가 더 크게 보이고 `방문 N회`가 맞는지 확인한다.
5. `Year`로 바꿔 같은 해의 여러 달 Visit이 합쳐지는지 확인한다.
6. Day Map의 직선 경로가 Period Map에는 나타나지 않는지 확인한다.
7. Place 확정을 해제/변경하면 Period Map 집계가 바로 갱신되는지 확인한다.

Month / Year용 별도 entity는 만들지 않고 `Visit + Photo + Place`를 SQL로 집계한다.
