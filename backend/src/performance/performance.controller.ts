import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators';
import type { Principal } from '../domain/types';
import { PerformanceService } from './performance.service';

@ApiTags('performance')
@ApiBearerAuth()
@Controller('performance')
export class PerformanceController {
  constructor(private readonly svc: PerformanceService) {}

  @Get('me') @ApiOperation({ summary: "The signed-in worker's own performance (403 for people who do not work tickets)" })
  mine(@CurrentUser() u: Principal, @Query('range') range?: string) {
    return this.svc.mine(u, { range });
  }
}
