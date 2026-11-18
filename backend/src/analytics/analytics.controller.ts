import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators';
import type { Principal } from '../domain/types';
import { AnalyticsService } from './analytics.service';

@ApiTags('analytics')
@ApiBearerAuth()
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly svc: AnalyticsService) {}
  @Get() @ApiOperation({ summary: 'Dashboard cards and charts. scope=own|work|org, hd=ALL|HR|..., range=7|30|90|year' })
  get(@CurrentUser() u: Principal, @Query('scope') scope?: string, @Query('hd') hd?: string, @Query('range') range?: string) {
    return this.svc.get(u, scope, hd, range);
  }
}
