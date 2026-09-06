import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PhotoModule } from '../photo/photo.module';
import { PlaceController } from './place.controller';
import { Place } from './place.entity';
import { PlaceService } from './place.service';

@Module({
  imports: [TypeOrmModule.forFeature([Place]), PhotoModule],
  controllers: [PlaceController],
  providers: [PlaceService],
  exports: [TypeOrmModule],
})
export class PlaceModule {}
