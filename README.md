# Michikusa

사진을 기반으로 과거에 방문한 장소를 복원하고, 지도와 시간순 기록으로 다시 탐색하는 개인용 로컬 아카이브.

추천이나 SNS가 목적이 아니라 **언제 어디서 무엇을 했는지 오래 보존하고 다시 보는 것**이 목적이다.

## 핵심 경험

사진을 대량으로 가져오면:

1. 촬영 시간과 GPS를 읽는다.
2. 웹용 WebP preview를 만든다.
3. SigLIP2로 사진을 broad category로 분류한다.
4. GPS가 없는 일부 사진은 앞뒤 원본 GPS로 보수적으로 위치를 추정한다.
5. 주변 Google Places 후보를 조회한다.
6. 사용자가 실제 장소를 확정한다.
7. 같은 장소의 가까운 사진을 Visit으로 묶는다.
8. 하루의 Visit을 시간순 직선으로 연결한다.
9. 월/연 단위로 방문한 Place와 방문 밀도를 다시 본다.
10. 잘못 확정한 장소나 추정 위치는 언제든 수정한다.

실제 도보/대중교통 경로는 복원하지 않는다.

## 기술 스택

- Monorepo: pnpm workspace
- Web: Next.js
- Server: NestJS
- ORM: TypeORM
- Database: SQLite (`better-sqlite3`)
- Storage: local filesystem
- Vision: SigLIP2
- Map: Google Maps JavaScript API
- POI: Google Places API (New)
- AI fallback: Codex GUI

외부 배포를 전제로 하지 않는다. 서버, DB, preview 사진은 모두 로컬 PC에서 실행·보관한다.

## 구조

```text
apps/
├─ web/
│  └─ src/
│     ├─ app/
│     └─ features/
│        ├─ diagnostics/
│        ├─ import/
│        ├─ map/
│        ├─ review/
│        └─ timeline/
└─ server/
   ├─ scripts/
   │  └─ siglip_classify.py
   └─ src/
      ├─ photo/
      ├─ place/
      └─ visit/

data/                 # 로컬 전용, Git 제외

docs/                 # 단계별 실제 테스트 메모
```

feature-based structure를 사용한다. SigLIP2 inference만 작은 Python script로 분리하고 별도 Python 서버는 두지 않는다.

## 데이터 모델

### Photo

```text
id
hash
path
capturedAt
latitude?
longitude?
locationInferred
category?
visitId?
```

### Place

```text
id
latitude
longitude
category?
googlePlaceId
```

`Place.latitude / longitude`는 Google Places 좌표가 아니라 장소 확정에 사용한 사진의 resolved location이다.

Google Places 응답의 이름, 주소, 좌표, types는 SQLite에 영구 저장하지 않는다. `googlePlaceId`만 장기 식별자로 저장한다.

### Visit

```text
id
placeId
visitedAt
```

```text
Place 1 ── N Visit 1 ── N Photo
```

Day, Week, Month, Year, Review Queue는 별도 entity로 만들지 않는다. 필요할 때 기존 데이터에서 계산한다.

## 현재 구현

### Step 1 — 로컬 사진 가져오기

- 로컬 폴더 재귀 스캔
- JPEG / PNG / WebP / AVIF / HEIC / HEIF 지원
- SHA-256 중복 제거
- 촬영 시간 / GPS 추출
- 최대 1600px WebP preview 생성
- SQLite 저장

HEIC preview는 Windows 호환성을 위해 `heic-convert → sharp → WebP`로 처리한다.

### Step 2 — Raw GPS Map

- 날짜별 사진 수 / GPS 수 조회
- raw photo GPS point 표시
- marker 클릭 시 preview / 촬영 시각 표시

### Step 3 — Day Timeline

- 선택 날짜 사진을 촬영시간 순으로 표시
- thumbnail / GPS 상태 / category / Visit 상태 표시

### Step 4 — SigLIP2 분류

모델:

```text
google/siglip2-base-patch16-224
```

category:

```text
food
restaurant
landmark
accommodation
transit
nature
street
people
screenshot
other
```

별도 학습 없이 zero-shot classification을 사용한다. top category만 DB에 저장한다.

### Step 5 — POI 후보 조회

장소 관련 사진에 대해 Google Places Nearby Search (New)를 호출한다.

초기 탐색 반경:

```text
food / restaurant  120m
accommodation      250m
transit            300m
landmark           500m
nature             600m
street             120m
```

후보는 거리와 category/type 일치도로 정렬한다. Places 응답은 화면에서만 사용한다.

### Step 6 — Place 확정 + Visit

후보를 확정하면:

1. `googlePlaceId`로 Place를 생성하거나 재사용한다.
2. Photo에 `visitId`를 연결한다.
3. 같은 Place의 기존 Visit과 4시간 이내면 같은 Visit으로 묶는다.
4. 아니면 새 Visit을 만든다.

근처 사진을 자동으로 Visit에 넣지는 않는다. 직접 장소가 확정된 사진만 연결한다.

### Step 7 — 일별 Visit 경로

지도 표현:

- 파란 작은 점: 원본 GPS 사진
- 회색 작은 점: 추정 GPS 사진
- 검은 큰 점: 확정 Visit
- 검은 직선: Visit의 시간순 연결
- 주황 점: Google Places 후보
- 빨간 점: 현재 review 중인 사진

직선은 방문 순서만 보여준다. 실제 이동 경로가 아니다.

### Step 8 — Review / 장소 수정

확정된 사진도 다시 열어:

- 확정 해제
- 다른 후보로 변경

할 수 있다.

사진이 빠진 뒤 Visit이 비면 Visit을 삭제하고, 해당 Place에 Visit이 하나도 남지 않으면 Place도 삭제한다.

### Step 9 — Missing GPS 보정

GPS가 없는 사진을 무조건 채우지 않는다.

현재 조건:

```text
이전 원본 GPS 사진 존재
다음 원본 GPS 사진 존재
각 anchor와 90분 이내
두 anchor 좌표 거리 <= 300m
```

조건을 만족하면 촬영시각 비율로 좌표를 선형 보간한다.

- 원본 EXIF GPS만 anchor로 사용
- 추정 좌표를 다른 추정의 anchor로 재사용하지 않음
- 추정 좌표는 `locationInferred = true`
- 추정 초기화 가능

### Step 10 — Review Queue

현재 날짜에서 아래 조건을 만족하는 사진을 미확정 queue로 계산한다.

```text
위치 있음
+ 장소 관련 category
+ visitId 없음
```

별도 Review entity나 status는 없다.

- 미확정 사진 수 표시
- 다음 미확정으로 이동
- 장소 확정 후 자동으로 다음 사진 이동
- 분류 / GPS / 장소 변경 시 자동 갱신

상세 테스트: `docs/testing-step-10.md`

### Step 11 — Month / Year Period Map

확정 Visit을 월/연 단위로 Place별 집계한다.

- Place marker
- Visit 수가 많을수록 큰 marker
- Place / Visit / 사진 수 요약
- 첫/마지막 방문일 표시
- 경로 선은 표시하지 않음

Month / Year entity를 만들지 않고 SQL 집계로 계산한다.

상세 테스트: `docs/testing-step-11.md`

### Step 12 — Diagnostics

현재 DB 상태를 즉석 집계한다.

- 전체 사진
- 원본 GPS / 추정 GPS / GPS 없음
- 분류 완료 / 미분류
- 미확정 POI
- 확정 사진
- Visit / Place / 기록 날짜 수
- category별 사진 수

실제 첫 테스트에서 파이프라인이 어디까지 정상 동작했는지 확인하기 위한 패널이다.

상세 테스트: `docs/testing-step-12.md`

## API

```text
POST /photos/import
POST /photos/classify
POST /photos/infer-locations
POST /photos/clear-inferred-locations
GET  /photos
GET  /photos?date=YYYY-MM-DD
GET  /photos/dates
GET  /photos/diagnostics
GET  /photos/:id/preview

GET  /places/candidates?photoId=123
POST /places/confirm
POST /places/unassign

GET  /visits?date=YYYY-MM-DD
GET  /visits/summary?month=YYYY-MM
GET  /visits/summary?year=YYYY
```

## 로컬 실행 준비

요구사항:

- Node.js 22+
- pnpm 12+
- Python 3.11+
- Google Cloud project + billing
- Maps JavaScript API
- Places API (New)

### 1. Node 의존성

```bash
pnpm install
```

### 2. Vision용 Python 환경

Windows 기준:

```bash
cd apps/server
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements-vision.txt
cd ../..
```

SigLIP2 첫 실행에서는 Hugging Face model download가 발생한다.

### 3. 환경파일

```bash
cp apps/server/.env.example apps/server/.env
cp apps/web/.env.example apps/web/.env.local
```

`apps/server/.env`:

```text
PORT=4000
DATABASE_PATH=../../data/michikusa.db
PHOTO_DATA_PATH=../../data/photos
PYTHON_PATH=.venv\Scripts\python.exe
SIGLIP_MODEL=google/siglip2-base-patch16-224
GOOGLE_PLACES_API_KEY=...
```

`apps/web/.env.local`:

```text
NEXT_PUBLIC_API_URL=http://localhost:4000
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=...
```

Google Cloud에서는 billing을 연결하고 `Maps JavaScript API`, `Places API (New)`를 활성화한다.

가능하면 key를 분리한다.

- Web key: Maps JavaScript API 전용 + localhost referrer 제한
- Server key: Places API (New) 전용 + API restriction

### 4. 실행

```bash
pnpm dev
```

- Web: `http://localhost:3000`
- Server: `http://localhost:4000`
- Health: `http://localhost:4000/health`

기본 데이터:

```text
data/
├─ michikusa.db
└─ photos/
```

## 처음 테스트하는 순서

아직 한 번도 실행하지 않았다면 처음부터 수만 장을 넣지 않는다. iPhone에서 **100~300장 정도**만 Windows 테스트 폴더로 가져온다.

가능하면 다음이 섞인 날짜를 고른다.

- HEIC
- 음식 / 식당
- 관광지
- 역 / 공항
- 호텔
- 거리
- 사람
- 스크린샷
- GPS 없는 사진

예:

```text
D:\MichikusaTest\
```

테스트 순서:

1. `pnpm dev`
2. `D:\MichikusaTest` import
3. Diagnostics에서 전체 사진 / GPS 수 확인
4. Day Map에서 raw GPS 위치 확인
5. SigLIP2 분류 실행
6. Diagnostics에서 분류 수 확인
7. GPS 없는 사진이 있으면 `GPS 추정`
8. 장소 관련 사진에서 `POI 후보`
9. 실제 장소 후보를 몇 장 확정
10. 같은 장소 / 가까운 시간 사진의 Visit 병합 확인
11. 잘못 확정한 사진의 해제 / 변경 확인
12. Review Queue로 미확정 사진 연속 처리
13. 하루에 Place를 2곳 이상 확정해 직선 경로 확인
14. Period Map에서 Month / Year 집계 확인

처음 실제 테스트에서는 특히 아래를 기록한다.

```text
사진 category
실제 장소
실제 장소가 후보에 있었는가
후보 순위
후보 거리
GPS가 원본인지 추정인지
Visit 병합 결과가 맞는지
```

이 결과를 보고 다음 값을 조정한다.

- SigLIP category prompt
- category별 Places 반경 / type
- 후보 ranking
- Missing GPS의 90분 / 300m 기준
- Visit 병합 4시간 기준

실제 데이터 확인 전에는 자동 Place 확정 같은 추가 자동화를 넣지 않는다.

## Google Places 데이터 처리 원칙

Google Places는 resolver로만 사용한다.

SQLite에 영구 저장하지 않는 값:

- displayName
- formattedAddress
- Google 좌표
- types

영구 저장하는 Google 값:

- `googlePlaceId`

Place의 latitude / longitude는 사용자 사진에서 나온 좌표다.

공식 문서:

- https://developers.google.com/maps/documentation/places/web-service/policies
- https://developers.google.com/maps/documentation/places/web-service/place-id

## CI

GitHub Actions에서 push / PR마다:

```text
pnpm install
pnpm typecheck
pnpm build
```

를 실행한다.

Python SigLIP2 실제 inference, HEIC 처리, Google API 호출은 로컬 실제 테스트에서 확인한다.

## 다음 단계

현재는 기능을 더 늘리기보다 **실제 사진 100~300장으로 end-to-end 테스트하는 것이 우선**이다.

그 결과를 보고 필요한 것만 추가한다.

후보:

- POI 자동 확정 기준
- 더 나은 후보 ranking
- Week exploration
- semantic search
- iPhone 증분 sync
- Trip
- Notes
- backup / export

## 원칙

가능한 한 적은 entity, field, dependency로 구현한다.

**실제로 필요해지기 전에는 새로운 abstraction이나 기능을 추가하지 않는다.**
