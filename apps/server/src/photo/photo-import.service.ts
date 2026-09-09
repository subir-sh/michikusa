import { createHash } from 'node:crypto';
import { readdir, stat } from 'node:fs/promises';
import { basename, extname, join, resolve } from 'node:path';
import { ConflictException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as exifr from 'exifr';
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
const IMPORT_CONCURRENCY = 8;

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
  lastFailure: string | null;
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
  lastFailure: null,
  startedAt: null,
  finishedAt: null,
  error: null,
};

@Injectable()
export class PhotoImportService {
  private readonly importingFingerprints = new Set<string>();
  private progress: ImportProgress = { ...IDLE_PROGRESS };

  constructor(
    @InjectRepository(Photo)
    private readonly photoRepository: Repository<Photo>,
  ) {}

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
            const failure = `${file}: ${message}`;
            result.failed.push(failure);
            this.progress = {
              ...this.progress,
              lastFailure: failure,
            };
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
    const sourcePath = resolve(filePath);
    const fileStat = await stat(sourcePath);
    const fingerprint = this.createFingerprint(
      sourcePath,
      fileStat.size,
      fileStat.mtimeMs,
    );

    if (this.importingFingerprints.has(fingerprint)) return false;

    this.importingFingerprints.add(fingerprint);
    try {
      const existing = await this.photoRepository.findOne({
        where: { hash: fingerprint },
      });
      if (existing) return false;

      const metadata = (await exifr.parse(
        sourcePath,
        EXIF_OPTIONS,
      )) as PhotoMetadata | undefined;
      const capturedAt =
        metadata?.DateTimeOriginal ?? metadata?.CreateDate ?? fileStat.mtime;

      const photo = this.photoRepository.create({
        hash: fingerprint,
        path: sourcePath,
        capturedAt,
        latitude: metadata?.latitude ?? null,
        longitude: metadata?.longitude ?? null,
        locationInferred: false,
        category: null,
      });

      await this.photoRepository.save(photo);
      return true;
    } finally {
      this.importingFingerprints.delete(fingerprint);
    }
  }

  private createFingerprint(
    sourcePath: string,
    size: number,
    modifiedAtMs: number,
  ): string {
    const normalizedPath =
      process.platform === 'win32' ? sourcePath.toLowerCase() : sourcePath;

    return createHash('sha256')
      .update(normalizedPath)
      .update('\0')
      .update(String(size))
      .update('\0')
      .update(String(Math.trunc(modifiedAtMs)))
      .digest('hex');
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
}
