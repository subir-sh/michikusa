import { Body, Controller, Get, Post } from '@nestjs/common';
import { PhotoService } from './photo.service';

@Controller('photos')
export class PhotoController {
  constructor(private readonly photoService: PhotoService) {}

  @Get()
  findAll() {
    return this.photoService.findAll();
  }

  @Post('import')
  importDirectory(@Body('directory') directory: string) {
    return this.photoService.importDirectory(directory);
  }
}
