import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { sharp } from './sharp';
import { Repository } from 'typeorm';
import { Photo } from './photo.entity';

const MOBILE_CATEGORIES = new Set([
  'food',
  'restaurant',
  'landmark',
  'accommodation',
  'transit',
  'nature',
  'street',
]);

interface MobileSyncInput {
  assetId?: string;
  capturedAt?: string;
  latitude?: string;
  longitude?: string;
  category?: string;
}

@Injectable()
export class PhotoMobileSyncService {
  private readonly photoDirectory: string;

  constructor(
    @InjectRepository(Photo)
    private readonly photoRepository: Repository<Photo>,
    config: ConfigService,
  ) {
    this.photoDirectory = resolve(
      process.cwd(),
      config.get<string>('PHOTO_DATA_PATH') ?? '../../data/photos',
    );
    mkdirSync(this.photoDirectory, { recursive: true });
  }

  async sync(buffer: Buffer, input: MobileSyncInput) {
    const assetId = input.assetId?.trim();
    if (!assetId) throw new BadRequestException('assetId is required');

    const capturedAt = new Date(input.capturedAt ?? '');
    if (Number.isNaN(capturedAt.getTime())) {
      throw new BadRequestException('capturedAt must be a valid ISO date');
    }

    const category = input.category?.trim();
    if (!category || !MOBILE_CATEGORIES.has(category)) {
      throw new BadRequestException('category is not a supported POI category');
    }

    const latitude = this.parseCoordinate(input.latitude, -90, 90, 'latitude');
    const longitude = this.parseCoordinate(
      input.longitude,
      -180,
      180,
      'longitude',
    );

    const hash = createHash('sha256')
      .update('mobile:')
      .update(assetId)
      .digest('hex');

    const existing = await this.photoRepository.findOne({ where: { hash } });
    if (existing) {
      return {
        status: 'skipped' as const,
        photoId: existing.id,
      };
    }

    const filename = `${hash}.webp`;
    const outputPath = join(this.photoDirectory, filename);

    await sharp(buffer)
      .rotate()
      .resize({
        width: 1600,
        height: 1600,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality: 84 })
      .toFile(outputPath);

    const photo = this.photoRepository.create({
      hash,
      path: filename,
      capturedAt,
      latitude,
      longitude,
      locationInferred: false,
      category,
      visitId: null,
    });

    const saved = await this.photoRepository.save(photo);
    return {
      status: 'imported' as const,
      photoId: saved.id,
    };
  }

  private parseCoordinate(
    rawValue: string | undefined,
    min: number,
    max: number,
    name: string,
  ): number | null {
    if (!rawValue?.trim()) return null;

    const value = Number(rawValue);
    if (!Number.isFinite(value) || value < min || value > max) {
      throw new BadRequestException(`${name} is invalid`);
    }

    return value;
  }
}
