import {
  BadRequestException,
  Body,
  Controller,
  Get,
  ParseIntPipe,
  Post,
  Query,
} from '@nestjs/common';
import { PlaceService } from './place.service';

@Controller('places')
export class PlaceController {
  constructor(private readonly placeService: PlaceService) {}

  @Get('candidates')
  findCandidates(@Query('photoId', ParseIntPipe) photoId: number) {
    return this.placeService.findCandidates(photoId);
  }

  @Post('confirm')
  confirm(
    @Body('photoId') photoId?: number,
    @Body('googlePlaceId') googlePlaceId?: string,
  ) {
    if (!Number.isInteger(photoId)) {
      throw new BadRequestException('photoId must be an integer');
    }
    if (!googlePlaceId?.trim()) {
      throw new BadRequestException('googlePlaceId is required');
    }

    return this.placeService.confirm(photoId as number, googlePlaceId.trim());
  }
}
