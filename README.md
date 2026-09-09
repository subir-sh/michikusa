# michikusa

`michikusa`는 사진에 남은 시간과 위치 흔적을 이용해 과거의 하루와 장소를 다시 탐색하는 local-first 개인 사진 지도 아카이브다.

SNS나 장소 추천 서비스가 아니라, 몇 년 뒤에도 **언제 / 어디서 / 무엇을 했는지** 다시 찾아볼 수 있게 하는 것이 목표다. 원본 사진은 사용자가 관리하고, 앱은 로컬 SQLite와 필요한 preview만 유지한다.

## 핵심 원칙

- local-first
- 원본 사진은 프로젝트 밖에 둔다
- 사진 메타데이터와 사용자 확정 데이터가 source of truth다
- Google Places는 POI 후보를 찾는 데만 사용한다
- 이동 경로를 재구성하지 않고 확정된 Visit 사이만 직선으로 연결한다
- Day / Review Queue / Month / Year는 별도 entity가 아니라 파생 view다
- 자동화보다 실제 사진으로 품질을 검증한 뒤 threshold를 조정한다

## 기술 스택

```text
apps/
├─ server/   NestJS + TypeORM + SQLite
└─ web/      Next.js + React + Google Maps JavaScript API

tools/
└─ launcher/ Windows 개발용 launcher
```

- Node.js 22+
- pnpm 12+
- Python 3.11+
- SQLite + better-sqlite3
- SigLIP2
- Google Maps JavaScript API
- Places API (New)

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

새로 인덱싱한 사진에서 `path`는 원본 사진의 absolute path다. `hash`는 첫 인덱싱을 빠르게 끝내기 위해 원본 전체 내용을 읽는 SHA-256 대신 `path + file size + mtime`으로 만든 source fingerprint다. 이전 버전에서 생성된 row의 `path`가 상대 WebP 경로인 경우에도 그대로 읽을 수 있다.

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

### Step 1 — 로컬 사진 빠른 인덱싱

- 로컬 폴더 재귀 스캔
- JPEG / PNG / WebP / AVIF / HEIC / HEIF 지원
- 원본 전체를 읽지 않는 source fingerprint (`path + size + mtime`)로 재인덱싱 중복 제거
- 촬영 시간 / GPS 추출
- 원본 absolute path를 SQLite에 저장
- 최대 8개 파일의 메타데이터를 제한 병렬 처리
- **import 시 WebP preview를 미리 만들지 않음**

사진 목록과 지도는 인덱싱이 끝나는 즉시 사용할 수 있다. preview가 실제로 요청되면 그때 최대 1600px WebP를 생성하고 `data/photos/`에 캐시한다. preview 변환은 동시에 최대 2개만 실행하며, 이미 캐시된 preview는 다시 만들지 않는다. HEIC / HEIF는 preview가 필요할 때만 `heic-convert → sharp → WebP`로 처리한다.

### Step 2 — Raw GPS Map

- 날짜별 사진 수 / GPS 수 조회
- raw photo GPS point 표시
- marker 클릭 시 preview / 촬영 시각 표시

### Step 3 — Day Timeline

- 선택 날짜 사진을 촬영시간 순으로 표시
- thumbnail / GPS 상태 / category / Visit 상태 표시
- browser lazy-loading으로 화면에 필요한 preview부터 요청

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

별도 학습 없이 zero-shot classification을 사용한다. top category만 DB에 저장한다. 분류에 필요한 preview가 아직 없으면 먼저 lazy preview queue를 통해 생성한다.

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

1. Google Place ID로 Place를 찾거나 생성
2. Place 좌표는 사진의 resolved GPS를 사용
3. 같은 Place의 가까운 Visit을 찾음
4. 4시간 이내면 기존 Visit에 합침
5. 아니면 새 Visit 생성

### Step 7 — Day Visit Route

하루의 확정된 Visit을 시간순으로 정렬하고 장소 사이를 **직선**으로 연결한다.

실제 이동 경로나 도보 / 대중교통 경로를 추정하지 않는다.

### Step 8 — Place 수정

확정된 사진도 다시 POI 후보를 열어 다른 Place로 변경하거나 확정을 해제할 수 있다.

확정을 해제해서 Visit이 비면 Visit을 삭제하고, Place에도 Visit이 하나도 남지 않으면 Place도 삭제한다.

### Step 9 — GPS 없는 사진 위치 추정

원본 GPS가 없는 사진만 대상으로 시간상 앞뒤의 **원본 GPS 사진**을 anchor로 사용한다.

현재 조건:

```text
각 anchor까지 90분 이하
두 anchor 거리 300m 이하
```

조건을 만족하면 촬영 시간 비율로 선형 보간한다. 추정 위치는 다시 anchor로 사용하지 않는다.

### Step 10 — Review Queue

현재 날짜에서 아래 조건인 사진을 review 대상으로 계산한다.

```text
Visit 미확정
+ resolved GPS 있음
+ place-worthy category
```

별도 Review entity나 status는 저장하지 않는다.

### Step 11 — Month / Year Map

월 / 연도별로 Place를 집계한다.

- Place별 Visit 수
- 사진 수
- 최초 / 마지막 방문 시각
- route 없음

### Step 12 — Diagnostics

현재 archive 상태를 빠르게 확인한다.

- 전체 사진 수
- 원본 / 추정 / 누락 GPS
- 분류 / 미분류
- Place 확정 / 미확정 POI
- Visit / Place / 날짜 수
- category 분포

## Windows 개발 환경 실행

### 1. 의존성

```bash
pnpm install
```

### 2. Python 환경

Git Bash 기준:

```bash
cd apps/server
python -m venv .venv
source .venv/Scripts/activate
pip install -r requirements-vision.txt
cd ../..
```

### 3. 환경변수

```bash
cp apps/server/.env.example apps/server/.env
cp apps/web/.env.example apps/web/.env.local
```

`apps/server/.env` 예시:

```text
PORT=4000
DATABASE_PATH=../../data/michikusa.db
PHOTO_DATA_PATH=../../data/photos
PYTHON_PATH=.venv\Scripts\python.exe
SIGLIP_MODEL=google/siglip2-base-patch16-224
GOOGLE_PLACES_API_KEY=
```

`apps/web/.env.local`:

```text
NEXT_PUBLIC_API_URL=http://localhost:4000
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=
```

Google key 없이도 import / timeline / diagnostics / SigLIP2 같은 Google 비의존 기능을 테스트할 수 있다.

### 4. 실행

```bash
pnpm dev
```

- Web: `http://localhost:3000`
- Server: `http://localhost:4000`
- Health: `http://localhost:4000/health`

## Windows 개발용 launcher

처음 한 번:

```bash
pnpm launcher:build
```

repo 루트에 생성되는 `Michikusa.exe`를 더블클릭하면 `pnpm dev`를 실행하고 web / server 준비 후 브라우저를 연다. launcher를 종료하면 자신이 시작한 dev process tree도 종료한다.

자세한 내용은 `docs/testing-launcher.md` 참고.

## Google API

필요한 API:

- Maps JavaScript API
- Places API (New)

권장:

- Web key: Maps JavaScript API만 허용 + localhost referrer 제한
- Server key: Places API (New)만 허용

Google Places에서 장기 저장하는 것은 Google Place ID뿐이다.

## 실제 사진 테스트

기능 추가보다 실제 사진으로 pipeline을 검증하는 것이 우선이다.

권장 sample:

```text
100–300장
HEIC 포함
음식 / 식당
랜드마크
역 / 공항 / 교통
호텔
거리
사람
스크린샷
GPS 없는 사진
```

기록할 것:

```text
사진 category
실제 장소
실제 장소가 후보에 있었는가
후보 순위
후보 거리
GPS가 원본인지 추정인지
Visit 병합 결과가 맞는지
```

이 결과를 보고 category prompt, Places radius / types / ranking, GPS 보간 threshold, Visit 4시간 window를 조정한다.

## 아직 검증되지 않은 것

CI는 Node / Nest / Next의 typecheck와 build를 확인한다. 다음은 실제 Windows에서 별도 검증이 필요하다.

- HEIC lazy preview 변환
- Python SigLIP2 inference / model download
- Google Maps / Places API key 동작
- SQLite 실제 데이터 runtime query
- POI 후보 품질 / ranking
- timezone 처리

## 다음 단계 후보

실제 E2E 테스트 이후 필요할 때만 추가한다.

- automatic POI confirmation
- ranking 개선
- Week view
- semantic search
- iPhone incremental sync
- Trip
- Notes
- backup / export
