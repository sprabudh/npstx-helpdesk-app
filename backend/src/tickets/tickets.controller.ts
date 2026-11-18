import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, Res, UploadedFiles, UseInterceptors } from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import type { Response } from 'express';
import { CurrentUser } from '../common/decorators';
import { badRequest } from '../common/errors';
import type { Principal } from '../domain/types';
import { TicketActionsService } from './ticket-actions.service';
import { FILE_RULES, TicketCreateService, UploadedFileLike } from './ticket-create.service';
import { TicketQueryService } from './ticket-query.service';
import {
  CloseDto, CommentDto, CreateTicketDto, DecisionDto, EscalateDto, FollowerDto, ListQueryDto, NoteDto, PriorityDto, ReassignDto, StatusDto,
} from './dto';

const upload = FilesInterceptor('files', FILE_RULES.maxFiles, { limits: { fileSize: FILE_RULES.maxBytes, files: FILE_RULES.maxFiles } });

@ApiTags('tickets')
@ApiBearerAuth()
@Controller('tickets')
export class TicketsController {
  constructor(private readonly q: TicketQueryService, private readonly create: TicketCreateService, private readonly act: TicketActionsService) {}

  @Get() @ApiOperation({ summary: 'My Tickets / Assigned to Me: scope, filters, sort, page' })
  list(@CurrentUser() u: Principal, @Query() query: ListQueryDto) {
    return this.q.list(u, query);
  }
  @Get('search') @ApiOperation({ summary: 'Header search by ticket id or title (visible tickets only)' })
  search(@CurrentUser() u: Principal, @Query('q') q = '') {
    return this.q.search(u, q);
  }
  @Get('related-options') relatedOptions(@CurrentUser() u: Principal) {
    return this.create.relatedOptions(u);
  }
  @Get('people') @ApiOperation({ summary: 'People who can be CC\'d on a helpdesk (Salesforce: Sales, Presales, Solutions only)' })
  people(@CurrentUser() u: Principal, @Query('hd') hd = 'HR', @Query('exclude') exclude = '') {
    return this.create.people(u, hd, [u.id, ...exclude.split(',').filter(Boolean)]);
  }

  @Post() @HttpCode(201) @UseInterceptors(upload) @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Raise a ticket. Multipart: "payload" (JSON CreateTicketDto) and up to 5 "files".' })
  async raise(@CurrentUser() u: Principal, @Body('payload') payload: string, @UploadedFiles() files: UploadedFileLike[] = []) {
    let dto: CreateTicketDto;
    try {
      dto = plainToInstance(CreateTicketDto, typeof payload === 'string' ? JSON.parse(payload) : payload);
    } catch {
      throw badRequest('The request could not be read.', 'VALIDATION');
    }
    const errors = await validate(dto);
    if (errors.length) throw badRequest(errors.map((e) => Object.values(e.constraints ?? {}).join('; ')).join('; '), 'VALIDATION');
    return this.create.create(u, dto, files);
  }

  @Get(':key') @ApiOperation({ summary: 'Ticket detail with what the signed-in person may do (403 when not allowed)' })
  detail(@CurrentUser() u: Principal, @Param('key') key: string) {
    return this.q.detail(u, key);
  }
  @Patch(':key/status') status(@CurrentUser() u: Principal, @Param('key') key: string, @Body() b: StatusDto) {
    return this.act.setStatus(u, key, b.status);
  }
  @Patch(':key/priority') priority(@CurrentUser() u: Principal, @Param('key') key: string, @Body() b: PriorityDto) {
    return this.act.setPriority(u, key, b.priority);
  }
  @Post(':key/reassign') @HttpCode(200) reassign(@CurrentUser() u: Principal, @Param('key') key: string, @Body() b: ReassignDto) {
    return this.act.reassign(u, key, b.assigneeId, b.note);
  }
  @Post(':key/escalate') @HttpCode(200) escalate(@CurrentUser() u: Principal, @Param('key') key: string, @Body() b: EscalateDto) {
    return this.act.escalate(u, key, b.reason);
  }
  @Post(':key/close') @HttpCode(200) close(@CurrentUser() u: Principal, @Param('key') key: string, @Body() b: CloseDto) {
    return this.act.close(u, key, b);
  }
  @Post(':key/reopen') @HttpCode(200) reopen(@CurrentUser() u: Principal, @Param('key') key: string, @Body() b: NoteDto) {
    return this.act.reopen(u, key, b.note ?? '');
  }
  @Post(':key/cancel') @HttpCode(200) cancel(@CurrentUser() u: Principal, @Param('key') key: string, @Body() b: NoteDto) {
    return this.act.cancel(u, key, b.note);
  }
  @Post(':key/confirm') @HttpCode(200) confirm(@CurrentUser() u: Principal, @Param('key') key: string) {
    return this.act.confirm(u, key);
  }
  @Post(':key/follow') @HttpCode(200) follow(@CurrentUser() u: Principal, @Param('key') key: string) {
    return this.act.follow(u, key);
  }
  @Post(':key/followers') @HttpCode(200) addFollower(@CurrentUser() u: Principal, @Param('key') key: string, @Body() b: FollowerDto) {
    return this.act.addFollower(u, key, b.userId, b.relation);
  }
  @Delete(':key/followers/:userId') removeFollower(@CurrentUser() u: Principal, @Param('key') key: string, @Param('userId') userId: string) {
    return this.act.removeFollower(u, key, userId);
  }
  @Post(':key/comments') @HttpCode(201) comment(@CurrentUser() u: Principal, @Param('key') key: string, @Body() b: CommentDto) {
    return this.act.comment(u, key, b.body, !!b.internal);
  }
  @Post(':key/attachments') @HttpCode(201) @UseInterceptors(upload) @ApiConsumes('multipart/form-data')
  attach(@CurrentUser() u: Principal, @Param('key') key: string, @UploadedFiles() files: UploadedFileLike[] = []) {
    return this.act.attach(u, key, files);
  }
  @Post(':key/approval') @HttpCode(200) decide(@CurrentUser() u: Principal, @Param('key') key: string, @Body() b: DecisionDto) {
    return this.act.decide(u, key, b.decision, b.note);
  }
}

@ApiTags('tickets')
@ApiBearerAuth()
@Controller()
export class TicketViewsController {
  constructor(private readonly q: TicketQueryService, private readonly act: TicketActionsService) {}

  @Get('attachments/:id/download') @ApiOperation({ summary: 'Download a file (requires access to its ticket)' })
  async download(@CurrentUser() u: Principal, @Param('id') id: string, @Res() res: Response) {
    const f = await this.act.download(u, Number(id));
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(f.name)}"`);
    if (f.mime) res.setHeader('Content-Type', f.mime);
    res.sendFile(f.path);
  }
  @Get('approvals/pending') pending(@CurrentUser() u: Principal) {
    return this.q.pendingApprovals(u);
  }
  @Get('following') following(@CurrentUser() u: Principal, @Query('rel') rel?: string, @Query('src') src?: string, @Query('grp') grp?: string) {
    return this.q.following(u, { rel, src, grp });
  }
  @Get('history') history(@CurrentUser() u: Principal, @Query() q: Record<string, string>) {
    return this.q.history(u, q);
  }
}
