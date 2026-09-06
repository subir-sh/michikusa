import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { VisitService } from './visit.service';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_PATTERN = /^\d{4}-\d{2}$/;
const YEAR_PATTERN = /^\d{4}$/;

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

  @Get('summary')
  findSummary(
    @Query('month') month?: string,
    @Query('year') year?: string,
  ) {
    if (month && year) {
      throw new BadRequestException('use either month or year, not both');
    }
    if (month) {
      if (!MONTH_PATTERN.test(month)) {
        throw new BadRequestException('month must be YYYY-MM');
      }
      return this.visitService.findPeriodSummary(month, 'month');
    }
    if (year) {
      if (!YEAR_PATTERN.test(year)) {
        throw new BadRequestException('year must be YYYY');
      }
      return this.visitService.findPeriodSummary(year, 'year');
    }

    throw new BadRequestException('month or year is required');
  }
}
