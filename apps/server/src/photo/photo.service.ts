import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { extname, isAbsolute, join, resolve } from 'node:path';
import {
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import convert = require('heic-convert');
import sharp = require('sharp');
import { Repository } from 'typeorm';
import { Photo } from './photo.entity';

const LOCATION_INFERENCE_MAX_GAP_MS = 90 * 60 * 1000;
const LOCATION_INFERENCE_MAX_ANCHOR_DISTANCE_METERS = 300;
const PREVIEW_CONCURRENCY = 2;

interface PhotoDateRow {
  date: string | null;
  count: number | string;
  gpsCount: number | string;
  inferredCount: number | string;
}

interface ClassificationInput {
  id: number;
  path: string;
}

interface ClassificationOutput {
  id: number;
  category?: string;
  score?: number;
  error?: string;
}

interface ClassifierResponse {
  device: 'cpu' | 'cuda';
  results: ClassificationOutput[];
}

interface PreparedClassification {
  photo: Photo;
  input: ClassificationInput | null;
  error: string | null;
}

export interface PhotoDateCount {
  date: string;
  count: number;
  gpsCount: number;
  inferredCount: number;
}

export interface ClassificationResult {
  requested: number;
  classified: number;
  device: 'cpu' | 'cuda' | null;
  results: Array<{ id: number; category: string; score: number }>;
  failed: Array<{ id: number; error: string }>;
}

export interface LocationInferenceResult {
  date: string;
  attempted: number;
  inferred: number;
  skipped: number;
  maxGapMinutes: number;
  maxAnchorDistanceMeters: number;
  results: Array<{
    id: number;
    latitude: number;
    longitude: number;
    previousPhotoId: number;
    nextPhotoId: number;
  }>;
}

export interface ClearInferredLocationsResult {
  date: string;
  cleared: number;
  blocked: number;
  clearedPhotoIds: number[];
  blockedPhotoIds: number[];
}

@Injectable()
export class PhotoService {
  private readonly photoDirectory: string;
  private readonly pythonPath: string;
  private readonly classifierScript: string;
  private readonly siglipModel: string;
  private readonly previewJobs = new Map<number, Promise<string>>();
  private readonly previewWaiters: Array<() => void> = [];
  private activePreviewJobs = 0;

  constructor(
    @InjectRepository(Photo)
    private readonly photoRepository: Repository<Photo>,
    config: ConfigService,
  ) {
    this.photoDirectory = resolve(
      process.cwd(),
      config.get<string>('PHOTO_DATA_PATH') ?? '../../data/photos',
    );
    this.pythonPath = config.get<string>('PYTHON_PATH') ?? 'python';
    this.classifierScript = resolve(
      process.cwd(),
      'scripts/siglip_classify.py',
    );
    this.siglipModel =
      config.get<string>('SIGLIP_MODEL') ?? 'google/siglip2-base-patch16-224';

    mkdirSync(this.photoDirectory, { recursive: true });
  }

  findAll(date?: string) {
    const query = this.photoRepository
      .createQueryBuilder('photo')
      .orderBy('photo.capturedAt', 'ASC');

    if (date) {
      query.where('date(photo.capturedAt) = :date', { date });
    }

    return query.getMany();
  }

  async findById(id: number): Promise<Photo> {
    const photo = await this.photoRepository.findOne({ where: { id } });
    if (!photo) {
      throw new NotFoundException(`Photo ${id} not found`);
    }

    return photo;
  }

  async findDates(): Promise<PhotoDateCount[]> {
    const rows = await this.photoRepository
      .createQueryBuilder('photo')
      .select('date(photo.capturedAt)', 'date')
      .addSelect('COUNT(photo.id)', 'count')
      .addSelect(
        'SUM(CASE WHEN photo.latitude IS NOT NULL AND photo.longitude IS NOT NULL THEN 1 ELSE 0 END)',
        'gpsCount',
      )
      .addSelect(
        'SUM(CASE WHEN photo.locationInferred = 1 THEN 1 ELSE 0 END)',
        'inferredCount',
      )
      .groupBy('date(photo.capturedAt)')
      .orderBy('date(photo.capturedAt)', 'DESC')
      .getRawMany<PhotoDateRow>();

    return rows
      .filter((row): row is PhotoDateRow & { date: string } => row.date !== null)
      .map((row) => ({
        date: row.date,
        count: Number(row.count),
        gpsCount: Number(row.gpsCount),
        inferredCount: Number(row.inferredCount),
      }));
  }

  async getPreviewPath(id: number): Promise<string> {
    const photo = await this.findById(id);
    return this.ensurePreview(photo);
  }

  async classify(date?: string, limit = 100): Promise<ClassificationResult> {
    const query = this.photoRepository
      .createQueryBuilder('photo')
      .where('photo.category IS NULL')
      .orderBy('photo.capturedAt', 'ASC')
      .take(limit);

    if (date) {
      query.andWhere('date(photo.capturedAt) = :date', { date });
    }

    const photos = await query.getMany();
    if (photos.length === 0) {
      return {
        requested: 0,
        classified: 0,
        device: null,
        results: [],
        failed: [],
      };
    }

    const prepared = await Promise.all(
      photos.map(async (photo): Promise<PreparedClassification> => {
        try {
          return {
            photo,
            input: {
              id: photo.id,
              path: await this.ensurePreview(photo),
            },
            error: null,
          };
        } catch (error) {
          return {
            photo,
            input: null,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      }),
    );

    const inputs: ClassificationInput[] = [];
    const failed: ClassificationResult['failed'] = [];
    for (const item of prepared) {
      if (item.input) inputs.push(item.input);
      else {
        failed.push({
          id: item.photo.id,
          error: item.error ?? 'preview generation failed',
        });
      }
    }

    if (inputs.length === 0) {
      return {
        requested: photos.length,
        classified: 0,
        device: null,
        results: [],
        failed,
      };
    }

    const classifierResponse = await this.runClassifier(inputs);
    const outputById = new Map(
      classifierResponse.results.map((output) => [output.id, output]),
    );
    const results: ClassificationResult['results'] = [];

    for (const item of prepared) {
      if (!item.input) continue;
      const output = outputById.get(item.photo.id);

      if (
        output?.category &&
        typeof output.score === 'number' &&
        Number.isFinite(output.score)
      ) {
        results.push({
          id: item.photo.id,
          category: output.category,
          score: output.score,
        });
      } else {
        failed.push({
          id: item.photo.id,
          error: output?.error ?? 'classifier returned no result',
        });
      }
    }

    if (results.length > 0) {
      await this.photoRepository.manager.transaction(async (manager) => {
        for (const result of results) {
          await manager.update(Photo, result.id, { category: result.category });
        }
      });
    }

    return {
      requested: photos.length,
      classified: results.length,
      device: classifierResponse.device,
      results,
      failed,
    };
  }

  async inferMissingLocations(date: string): Promise<LocationInferenceResult> {
    const photos = await this.findAll(date);
    const missingPhotos = photos.filter(
      (photo) => photo.latitude === null || photo.longitude === null,
    );
    const anchors = photos.filter(
      (photo): photo is Photo & { latitude: number; longitude: number } =>
        photo.latitude !== null &&
        photo.longitude !== null &&
        !photo.locationInferred,
    );

    const results: LocationInferenceResult['results'] = [];

    for (const photo of missingPhotos) {
      let previous: (Photo & { latitude: number; longitude: number }) | null = null;
      let next: (Photo & { latitude: number; longitude: number }) | null = null;

      for (const anchor of anchors) {
        if (anchor.capturedAt <= photo.capturedAt) {
          previous = anchor;
          continue;
        }

        next = anchor;
        break;
      }

      if (!previous || !next) continue;

      const previousGap = photo.capturedAt.getTime() - previous.capturedAt.getTime();
      const nextGap = next.capturedAt.getTime() - photo.capturedAt.getTime();
      if (
        previousGap > LOCATION_INFERENCE_MAX_GAP_MS ||
        nextGap > LOCATION_INFERENCE_MAX_GAP_MS
      ) {
        continue;
      }

      const anchorDistance = haversineDistanceMeters(
        previous.latitude,
        previous.longitude,
        next.latitude,
        next.longitude,
      );
      if (anchorDistance > LOCATION_INFERENCE_MAX_ANCHOR_DISTANCE_METERS) {
        continue;
      }

      const span = next.capturedAt.getTime() - previous.capturedAt.getTime();
      const ratio =
        span > 0
          ? (photo.capturedAt.getTime() - previous.capturedAt.getTime()) / span
          : 0.5;
      const latitude =
        previous.latitude + (next.latitude - previous.latitude) * ratio;
      const longitude =
        previous.longitude + (next.longitude - previous.longitude) * ratio;

      results.push({
        id: photo.id,
        latitude,
        longitude,
        previousPhotoId: previous.id,
        nextPhotoId: next.id,
      });
    }

    if (results.length > 0) {
      await this.photoRepository.manager.transaction(async (manager) => {
        for (const result of results) {
          await manager.update(Photo, result.id, {
            latitude: result.latitude,
            longitude: result.longitude,
            locationInferred: true,
          });
        }
      });
    }

    return {
      date,
      attempted: missingPhotos.length,
      inferred: results.length,
      skipped: missingPhotos.length - results.length,
      maxGapMinutes: LOCATION_INFERENCE_MAX_GAP_MS / 60 / 1000,
      maxAnchorDistanceMeters: LOCATION_INFERENCE_MAX_ANCHOR_DISTANCE_METERS,
      results,
    };
  }

  async clearInferredLocations(
    date: string,
  ): Promise<ClearInferredLocationsResult> {
    const inferredPhotos = await this.photoRepository
      .createQueryBuilder('photo')
      .where('date(photo.capturedAt) = :date', { date })
      .andWhere('photo.locationInferred = 1')
      .orderBy('photo.capturedAt', 'ASC')
      .getMany();

    const clearable = inferredPhotos.filter((photo) => photo.visitId === null);
    const blocked = inferredPhotos.filter((photo) => photo.visitId !== null);

    if (clearable.length > 0) {
      await this.photoRepository.manager.transaction(async (manager) => {
        for (const photo of clearable) {
          await manager.update(Photo, photo.id, {
            latitude: null,
            longitude: null,
            locationInferred: false,
          });
        }
      });
    }

    return {
      date,
      cleared: clearable.length,
      blocked: blocked.length,
      clearedPhotoIds: clearable.map((photo) => photo.id),
      blockedPhotoIds: blocked.map((photo) => photo.id),
    };
  }

  private async ensurePreview(photo: Photo): Promise<string> {
    if (!isAbsolute(photo.path)) {
      const legacyPreviewPath = join(this.photoDirectory, photo.path);
      if (!existsSync(legacyPreviewPath)) {
        throw new NotFoundException(`Preview for photo ${photo.id} not found`);
      }
      return legacyPreviewPath;
    }

    const cachedPath = join(this.photoDirectory, `${photo.hash}.webp`);
    if (existsSync(cachedPath)) return cachedPath;

    const existingJob = this.previewJobs.get(photo.id);
    if (existingJob) return existingJob;

    const job = this.withPreviewSlot(async () => {
      if (existsSync(cachedPath)) return cachedPath;
      if (!existsSync(photo.path)) {
        throw new NotFoundException(`Source photo not found: ${photo.path}`);
      }

      await this.createPreview(photo.path, cachedPath);
      return cachedPath;
    }).finally(() => {
      this.previewJobs.delete(photo.id);
    });

    this.previewJobs.set(photo.id, job);
    return job;
  }

  private async withPreviewSlot<T>(task: () => Promise<T>): Promise<T> {
    if (this.activePreviewJobs >= PREVIEW_CONCURRENCY) {
      await new Promise<void>((resolvePromise) => {
        this.previewWaiters.push(resolvePromise);
      });
    }

    this.activePreviewJobs += 1;
    try {
      return await task();
    } finally {
      this.activePreviewJobs -= 1;
      this.previewWaiters.shift()?.();
    }
  }

  private async createPreview(sourcePath: string, outputPath: string) {
    const extension = extname(sourcePath).toLowerCase();
    let input: string | Buffer = sourcePath;

    if (extension === '.heic' || extension === '.heif') {
      const source = await readFile(sourcePath);
      const jpeg = await convert({ buffer: source, format: 'JPEG', quality: 0.92 });
      input = Buffer.from(jpeg);
    }

    await sharp(input)
      .rotate()
      .resize({
        width: 1600,
        height: 1600,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality: 82 })
      .toFile(outputPath);
  }

  private async runClassifier(
    items: ClassificationInput[],
  ): Promise<ClassifierResponse> {
    return new Promise((resolvePromise, rejectPromise) => {
      const child = spawn(
        this.pythonPath,
        [this.classifierScript, '--model', this.siglipModel],
        {
          cwd: process.cwd(),
          windowsHide: true,
          stdio: ['pipe', 'pipe', 'pipe'],
        },
      );

      let stdout = '';
      let stderr = '';

      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        stdout += chunk;
      });
      child.stderr.on('data', (chunk: string) => {
        stderr += chunk;
      });

      child.once('error', (error) => {
        rejectPromise(
          new ServiceUnavailableException(
            `Could not start Python classifier: ${error.message}`,
          ),
        );
      });

      child.once('close', (code) => {
        if (code !== 0) {
          rejectPromise(
            new ServiceUnavailableException(
              stderr.trim() || `Python classifier exited with code ${code}`,
            ),
          );
          return;
        }

        try {
          resolvePromise(JSON.parse(stdout) as ClassifierResponse);
        } catch {
          rejectPromise(
            new ServiceUnavailableException(
              `Python classifier returned invalid JSON${stderr ? `: ${stderr.trim()}` : ''}`,
            ),
          );
        }
      });

      child.stdin.end(JSON.stringify({ items }));
    });
  }
}

function haversineDistanceMeters(
  latitudeA: number,
  longitudeA: number,
  latitudeB: number,
  longitudeB: number,
) {
  const earthRadius = 6_371_000;
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const latitudeDelta = toRadians(latitudeB - latitudeA);
  const longitudeDelta = toRadians(longitudeB - longitudeA);
  const a =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(toRadians(latitudeA)) *
      Math.cos(toRadians(latitudeB)) *
      Math.sin(longitudeDelta / 2) ** 2;

  return earthRadius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
