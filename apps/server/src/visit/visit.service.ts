import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { Photo } from '../photo/photo.entity';
import { Place } from '../place/place.entity';
import { Visit } from './visit.entity';

const VISIT_MERGE_WINDOW_MS = 4 * 60 * 60 * 1000;

interface DayVisitRow {
  id: number | string;
  placeId: number | string;
  visitedAt: string;
  latitude: number | string;
  longitude: number | string;
  category: string | null;
  photoCount: number | string;
}

export interface AssignVisitResult {
  visit: Visit;
  created: boolean;
}

export interface DayVisit {
  id: number;
  placeId: number;
  visitedAt: string;
  latitude: number;
  longitude: number;
  category: string | null;
  photoCount: number;
}

@Injectable()
export class VisitService {
  constructor(
    @InjectRepository(Visit)
    private readonly visitRepository: Repository<Visit>,
  ) {}

  async assignPhoto(
    manager: EntityManager,
    place: Place,
    photo: Photo,
  ): Promise<AssignVisitResult> {
    const visits = await manager.find(Visit, {
      where: { placeId: place.id },
      relations: { photos: true },
      order: { visitedAt: 'ASC' },
    });

    let closestVisit: Visit | null = null;
    let closestDelta = Number.POSITIVE_INFINITY;

    for (const visit of visits) {
      const times = [visit.visitedAt, ...visit.photos.map((item) => item.capturedAt)];
      const delta = Math.min(
        ...times.map((time) => Math.abs(time.getTime() - photo.capturedAt.getTime())),
      );

      if (delta <= VISIT_MERGE_WINDOW_MS && delta < closestDelta) {
        closestVisit = visit;
        closestDelta = delta;
      }
    }

    if (!closestVisit) {
      const visit = manager.create(Visit, {
        placeId: place.id,
        place,
        visitedAt: photo.capturedAt,
      });
      return { visit: await manager.save(visit), created: true };
    }

    if (photo.capturedAt < closestVisit.visitedAt) {
      closestVisit.visitedAt = photo.capturedAt;
      await manager.save(closestVisit);
    }

    return { visit: closestVisit, created: false };
  }

  async findByDate(date: string): Promise<DayVisit[]> {
    const rows = await this.visitRepository
      .createQueryBuilder('visit')
      .innerJoin('visit.photos', 'photo')
      .innerJoin('visit.place', 'place')
      .select('visit.id', 'id')
      .addSelect('visit.placeId', 'placeId')
      .addSelect('MIN(photo.capturedAt)', 'visitedAt')
      .addSelect('place.latitude', 'latitude')
      .addSelect('place.longitude', 'longitude')
      .addSelect('place.category', 'category')
      .addSelect('COUNT(photo.id)', 'photoCount')
      .where('date(photo.capturedAt) = :date', { date })
      .groupBy('visit.id')
      .addGroupBy('visit.placeId')
      .addGroupBy('place.latitude')
      .addGroupBy('place.longitude')
      .addGroupBy('place.category')
      .orderBy('MIN(photo.capturedAt)', 'ASC')
      .getRawMany<DayVisitRow>();

    return rows.map((row) => ({
      id: Number(row.id),
      placeId: Number(row.placeId),
      visitedAt: row.visitedAt,
      latitude: Number(row.latitude),
      longitude: Number(row.longitude),
      category: row.category,
      photoCount: Number(row.photoCount),
    }));
  }

  getMergeWindowHours() {
    return VISIT_MERGE_WINDOW_MS / 60 / 60 / 1000;
  }
}
