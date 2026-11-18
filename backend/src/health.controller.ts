import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { clock } from './common/clock';
import { Public } from './common/decorators';
import { ProvidersRegistry } from './providers/providers.registry';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(@InjectDataSource() private readonly ds: DataSource, private readonly providers: ProvidersRegistry) {}
  @Public() @Get()
  async health() {
    await this.ds.query('SELECT 1');
    return { status: 'ok', now: clock.now(), providers: this.providers.describe() };
  }
}
