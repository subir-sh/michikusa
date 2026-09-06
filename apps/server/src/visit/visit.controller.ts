import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { VisitService } from './visit.service';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

@Controller('visits')
export class VisitController {
  constructor(private readonly visitService: VisitService) {}

  @Get()
  findByDate(@Query('date') date?: string) {
    if (!date || !DATE_PATTERN.test(date)) {
      throw new BadRequestException('date must be YYYY-MM-DD');
    }

    return this.visitService.findByDate(date);
  }
}
