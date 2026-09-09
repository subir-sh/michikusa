import { createHash } from 'node:crypto';
import { createReadStream, mkdirSync } from 'node:fs';
import { readFile, readdir, stat } from 'node:fs/promises';
import { basename, extname, join, resolve } from 'node:path';
import { ConflictException, Injectable } from '@nestjs/common';
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
const EXIF_OPTIONS = { exif: true, gps: true } as const;
const IMPORT_CONCURRENCY = 2;

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

export type ImportPhase =
  | 'idle'
  | 'scanning'
  | 'processing'
  | 'completed'
  | 'failed';

export interface ImportProgress {
  phase: ImportPhase;
  total: number;
  processed: number;
  imported: number;
  skipped: number;
  failed: number;
  currentFile: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
}

const IDLE_PROGRESS: ImportProgress = {
  phase: 'idle',
  total: 0,
  processed: 0,
  imported: 0,
  skipped: 0,
  failed: 0,
  currentFile: null,
  startedAt: null,
  finishedAt: null,
  error: null,
};

@Injectable()
export class PhotoImportService {
  private readonly photoDirectory: string;
  private readonly importingHashes = new Set<string>();
  private progress: ImportProgress = { ...IDLE_PROGRESS };

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

  getProgress(): ImportProgress {
    return { ...this.progress };
  }

  async importDirectory(directory: string): Promise<ImportResult> {
    if (
      this.progress.phase === 'scanning' ||
      this.progress.phase === 'processing'
    ) {
      throw new ConflictException('A photo import is already running');
    }

    const startedAt = new Date().toISOString();
    this.progress = {
      ...IDLE_PROGRESS,
      phase: 'scanning',
      startedAt,
    };

    try {
      const sourceDirectory = resolve(directory);
      const sourceStat = await stat(sourceDirectory);
      if (!sourceStat.isDirectory()) {
        throw new Error(`Not a directory: ${sourceDirectory}`);
      }

      const files = await this.collectPhotos(sourceDirectory);
      const result: ImportResult = { imported: 0, skipped: 0, failed: [] };
      this.progress = {
        ...this.progress,
        phase: 'processing',
        total: files.length,
      };

      let nextIndex = 0;
      const workerCount = Math.min(IMPORT_CONCURRENCY, files.length);

      const runWorker = async () => {
        while (true) {
          const index = nextIndex;
          nextIndex += 1;
          if (index >= files.length) return;

          const file = files[index];
          this.progress = {
            ...this.progress,
            currentFile: basename(file),
          };

          try {
            const imported = await this.importFile(file);
            if (imported) result.imported += 1;
            else result.skipped += 1;
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            result.failed.push(`${file}: ${message}`);
          } finally {
            this.progress = {
              ...this.progress,
              processed: this.progress.processed + 1,
              imported: result.imported,
              skipped: result.skipped,
              failed: result.failed.length,
            };
          }
        }
      };

      await Promise.all(Array.from({ length: workerCount }, () => runWorker()));

      this.progress = {
        ...this.progress,
        phase: 'completed',
        processed: files.length,
        imported: result.imported,
        skipped: result.skipped,
        failed: result.failed.length,
        currentFile: null,
        finishedAt: new Date().toISOString(),
      };

      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.progress = {
        ...this.progress,
        phase: 'failed',
        currentFile: null,
        finishedAt: new Date().toISOString(),
        error: message,
      };
      throw error;
    }
  }

  private async importFile(filePath: string): Promise<boolean> {
    const hash = await this.hashFile(filePath);
    if (this.importingHashes.has(hash)) return false;

    this.importingHashes.add(hash);
    try {
      const existing = await this.photoRepository.findOne({ where: { hash } });
      if (existing) return false;

      const metadata = (await exifr.parse(
        filePath,
        EXIF_OPTIONS,
      )) as PhotoMetadata | undefined;
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
    } finally {
      this.importingHashes.delete(hash);
    }
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
}
