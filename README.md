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
6. 날짜별 POI를 시간순으로 직선 연결한다.
7. 웹의 큰 지도와 타임라인에서 과거 기록을 탐색한다.

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

초기에는 세 entity만 사용한다.

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
name
latitude
longitude
category?
googlePlaceId?
```

### Visit

```text
id
placeId
visitedAt
confirmed
```

```text
Place 1 ── N Visit 1 ── N Photo
```

Day, Week, Month, Year, Trip은 필요해지기 전까지 별도 entity로 만들지 않는다.

현재 `Place` entity는 아직 실제 생성에 사용하지 않는다. Google Places 후보 품질을 먼저 검증한 뒤 persistence 방식을 확정한다.

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
GPS 없는 경우만 위치 추정
 ↓
Google Places 주변 후보
 ↓
Place / Visit
 ↓
지도 + 일별 타임라인
```

별도 processing state machine은 두지 않는다.

### HEIC

EXIF는 `exifr`로 읽는다. Windows에서 `sharp` 기본 바이너리가 HEIC를 직접 읽지 못하는 경우가 있으므로 preview 생성은 `heic-convert → sharp → WebP`로 처리한다.

## 현재 구현

### Step 1 — 로컬 사진 가져오기

- 로컬 폴더 재귀 스캔
- JPEG / PNG / WebP / AVIF / HEIC / HEIF 지원
- SHA-256 기반 중복 제거
- 촬영 시간 / GPS 추출
- 최대 1600px WebP preview 생성
- SQLite 저장
- 웹에서 로컬 폴더 경로를 입력해 import

### Step 2 — Raw GPS Map

- 날짜별 전체 사진 수 / GPS 사진 수 조회
- 날짜별 사진 조회
- Google Maps에 raw GPS point 표시
- point 클릭 시 WebP preview와 촬영 시간 표시
- GPS 없는 날짜도 선택 가능
- import 완료 후 지도 데이터 자동 갱신

### Step 3 — Day Timeline

- 지도와 동일한 날짜 선택 상태 사용
- 선택 날짜의 모든 사진을 촬영 시간순으로 표시
- WebP thumbnail 표시
- GPS 유무와 좌표 표시
- import 완료 후 타임라인 자동 갱신

아직 raw photo 기준이다. POI와 Visit이 생기기 전에는 사진 좌표를 경로로 연결하지 않는다.

### Step 4 — SigLIP2 분류

`google/siglip2-base-patch16-224`의 zero-shot image classification을 사용한다.

분류 category:

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
- `Photo.category`가 `NULL`인 사진만 분류
- 선택 날짜 기준 최대 200장씩 실행
- NestJS가 Python subprocess를 한 번 실행하고 batch 전체를 처리
- top category만 DB에 저장
- score는 실행 결과로만 반환하고 저장하지 않음
- Day Timeline에서 category 확인 가능

첫 실행에는 Hugging Face에서 모델 파일을 내려받는다. 이후에는 로컬 cache를 사용한다.

### Step 5 — POI 후보 조회

GPS와 SigLIP category를 이용해 Google Places Nearby Search (New)의 주변 후보를 조회한다.

대상 category:

```text
food
restaurant
landmark
accommodation
transit
nature
street
```

`people`, `screenshot`, `other`는 현재 POI 후보를 조회하지 않는다.

category에 따라 탐색 반경과 Google Place type을 다르게 사용한다.

예:

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

후보 이름, 주소, 좌표 등 Google Places 응답 내용은 DB에 저장하지 않는다. 조회 결과는 현재 화면에서만 사용한다.

타임라인에서 `POI 후보`를 누르면:

1. 서버가 Places API 후보를 조회한다.
2. 선택 사진은 지도에서 강조된다.
3. 후보는 지도에 별도 마커로 표시된다.
4. 후보 마커를 누르면 이름, 주소, type, 거리, score를 확인한다.

후보 데이터는 Google Map 내부에서 확인한다.

## API

```text
POST /photos/import
POST /photos/classify
GET  /photos
GET  /photos?date=YYYY-MM-DD
GET  /photos/dates
GET  /photos/:id/preview
GET  /places/candidates?photoId=123
```

`POST /photos/import` 예시:

```json
{
  "directory": "D:\\Photos\\Japan"
}
```

`POST /photos/classify` 예시:

```json
{
  "date": "2025-05-17",
  "limit": 200
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

Windows PowerShell 또는 CMD 기준:

```bash
cd apps/server
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements-vision.txt
cd ../..
```

SigLIP2 첫 실행에서는 Hugging Face model download가 발생한다.

### 3. Google Cloud

Google Maps Platform project를 만들고 billing을 연결한 뒤 다음 API를 활성화한다.

- Maps JavaScript API
- Places API (New)

공식 설정 문서:

- https://developers.google.com/maps/documentation/javascript/get-api-key
- https://developers.google.com/maps/documentation/places/web-service/get-api-key

로컬 개발에서도 가능하면 key를 두 개로 나눈다.

- Web key: Maps JavaScript API 전용
- Server key: Places API (New) 전용

Web key는 `localhost` HTTP referrer로 제한하고, Server key는 최소한 API restriction으로 Places API (New)만 허용한다.

Places API는 billing이 필요하므로 Google Cloud에서 quota / budget도 작은 값으로 설정해두는 것을 권장한다.

### 4. 환경파일

```bash
cp apps/server/.env.example apps/server/.env
cp apps/web/.env.example apps/web/.env.local
```

Windows에서는 파일을 직접 복사해도 된다.

`apps/server/.env`:

```text
PORT=4000
DATABASE_PATH=../../data/michikusa.db
PHOTO_DATA_PATH=../../data/photos
PYTHON_PATH=.venv\Scripts\python.exe
SIGLIP_MODEL=google/siglip2-base-patch16-224
GOOGLE_PLACES_API_KEY=...
```

Python venv를 활성화한 상태에서 실행한다면 `PYTHON_PATH=python`을 사용할 수도 있다.

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

## 처음 테스트하는 방법

아직 한 번도 실행하지 않은 상태라면 아래 순서대로 확인한다.

### A. 테스트 사진 준비

처음부터 수만 장을 넣지 않는다.

Windows Photos 앱 등으로 iPhone에서 **100~300장 정도**를 테스트 폴더에 가져온다.

가능하면 다음이 섞인 날짜가 좋다.

- 음식 / 식당 사진
- 관광지
- 역
- 호텔
- 거리
- 사람 사진
- 스크린샷
- GPS 없는 사진
- HEIC

예:

```text
D:\MichikusaTest\
```

### B. 사진 import

1. `http://localhost:3000` 접속
2. 사진 가져오기 입력창에 `D:\MichikusaTest` 입력
3. `가져오기` 실행

확인할 것:

- 성공 / 중복 / 실패 수
- `data/photos/`에 WebP 생성
- `data/michikusa.db` 생성
- 같은 폴더를 다시 import하면 대부분 중복 처리

### C. Raw GPS Map

날짜를 바꾸면서 지도에 사진 위치가 뜨는지 확인한다.

확인할 것:

- 날짜별 전체 사진 수
- GPS 사진 수
- 사진 marker 위치
- marker 클릭 시 preview

GPS가 없는 사진은 지도에 뜨지 않아도 정상이다.

### D. SigLIP2

Day Timeline에서 `SigLIP2 분류`를 누른다.

첫 실행은 모델 다운로드 때문에 오래 걸릴 수 있다.

확인할 것:

- 분류 성공 수
- CPU / CUDA 표시
- 음식 사진이 `food` 또는 `restaurant` 근처로 분류되는지
- 관광지가 `landmark`, 역이 `transit`으로 대체로 들어가는지
- 사람 / 스크린샷이 장소 category로 과도하게 들어가지 않는지

여기서는 100% 정확도를 목표로 하지 않는다. POI 조회에 쓸 수 있을 정도의 broad category가 나오면 된다.

### E. POI 후보

GPS가 있고 다음 category 중 하나인 사진에서 `POI 후보`를 누른다.

```text
food / restaurant / landmark / accommodation / transit / nature / street
```

확인할 것:

- 선택 사진이 지도에서 강조되는지
- 주변 후보 marker가 추가되는지
- marker 클릭 시 실제 장소 이름이 나오는지
- 실제 방문 장소가 상위 후보에 있는지
- 거리와 category가 이상하지 않은지

초기 품질 평가에서는 특히 아래를 기록한다.

```text
사진 category
실제 장소
실제 장소가 후보에 있었는가
몇 번째 후보였는가
후보 탐색 반경이 너무 좁거나 넓었는가
```

이 결과를 보고 category별 radius / Google type / ranking score를 조정한다.

## Google Places 데이터 처리 원칙

Google Places 후보는 resolver로만 사용한다.

현재 단계에서는 Google Places에서 받은 다음 값들을 SQLite에 저장하지 않는다.

- displayName
- formattedAddress
- Google 좌표
- types

Google Place ID는 Google 정책상 장기 저장이 허용되므로, 실제 Place 확정 단계에서는 `googlePlaceId`를 식별자로 사용할 수 있다.

관련 문서:

- https://developers.google.com/maps/documentation/places/web-service/policies
- https://developers.google.com/maps/documentation/places/web-service/place-id

## 다음 구현 순서

1. **Place 확정 + Visit** — 후보 중 하나를 확정하고 같은 장소의 사진을 Visit으로 묶기
2. **일별 경로** — Visit 좌표를 시간순 직선 연결
3. **Review UI** — 자동 확정하기 애매한 후보만 빠르게 확인
4. **Missing GPS** — 앞뒤 사진을 이용한 위치 보정

## 향후 아이디어

실제로 필요해졌을 때만 추가한다.

- USB import가 불편하면 Expo 기반 iPhone 증분 sync
- SigLIP embedding 기반 semantic photo search
- 애매한 POI를 Codex GUI batch로 추가 판정
- 필요 시 OCR / 별도 VLM
- Trip grouping
- Place / Visit 메모
- 같은 장소 재방문 기록
- 지역별 방문 밀도 / 랜덤 과거 장소 다시 보기
- DB + preview 백업 / export

## 원칙

**가능한 한 적은 entity, field, dependency로 구현한다.**

실제로 필요해지기 전에는 새로운 abstraction, state, service를 추가하지 않는다.
