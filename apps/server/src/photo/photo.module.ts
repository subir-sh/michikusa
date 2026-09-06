import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PhotoController } from './photo.controller';
import { PhotoDiagnosticsService } from './photo-diagnostics.service';
import { Photo } from './photo.entity';
import { PhotoService } from './photo.service';

@Module({
  imports: [TypeOrmModule.forFeature([Photo])],
  controllers: [PhotoController],
  providers: [PhotoService, PhotoDiagnosticsService],
  exports: [PhotoService],
})
export class PhotoModule {}
