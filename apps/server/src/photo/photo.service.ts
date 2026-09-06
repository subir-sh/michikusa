import { createHash } from 'node:crypto';
import { createReadStream, mkdirSync } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import * as exifr from 'exifr';
import convert = require('heic-convert');
import sharp from 'sharp';
import { Repository } from 'typeorm';
import { Photo } from './photo.entity';

const SUPPORTED_EXTENSIONS = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
  '.avif',
  '.heic',
  '.heif',
]);

interface PhotoMetadata {
  DateTimeOriginal?: Date;
  CreateDate?: Date;
  latitude?: number;
  longitude?: number;
}

export interface ImportResult {
  imported: number;
  skipped: number;
  failed: string[];
}

@Injectable()
export class PhotoService {
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

  findAll() {
    return this.photoRepository.find({ order: { capturedAt: 'ASC' } });
  }

  async importDirectory(directory: string): Promise<ImportResult> {
    const sourceDirectory = resolve(directory);
    const sourceStat = await stat(sourceDirectory);

    if (!sourceStat.isDirectory()) {
      throw new Error(`Not a directory: ${sourceDirectory}`);
    }

    const files = await this.collectPhotos(sourceDirectory);
    const result: ImportResult = { imported: 0, skipped: 0, failed: [] };

    for (const file of files) {
      try {
        const imported = await this.importFile(file);
        if (imported) result.imported += 1;
        else result.skipped += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        result.failed.push(`${file}: ${message}`);
      }
    }

    return result;
  }

  private async importFile(filePath: string): Promise<boolean> {
    const hash = await this.hashFile(filePath);
    const existing = await this.photoRepository.findOne({ where: { hash } });
    if (existing) return false;

    const metadata = (await exifr.parse(filePath, {
      exif: true,
      gps: true,
    })) as PhotoMetadata | undefined;

    const fileStat = await stat(filePath);
    const capturedAt =
      metadata?.DateTimeOriginal ?? metadata?.CreateDate ?? fileStat.mtime;

    const previewName = `${hash}.webp`;
    await this.createPreview(filePath, join(this.photoDirectory, previewName));

    const photo = this.photoRepository.create({
      hash,
      path: previewName,
      capturedAt,
      latitude: metadata?.latitude ?? null,
      longitude: metadata?.longitude ?? null,
      locationInferred: false,
      category: null,
    });

    await this.photoRepository.save(photo);
    return true;
  }

  private async collectPhotos(directory: string): Promise<string[]> {
    const entries = await readdir(directory, { withFileTypes: true });
    const files: string[] = [];

    for (const entry of entries) {
      const path = join(directory, entry.name);

      if (entry.isDirectory()) {
        files.push(...(await this.collectPhotos(path)));
      } else if (
        entry.isFile() &&
        SUPPORTED_EXTENSIONS.has(extname(entry.name).toLowerCase())
      ) {
        files.push(path);
      }
    }

    return files.sort();
  }

  private async hashFile(filePath: string): Promise<string> {
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(filePath)) hash.update(chunk);
    return hash.digest('hex');
  }

  private async createPreview(sourcePath: string, outputPath: string) {
    const extension = extname(sourcePath).toLowerCase();

    let image: sharp.Sharp;
    if (extension === '.heic' || extension === '.heif') {
      const source = await readFile(sourcePath);
      const jpeg = await convert({ buffer: source, format: 'JPEG', quality: 0.92 });
      image = sharp(jpeg);
    } else {
      image = sharp(sourcePath);
    }

    await image
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
}
