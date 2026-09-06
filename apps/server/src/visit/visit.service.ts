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

export interface VisitAssignment {
  visitId: number;
  placeId: number;
  googlePlaceId: string;
}

export interface UnassignVisitResult {
  photoId: number;
  previousVisitId: number | null;
  previousPlaceId: number | null;
  deletedVisit: boolean;
  deletedPlace: boolean;
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

  async getAssignment(photoId: number): Promise<VisitAssignment | null> {
    const photo = await this.visitRepository.manager.findOne(Photo, {
      where: { id: photoId },
    });
    if (!photo || photo.visitId === null) return null;

    const visit = await this.visitRepository.findOne({
      where: { id: photo.visitId },
      relations: { place: true },
    });
    if (!visit) return null;

    return {
      visitId: visit.id,
      placeId: visit.placeId,
      googlePlaceId: visit.place.googlePlaceId,
    };
  }

  async unassignPhoto(
    manager: EntityManager,
    photo: Photo,
  ): Promise<UnassignVisitResult> {
    const previousVisitId = photo.visitId;
    if (previousVisitId === null) {
      return {
        photoId: photo.id,
        previousVisitId: null,
        previousPlaceId: null,
        deletedVisit: false,
        deletedPlace: false,
      };
    }

    const visit = await manager.findOne(Visit, {
      where: { id: previousVisitId },
      relations: { photos: true },
    });

    await manager.update(Photo, photo.id, { visitId: null });

    if (!visit) {
      return {
        photoId: photo.id,
        previousVisitId,
        previousPlaceId: null,
        deletedVisit: false,
        deletedPlace: false,
      };
    }

    const remainingPhotos = visit.photos.filter((item) => item.id !== photo.id);

    if (remainingPhotos.length > 0) {
      const visitedAt = new Date(
        Math.min(...remainingPhotos.map((item) => item.capturedAt.getTime())),
      );
      await manager.update(Visit, visit.id, { visitedAt });

      return {
        photoId: photo.id,
        previousVisitId,
        previousPlaceId: visit.placeId,
        deletedVisit: false,
        deletedPlace: false,
      };
    }

    await manager.delete(Visit, visit.id);
    const remainingVisits = await manager.count(Visit, {
      where: { placeId: visit.placeId },
    });

    let deletedPlace = false;
    if (remainingVisits === 0) {
      await manager.delete(Place, visit.placeId);
      deletedPlace = true;
    }

    return {
      photoId: photo.id,
      previousVisitId,
      previousPlaceId: visit.placeId,
      deletedVisit: true,
      deletedPlace,
    };
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
