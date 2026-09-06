import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, mkdirSync } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import {
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
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

interface PhotoMetadata {
  DateTimeOriginal?: Date;
  CreateDate?: Date;
  latitude?: number;
  longitude?: number;
}

interface PhotoDateRow {
  date: string | null;
  count: number | string;
  gpsCount: number | string;
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

export interface PhotoDateCount {
  date: string;
  count: number;
  gpsCount: number;
}

export interface ImportResult {
  imported: number;
  skipped: number;
  failed: string[];
}

export interface ClassificationResult {
  requested: number;
  classified: number;
  device: 'cpu' | 'cuda' | null;
  results: Array<{ id: number; category: string; score: number }>;
  failed: Array<{ id: number; error: string }>;
}

@Injectable()
export class PhotoService {
  private readonly photoDirectory: string;
  private readonly pythonPath: string;
  private readonly classifierScript: string;
  private readonly siglipModel: string;

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
      .groupBy('date(photo.capturedAt)')
      .orderBy('date(photo.capturedAt)', 'DESC')
      .getRawMany<PhotoDateRow>();

    return rows
      .filter((row): row is PhotoDateRow & { date: string } => row.date !== null)
      .map((row) => ({
        date: row.date,
        count: Number(row.count),
        gpsCount: Number(row.gpsCount),
      }));
  }

  async getPreviewPath(id: number): Promise<string> {
    const photo = await this.findById(id);
    return join(this.photoDirectory, photo.path);
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

    const classifierResponse = await this.runClassifier(
      photos.map((photo) => ({
        id: photo.id,
        path: join(this.photoDirectory, photo.path),
      })),
    );

    const outputById = new Map(
      classifierResponse.results.map((output) => [output.id, output]),
    );
    const results: ClassificationResult['results'] = [];
    const failed: ClassificationResult['failed'] = [];

    for (const photo of photos) {
      const output = outputById.get(photo.id);

      if (
        output?.category &&
        typeof output.score === 'number' &&
        Number.isFinite(output.score)
      ) {
        results.push({
          id: photo.id,
          category: output.category,
          score: output.score,
        });
      } else {
        failed.push({
          id: photo.id,
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

  private async importFile(filePath: string): Promise<boolean> {
    const hash = await this.hashFile(filePath);
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
