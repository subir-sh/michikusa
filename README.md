# Michikusa

A local-first personal archive for revisiting past places through photos, maps, and daily timelines.

The project is intentionally small: it runs on one PC, stores only the data it needs, and avoids infrastructure or abstractions that are not required yet.

## Goal

Given a large photo library:

1. Read capture time and GPS metadata.
2. Convert photos to lightweight WebP previews.
3. Detect photos that are useful for identifying places.
4. Match them with nearby POIs.
5. Group photos from the same place into a visit.
6. Show visits on a map and connect each day's POIs with simple straight lines.

This is an archive and recollection tool, not a recommendation service or social network.

## Stack

- Monorepo: pnpm workspace
- Web: Next.js
- Server: NestJS
- ORM: TypeORM
- Database: SQLite via better-sqlite3
- Storage: local filesystem
- Vision: SigLIP2
- Map: Google Maps
- POI resolver: Google Places API
- AI fallback: Codex GUI, only for ambiguous cases

Everything runs locally. Personal photos, the SQLite database, review batches, and secrets are excluded from Git.

## Repository Structure

```text
apps/
├─ web/
│  └─ src/
│     ├─ app/
│     └─ features/
│        ├─ map/
│        ├─ timeline/
│        └─ review/
│
└─ server/
   └─ src/
      ├─ photo/
      ├─ place/
      └─ visit/

data/                # local only, ignored by Git
```

Both applications use feature-based structure.

## Data Model

Only three entities are defined initially.

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

Relations:

```text
Place 1 ── N Visit 1 ── N Photo
```

Day, week, month, year, and trip are derived concepts and are not database entities unless they later need to be.

## Processing Flow

```text
Photo
  ↓
EXIF: capturedAt + GPS
  ↓
WebP conversion + duplicate hash check
  ↓
SigLIP2 classification
  ↓
GPS available? ── no ──> infer from nearby photos when possible
  ↓
Google Places nearby candidates
  ↓
category + distance based candidate selection
  ↓
Place / Visit
  ↓
Map + daily timeline
```

There is no processing state machine. Missing values are enough to determine what still needs work.

### Ambiguous POIs

Cases that cannot be resolved confidently can be exported to an ignored `ai-review/` directory with the image and a small metadata JSON file. Codex GUI can inspect the batch and write structured results back.

## UI

The initial web UI has three areas:

- **Map** — POIs, date selection, daily straight-line route, related photos.
- **Timeline** — visits for the selected day in chronological order.
- **Review** — unresolved or unconfirmed POIs.

Day and week are the main timeline views. Month and year views should favor clustering rather than drawing dense routes.

## Local Development

Requirements:

- Node.js 22+
- pnpm 12+

Install dependencies:

```bash
pnpm install
```

Copy the example environment files:

```bash
cp apps/server/.env.example apps/server/.env
cp apps/web/.env.example apps/web/.env.local
```

Run both apps:

```bash
pnpm dev
```

- Web: `http://localhost:3000`
- Server: `http://localhost:4000`
- Health: `http://localhost:4000/health`

The SQLite database is created automatically under `data/michikusa.db` by default.

## MVP

1. Bulk photo import
2. EXIF extraction and WebP generation
3. Raw GPS map
4. Day filtering and straight-line route
5. SigLIP2 classification
6. Google Places candidates
7. Place / Visit creation
8. Review UI
9. Missing-GPS inference

## Future Ideas

Only add these when actual usage justifies them:

- Expo iPhone sync client if USB import becomes annoying
- Semantic photo search using SigLIP embeddings
- Better POI resolution using visual clues or OCR
- Trip grouping
- Notes on places or visits
- Revisit history for the same place
- Random past-place / past-day rediscovery
- Region density and long-term map exploration
- Backup / export of DB and previews

## Principle

Keep the implementation as small as possible.

Do not add an entity, field, dependency, state, service, or abstraction until the current product actually needs it.
