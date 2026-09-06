import { Controller, Get, ParseIntPipe, Query } from '@nestjs/common';
import { PlaceService } from './place.service';

@Controller('places')
export class PlaceController {
  constructor(private readonly placeService: PlaceService) {}

  @Get('candidates')
  findCandidates(@Query('photoId', ParseIntPipe) photoId: number) {
    return this.placeService.findCandidates(photoId);
  }
}
