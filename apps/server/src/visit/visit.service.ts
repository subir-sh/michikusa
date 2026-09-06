import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { Photo } from '../photo/photo.entity';
import { Place } from '../place/place.entity';
import { Visit } from './visit.entity';

const VISIT_MERGE_WINDOW_MS = 4 * 60 * 60 * 1000;

export interface AssignVisitResult {
  visit: Visit;
  created: boolean;
}

@Injectable()
export class VisitService {
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

  getMergeWindowHours() {
    return VISIT_MERGE_WINDOW_MS / 60 / 60 / 1000;
  }
}
