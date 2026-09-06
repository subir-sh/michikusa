import { createReadStream } from 'node:fs';
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  Param,
  ParseIntPipe,
  Post,
  Query,
  StreamableFile,
} from '@nestjs/common';
import { PhotoDiagnosticsService } from './photo-diagnostics.service';
import { PhotoService } from './photo.service';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

@Controller('photos')
export class PhotoController {
  constructor(
    private readonly photoService: PhotoService,
    private readonly diagnosticsService: PhotoDiagnosticsService,
  ) {}

  @Get('dates')
  findDates() {
    return this.photoService.findDates();
  }

  @Get('diagnostics')
  diagnostics() {
    return this.diagnosticsService.getDiagnostics();
  }

  @Get()
  findAll(@Query('date') date?: string) {
    if (date && !DATE_PATTERN.test(date)) {
      throw new BadRequestException('date must be YYYY-MM-DD');
    }

    return this.photoService.findAll(date);
  }

  @Get(':id/preview')
  @Header('Content-Type', 'image/webp')
  async preview(@Param('id', ParseIntPipe) id: number) {
    const path = await this.photoService.getPreviewPath(id);
    return new StreamableFile(createReadStream(path));
  }

  @Post('classify')
  classify(
    @Body('date') date?: string,
    @Body('limit') rawLimit?: number,
  ) {
    if (date && !DATE_PATTERN.test(date)) {
      throw new BadRequestException('date must be YYYY-MM-DD');
    }

    const limit = rawLimit ?? 100;
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
      throw new BadRequestException('limit must be an integer between 1 and 200');
    }

    return this.photoService.classify(date, limit);
  }

  @Post('infer-locations')
  inferLocations(@Body('date') date?: string) {
    if (!date || !DATE_PATTERN.test(date)) {
      throw new BadRequestException('date must be YYYY-MM-DD');
    }

    return this.photoService.inferMissingLocations(date);
  }

  @Post('clear-inferred-locations')
  clearInferredLocations(@Body('date') date?: string) {
    if (!date || !DATE_PATTERN.test(date)) {
      throw new BadRequestException('date must be YYYY-MM-DD');
    }

    return this.photoService.clearInferredLocations(date);
  }

  @Post('import')
  importDirectory(@Body('directory') directory?: string) {
    if (!directory?.trim()) {
      throw new BadRequestException('directory is required');
    }

    return this.photoService.importDirectory(directory.trim());
  }
}
