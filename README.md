# Michikusa

사진을 기반으로 과거에 방문한 장소를 복원하고, 지도와 시간순 경로로 다시 탐색하는 개인용 아카이브.

추천이나 SNS가 목적이 아니라 **언제 어디서 무엇을 했는지 오래 보존하고 다시 보는 것**이 목적이다.

## 핵심 경험

사진을 대량으로 가져오면:

1. 촬영 시간과 GPS를 읽는다.
2. 웹용 WebP preview를 만든다.
3. 장소와 관련된 사진을 분류한다.
4. 주변 POI 후보와 연결한다.
5. 같은 장소의 사진을 하나의 Visit으로 묶는다.
6. 날짜별 Visit을 시간순 직선으로 연결한다.
7. 웹 지도와 타임라인에서 과거 기록을 탐색한다.

실제 이동 경로 복원은 하지 않는다.

## 기술 스택

- Monorepo: pnpm workspace
- Web: Next.js
- Server: NestJS
- ORM: TypeORM
- Database: SQLite (`better-sqlite3`)
- Storage: local filesystem
- Vision: SigLIP2
- Map: Google Maps
- POI: Google Places API (New)
- AI fallback: Codex GUI

외부 배포를 전제로 하지 않는다. 서버, DB, 사진은 모두 로컬 PC에서 실행·보관한다.

## 구조

```text
apps/
├─ web/
│  └─ src/
│     ├─ app/
│     └─ features/
│        ├─ import/
│        ├─ map/
│        ├─ timeline/
│        └─ review/
└─ server/
   ├─ scripts/
   │  └─ siglip_classify.py
   └─ src/
      ├─ photo/
      ├─ place/
      └─ visit/

data/                 # 로컬 전용, Git 제외
```

각 앱은 feature-based structure를 사용한다. SigLIP2 inference만 작은 Python script로 분리하고, 별도 Python 서버는 두지 않는다.

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

`Place.latitude / longitude`는 Google Places 좌표가 아니라 **확정에 사용한 사용자 사진의 GPS**다.

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

Day, Week, Month, Year, Trip은 필요해지기 전까지 별도 entity로 만들지 않는다.

## 사진 처리 흐름

```text
사진
 ↓
EXIF: capturedAt / GPS
 ↓
중복 hash 확인
 ↓
WebP preview 생성
 ↓
SigLIP2 분류
 ↓
Google Places 주변 후보
 ↓
사용자가 후보 확정
 ↓
Place / Visit
 ↓
일별 Visit 직선 경로
```

GPS가 없는 사진의 위치 추정은 아직 구현하지 않았다.

## 현재 구현

### Step 1 — 로컬 사진 가져오기

- 로컬 폴더 재귀 스캔
- JPEG / PNG / WebP / AVIF / HEIC / HEIF 지원
- SHA-256 기반 중복 제거
- 촬영 시간 / GPS 추출
- 최대 1600px WebP preview 생성
- SQLite 저장
- 웹에서 로컬 폴더 경로를 입력해 import

HEIC preview는 Windows 호환성을 위해 `heic-convert → sharp → WebP`로 처리한다.

### Step 2 — Raw GPS Map

- 날짜별 전체 사진 수 / GPS 사진 수 조회
- Google Maps에 raw GPS point 표시
- point 클릭 시 WebP preview와 촬영 시간 표시
- GPS 없는 날짜도 선택 가능

### Step 3 — Day Timeline

- 지도와 동일한 날짜 선택 상태 사용
- 선택 날짜의 모든 사진을 촬영 시간순으로 표시
- WebP thumbnail 표시
- GPS 유무 표시

### Step 4 — SigLIP2 분류

`google/siglip2-base-patch16-224`의 zero-shot image classification을 사용한다.

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

- 별도 학습 없음
- `Photo.category IS NULL`인 사진만 분류
- 선택 날짜 기준 최대 200장씩 실행
- NestJS가 Python subprocess를 한 번 실행하고 batch 전체 처리
- top category만 DB 저장
- score는 실행 결과로만 반환

### Step 5 — POI 후보 조회

대상 category:

```text
food / restaurant / landmark / accommodation / transit / nature / street
```

초기 탐색 반경:

```text
food / restaurant  120m
accommodation      250m
transit            300m
landmark           500m
nature             600m
street             120m
```

후보는 최대 10개를 받고 다음 기준으로 정렬한다.

- 사진 GPS와의 거리
- SigLIP category와 Google Place primary type의 일치 여부

후보 데이터는 현재 화면에서만 사용한다.

### Step 6 — Place 확정 + Visit

타임라인에서 `POI 후보`를 누른 뒤 지도에서 주황색 후보 마커를 선택한다.

후보 InfoWindow의 `이 장소로 확정`을 누르면:

1. 서버가 같은 사진의 후보를 다시 조회해 `googlePlaceId`가 실제 후보인지 검증한다.
2. 같은 `googlePlaceId`의 Place가 없으면 새 Place를 만든다.
3. Place 좌표는 Google 좌표가 아니라 사진 GPS를 저장한다.
4. 확정한 Photo에 `visitId`를 연결한다.
5. 같은 Place의 기존 Visit 중 시간적으로 가까운 것이 있으면 병합한다.
6. 없으면 새 Visit을 만든다.

현재 Visit 병합 기준은 **같은 Place + 기존 Visit 사진과 4시간 이내**다.

근처 사진을 추측으로 자동 편입하지 않는다. **직접 Place가 확정된 사진만 Visit에 들어간다.**

### Step 7 — 일별 Visit 경로

`GET /visits?date=YYYY-MM-DD`로 해당 날짜의 확정 Visit을 시간순으로 조회한다.

지도에서는:

- 파란색 작은 점: raw photo GPS
- 검은색 큰 점: 확정된 Visit
- 검은 직선: Visit을 시간순으로 연결한 하루 경로
- 주황색 점: 현재 선택한 Google Places 후보
- 빨간색 점: 현재 POI 후보를 조회 중인 사진

Visit marker를 누르면 Visit ID, 시각, category, 연결된 사진 수를 확인한다.

실제 도보/대중교통 경로를 추정하지 않고 **Visit 좌표 사이를 직선으로만 연결한다.**

## API

```text
POST /photos/import
POST /photos/classify
GET  /photos
GET  /photos?date=YYYY-MM-DD
GET  /photos/dates
GET  /photos/:id/preview

GET  /places/candidates?photoId=123
POST /places/confirm

GET  /visits?date=YYYY-MM-DD
```

`POST /places/confirm`:

```json
{
  "photoId": 123,
  "googlePlaceId": "ChIJ..."
}
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

### 3. Google Cloud

Google Maps Platform project에서 billing을 연결하고 다음 API를 활성화한다.

- Maps JavaScript API
- Places API (New)

가능하면 key를 두 개로 나눈다.

- Web key: Maps JavaScript API 전용, `localhost` HTTP referrer 제한
- Server key: Places API (New) 전용, API restriction 적용

### 4. 환경파일

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

### 5. 실행

```bash
pnpm dev
```

- Web: `http://localhost:3000`
- Server: `http://localhost:4000`
- Health: `http://localhost:4000/health`

기본 데이터 경로:

```text
data/
├─ michikusa.db
└─ photos/
```

## 처음부터 테스트하는 방법

아직 한 번도 실행하지 않았다면 아래 순서대로 확인한다.

### A. 테스트 사진 준비

iPhone에서 **100~300장 정도**만 Windows 폴더로 가져온다.

가능하면 음식, 관광지, 역, 호텔, 거리, 사람, 스크린샷, GPS 없는 사진, HEIC가 섞인 날짜를 고른다.

예:

```text
D:\MichikusaTest\
```

### B. 사진 import

1. `http://localhost:3000` 접속
2. `D:\MichikusaTest` 입력
3. `가져오기` 실행

확인:

- 성공 / 중복 / 실패 수
- `data/photos/`의 WebP
- `data/michikusa.db`
- 같은 폴더 재import 시 중복 처리

### C. Raw GPS Map

확인:

- 날짜별 전체 사진 수 / GPS 사진 수
- marker 위치
- marker 클릭 시 preview

GPS 없는 사진이 지도에 뜨지 않는 것은 정상이다.

### D. SigLIP2

Day Timeline에서 `SigLIP2 분류`를 누른다.

확인:

- 분류 성공 수
- CPU / CUDA 표시
- 음식 → `food` / `restaurant`
- 관광지 → `landmark`
- 역 → `transit`
- 사람 / 스크린샷이 장소 category로 과도하게 분류되지 않는지

### E. POI 후보

장소 category 사진에서 `POI 후보`를 누른다.

확인:

- 실제 장소가 후보에 있는지
- 몇 번째 후보인지
- 탐색 반경이 적절한지

예:

```text
사진 category: restaurant
실제 장소: ○○라멘
후보에 있었나: YES
후보 순위: 2
거리: 34m
```

### F. Place / Visit 확정

1. 실제 장소 후보 marker를 누른다.
2. `이 장소로 확정`을 누른다.
3. 타임라인에서 `Visit #n`으로 바뀌는지 확인한다.
4. 같은 장소에서 비슷한 시간에 찍은 다른 사진도 확정한다.

확인:

- 같은 Google Place + 4시간 이내 사진이 같은 Visit ID로 묶이는지
- 충분히 시간이 떨어진 재방문은 다른 Visit이 되는지
- 4시간 기준이 너무 짧거나 긴지

### G. 일별 Visit 경로

하루에 서로 다른 장소의 사진을 2개 이상 확정한다.

확인:

- 검은 Visit marker가 시간순으로 나타나는지
- Visit marker 사이에 직선이 생기는지
- Visit 순서가 실제 하루 순서와 맞는지
- raw photo GPS 점과 확정 Visit이 구분되는지

여기서는 **실제 이동 경로와 선이 달라도 정상**이다. 목적은 방문 순서의 시각화다.

잘못 확정한 Place를 수정하는 UI는 아직 없다. 초기 테스트에서 처음부터 다시 돌리고 싶다면 서버를 종료한 뒤 `data/michikusa.db`와 `data/photos/`를 지우고 재import한다.

## Google Places 데이터 처리 원칙

Google Places는 resolver로만 사용한다.

SQLite에 영구 저장하지 않는 값:

- displayName
- formattedAddress
- Google 좌표
- types

영구 저장하는 Google 값:

- `googlePlaceId`

Place의 latitude / longitude는 사용자의 사진 GPS이므로 Google Places 응답 데이터가 아니다.

공식 문서:

- https://developers.google.com/maps/documentation/places/web-service/policies
- https://developers.google.com/maps/documentation/places/web-service/place-id

## CI

GitHub Actions에서 push / PR마다 다음을 확인한다.

```text
pnpm install
pnpm typecheck
pnpm build
```

Python SigLIP2 inference와 실제 Google API 호출은 로컬 테스트에서 확인한다.

## 다음 구현 순서

1. **Review / 수정 UI** — 잘못 확정한 Place를 변경하거나 해제
2. **Missing GPS** — 앞뒤 사진을 이용한 위치 보정
3. **자동 확정** — 실제 후보 품질이 확인된 뒤 확실한 케이스만 자동 처리

## 향후 아이디어

- Expo 기반 iPhone 증분 sync
- SigLIP embedding 기반 semantic photo search
- Codex GUI batch review
- 필요 시 OCR / 별도 VLM
- Trip grouping
- Place / Visit 메모
- 같은 장소 재방문 기록
- 지역별 방문 밀도 / 랜덤 과거 장소 다시 보기
- DB + preview 백업 / export

## 원칙

**가능한 한 적은 entity, field, dependency로 구현한다.**

실제로 필요해지기 전에는 새로운 abstraction, state, service를 추가하지 않는다.
