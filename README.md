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
- POI: Google Places API
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
   └─ src/
      ├─ photo/
      ├─ place/
      └─ visit/

data/                 # 로컬 전용, Git 제외
```

각 앱은 feature-based structure를 사용한다.

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

API:

```text
POST /photos/import
GET  /photos
GET  /photos?date=YYYY-MM-DD
GET  /photos/dates
GET  /photos/:id/preview
```

`POST /photos/import` 예시:

```json
{
  "directory": "D:\\Photos\\Japan"
}
```

## 로컬 실행

요구사항:

- Node.js 22+
- pnpm 12+
- Google Maps JavaScript API key

```bash
pnpm install
```

환경파일:

```bash
cp apps/server/.env.example apps/server/.env
cp apps/web/.env.example apps/web/.env.local
```

`apps/web/.env.local`:

```text
NEXT_PUBLIC_API_URL=http://localhost:4000
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=...
```

Windows에서는 환경파일을 직접 복사해도 된다.

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

## 다음 구현 순서

1. **SigLIP2** — 장소와 관련된 사진 분류
2. **POI Resolution** — Google Places 후보 조회
3. **Visit** — 같은 장소의 사진 병합
4. **일별 경로** — Visit 좌표를 시간순 직선 연결
5. **Review UI** — 애매한 POI만 직접 확인
6. **Missing GPS** — 앞뒤 사진을 이용한 위치 보정

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
