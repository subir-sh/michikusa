import {
  BadRequestException,
  Body,
  Controller,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { PhotoMobileSyncService } from './photo-mobile-sync.service';

interface UploadedPhoto {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
  size: number;
}

@Controller('photos/mobile-sync')
export class PhotoMobileSyncController {
  constructor(private readonly mobileSyncService: PhotoMobileSyncService) {}

  @Post()
  @UseInterceptors(
    FileInterceptor('file', {
      limits: {
        files: 1,
        fileSize: 15 * 1024 * 1024,
      },
    }),
  )
  sync(
    @UploadedFile() file: UploadedPhoto | undefined,
    @Body('assetId') assetId?: string,
    @Body('capturedAt') capturedAt?: string,
    @Body('latitude') latitude?: string,
    @Body('longitude') longitude?: string,
    @Body('category') category?: string,
  ) {
    if (!file?.buffer?.length) {
      throw new BadRequestException('file is required');
    }

    if (!file.mimetype.startsWith('image/')) {
      throw new BadRequestException('file must be an image');
    }

    return this.mobileSyncService.sync(file.buffer, {
      assetId,
      capturedAt,
      latitude,
      longitude,
      category,
    });
  }
}
