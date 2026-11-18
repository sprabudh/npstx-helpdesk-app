import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, Length } from 'class-validator';
import { CurrentUser } from '../common/decorators';
import type { Principal } from '../domain/types';
import { FaqService } from './faq.service';

export class VoteDto { @ApiProperty() @IsBoolean() helpful: boolean }
export class FaqUpdateDto {
  @ApiProperty() @IsString() @Length(5, 300) question: string;
  @ApiProperty() @IsString() @Length(5, 4000) answer: string;
  @ApiPropertyOptional() @IsOptional() @IsString() categoryKey?: string | null;
}

@ApiTags('faq')
@ApiBearerAuth()
@Controller('faqs')
export class FaqController {
  constructor(private readonly svc: FaqService) {}
  @Get() list(@CurrentUser() u: Principal, @Query('helpdesk') hd = 'HR') {
    return this.svc.list(u, hd);
  }
  @Post(':id/vote') @HttpCode(200) vote(@CurrentUser() u: Principal, @Param('id', ParseIntPipe) id: number, @Body() b: VoteDto) {
    return this.svc.vote(u, id, b.helpful);
  }
  @Put(':id') update(@CurrentUser() u: Principal, @Param('id', ParseIntPipe) id: number, @Body() b: FaqUpdateDto) {
    return this.svc.update(u, id, b);
  }
}
