import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PhotoController } from './photo.controller';
import { PhotoDiagnosticsService } from './photo-diagnostics.service';
import { PhotoImportService } from './photo-import.service';
import { Photo } from './photo.entity';
import { PhotoService } from './photo.service';

@Module({
  imports: [TypeOrmModule.forFeature([Photo])],
  controllers: [PhotoController],
  providers: [PhotoService, PhotoDiagnosticsService, PhotoImportService],
  exports: [PhotoService],
})
export class PhotoModule {}
