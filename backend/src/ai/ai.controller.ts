import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, Length } from 'class-validator';
import { CurrentUser } from '../common/decorators';
import type { Principal } from '../domain/types';
import { AiService } from './ai.service';

export class AskDto { @ApiProperty() @IsString() @Length(1, 500) q: string; @ApiPropertyOptional({ description: 'false = live search only' }) @IsOptional() @IsBoolean() full?: boolean }
export class SuggestDto { @ApiProperty() @IsString() @Length(1, 4000) text: string; @ApiPropertyOptional() @IsOptional() @IsString() helpdesk?: string }
export class DraftDto { @ApiProperty() @IsString() @Length(1, 4000) transcript: string; @ApiPropertyOptional() @IsOptional() @IsString() helpdesk?: string }

@ApiTags('ai')
@ApiBearerAuth()
@Controller('ai')
export class AiController {
  constructor(private readonly ai: AiService) {}
  @Get('status') status() {
    return this.ai.status();
  }
  @Post('ask') @HttpCode(200) @ApiOperation({ summary: 'Dashboard AI bar: search (full=false) or answer (full=true). 503 AI_DISABLED when off.' })
  ask(@CurrentUser() u: Principal, @Body() b: AskDto) {
    return this.ai.ask(u, b.q, b.full !== false);
  }
  @Post('faq-suggestions') @HttpCode(200) @ApiOperation({ summary: 'FAQs that may answer the text before a ticket is raised' })
  suggest(@CurrentUser() u: Principal, @Body() b: SuggestDto) {
    return this.ai.faqSuggest(u, b.text, b.helpdesk);
  }
  @Post('draft') @HttpCode(200) @ApiOperation({ summary: 'Fill the raise form from a transcript or typed text' })
  draft(@CurrentUser() u: Principal, @Body() b: DraftDto) {
    return this.ai.draft(u, b.transcript, b.helpdesk);
  }
  @Post('summarise/:key') @HttpCode(200) @ApiOperation({ summary: 'Summarise a ticket activity feed the person can see' })
  summarise(@CurrentUser() u: Principal, @Param('key') key: string) {
    return this.ai.summarise(u, key);
  }
}
