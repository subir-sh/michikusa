import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Place } from './place.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Place])],
  exports: [TypeOrmModule],
})
export class PlaceModule {}
