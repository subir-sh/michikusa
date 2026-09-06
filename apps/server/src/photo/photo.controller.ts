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
import { PhotoService } from './photo.service';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

@Controller('photos')
export class PhotoController {
  constructor(private readonly photoService: PhotoService) {}

  @Get('dates')
  findDates() {
    return this.photoService.findDates();
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

  @Post('import')
  importDirectory(@Body('directory') directory?: string) {
    if (!directory?.trim()) {
      throw new BadRequestException('directory is required');
    }

    return this.photoService.importDirectory(directory.trim());
  }
}
