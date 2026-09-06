import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Place } from '../place/place.entity';
import { Visit } from '../visit/visit.entity';
import { Photo } from './photo.entity';

const POI_CATEGORIES = [
  'food',
  'restaurant',
  'landmark',
  'accommodation',
  'transit',
  'nature',
  'street',
] as const;

interface DiagnosticsRow {
  total: number | string;
  originalGps: number | string;
  inferredGps: number | string;
  missingGps: number | string;
  classified: number | string;
  confirmed: number | string;
  unresolvedPoi: number | string;
  days: number | string;
}

interface CategoryRow {
  category: string | null;
  count: number | string;
}

export interface PhotoDiagnostics {
  photos: {
    total: number;
    originalGps: number;
    inferredGps: number;
    missingGps: number;
    classified: number;
    unclassified: number;
    confirmed: number;
    unresolvedPoi: number;
  };
  archive: {
    visits: number;
    places: number;
    days: number;
  };
  categories: Record<string, number>;
}

@Injectable()
export class PhotoDiagnosticsService {
  constructor(
    @InjectRepository(Photo)
    private readonly photoRepository: Repository<Photo>,
  ) {}

  async getDiagnostics(): Promise<PhotoDiagnostics> {
    const placeholders = POI_CATEGORIES.map(() => '?').join(', ');
    const raw = (await this.photoRepository.query(
      `
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN latitude IS NOT NULL AND longitude IS NOT NULL AND locationInferred = 0 THEN 1 ELSE 0 END) AS originalGps,
        SUM(CASE WHEN locationInferred = 1 THEN 1 ELSE 0 END) AS inferredGps,
        SUM(CASE WHEN latitude IS NULL OR longitude IS NULL THEN 1 ELSE 0 END) AS missingGps,
        SUM(CASE WHEN category IS NOT NULL THEN 1 ELSE 0 END) AS classified,
        SUM(CASE WHEN visitId IS NOT NULL THEN 1 ELSE 0 END) AS confirmed,
        SUM(CASE
          WHEN visitId IS NULL
            AND latitude IS NOT NULL
            AND longitude IS NOT NULL
            AND category IN (${placeholders})
          THEN 1 ELSE 0 END
        ) AS unresolvedPoi,
        COUNT(DISTINCT date(capturedAt)) AS days
      FROM photo
      `,
      [...POI_CATEGORIES],
    )) as DiagnosticsRow[];

    const row = raw[0] ?? {
      total: 0,
      originalGps: 0,
      inferredGps: 0,
      missingGps: 0,
      classified: 0,
      confirmed: 0,
      unresolvedPoi: 0,
      days: 0,
    };

    const categoryRows = await this.photoRepository
      .createQueryBuilder('photo')
      .select('photo.category', 'category')
      .addSelect('COUNT(photo.id)', 'count')
      .where('photo.category IS NOT NULL')
      .groupBy('photo.category')
      .orderBy('COUNT(photo.id)', 'DESC')
      .getRawMany<CategoryRow>();

    const total = Number(row.total);
    const classified = Number(row.classified);
    const [visits, places] = await Promise.all([
      this.photoRepository.manager.count(Visit),
      this.photoRepository.manager.count(Place),
    ]);

    return {
      photos: {
        total,
        originalGps: Number(row.originalGps),
        inferredGps: Number(row.inferredGps),
        missingGps: Number(row.missingGps),
        classified,
        unclassified: total - classified,
        confirmed: Number(row.confirmed),
        unresolvedPoi: Number(row.unresolvedPoi),
      },
      archive: {
        visits,
        places,
        days: Number(row.days),
      },
      categories: Object.fromEntries(
        categoryRows
          .filter((item): item is CategoryRow & { category: string } => item.category !== null)
          .map((item) => [item.category, Number(item.count)]),
      ),
    };
  }
}
