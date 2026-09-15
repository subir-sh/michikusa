import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PhotoController } from './photo.controller';
import { PhotoDiagnosticsService } from './photo-diagnostics.service';
import { PhotoImportService } from './photo-import.service';
import { PhotoMobileSyncController } from './photo-mobile-sync.controller';
import { PhotoMobileSyncService } from './photo-mobile-sync.service';
import { Photo } from './photo.entity';
import { PhotoService } from './photo.service';

@Module({
  imports: [TypeOrmModule.forFeature([Photo])],
  controllers: [PhotoController, PhotoMobileSyncController],
  providers: [
    PhotoService,
    PhotoDiagnosticsService,
    PhotoImportService,
    PhotoMobileSyncService,
  ],
  exports: [PhotoService],
})
export class PhotoModule {}
