import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, Length, Max, Min } from 'class-validator';
import { CurrentUser, RequireAnyRole } from '../common/decorators';
import type { Principal } from '../domain/types';
import { SlaScheduler } from '../sla/sla.scheduler';
import { AuditService } from '../audit/audit.service';
import { AdminService } from './admin.service';

export class CategoryDto {
  @ApiProperty() @IsString() helpdesk: string;
  @ApiProperty() @IsString() @Length(0, 120) name: string;
  @ApiProperty({ type: [String] }) @IsArray() @IsString({ each: true }) subs: string[];
  @ApiPropertyOptional() @IsOptional() @IsString() defaultPriority?: string;
  @ApiPropertyOptional({ description: 'Category lead (HR, IT, Admin Desk) or owner / queue (L&D, Salesforce)' }) @IsOptional() @IsString() ownerId?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() confidential?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() reopenAllowed?: boolean;
  @ApiPropertyOptional({ enum: ['portal', 'course'] }) @IsOptional() @IsIn(['portal', 'course']) requestType?: string;
}
export class ActiveDto { @ApiProperty() @IsBoolean() active: boolean }
export class LeadDto { @ApiProperty() @IsString() userId: string }
export class FieldDto {
  @ApiProperty() @IsString() helpdesk: string;
  @ApiProperty() @IsString() categoryKey: string;
  @ApiProperty() @IsString() @Length(0, 120) label: string;
  @ApiProperty({ enum: ['text', 'number', 'date', 'month', 'datetime-local', 'select'] }) @IsIn(['text', 'number', 'date', 'month', 'datetime-local', 'select']) type: string;
  @ApiPropertyOptional() @IsOptional() @IsString() placeholder?: string;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @IsString({ each: true }) options?: string[];
  @ApiPropertyOptional() @IsOptional() @IsBoolean() required?: boolean;
}
export class FieldPatchDto { @ApiPropertyOptional() @IsOptional() @IsBoolean() required?: boolean; @ApiPropertyOptional() @IsOptional() @IsBoolean() active?: boolean }
export class SlaDto {
  @ApiProperty({ enum: ['shared', 'IT', 'ADM'] }) @IsIn(['shared', 'IT', 'ADM']) table: 'shared' | 'IT' | 'ADM';
  @ApiProperty() @IsString() priority: string;
  @ApiProperty({ enum: [0, 1] }) @IsIn([0, 1]) index: 0 | 1;
  @ApiProperty() @IsNumber() @Min(0.5) @Max(2000) hours: number;
}
export class RuleDto { @ApiProperty() @IsString() key: string; @ApiProperty() @IsBoolean() value: boolean }
export class EscalationDto {
  @ApiProperty() @IsString() helpdesk: string;
  @ApiProperty() @IsInt() @Min(0) @Max(5) level: number;
  @ApiPropertyOptional() @IsOptional() @IsString() who?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(10) @Max(100) pct?: number;
}
export class RolesDto { @ApiProperty({ type: [String] }) @IsArray() @IsString({ each: true }) roles: string[]; @ApiProperty({ type: [String] }) @IsArray() @IsString({ each: true }) hrCategories: string[] }

@ApiTags('admin')
@ApiBearerAuth()
@RequireAnyRole('HD_ADMIN')
@Controller('admin')
export class AdminController {
  constructor(private readonly svc: AdminService, private readonly sla: SlaScheduler, private readonly audit: AuditService) {}

  @Get() overview(@CurrentUser() u: Principal) {
    return this.svc.overview(u);
  }
  @Post('categories') @HttpCode(201) addCategory(@CurrentUser() u: Principal, @Body() b: CategoryDto) {
    return this.svc.saveCategory(u, null, b);
  }
  @Put('categories/:id') editCategory(@CurrentUser() u: Principal, @Param('id', ParseIntPipe) id: number, @Body() b: CategoryDto) {
    return this.svc.saveCategory(u, id, b);
  }
  @Patch('categories/:id/active') active(@CurrentUser() u: Principal, @Param('id', ParseIntPipe) id: number, @Body() b: ActiveDto) {
    return this.svc.setCategoryActive(u, id, b.active);
  }
  @Patch('categories/:id/lead') lead(@CurrentUser() u: Principal, @Param('id', ParseIntPipe) id: number, @Body() b: LeadDto) {
    return this.svc.setCategoryLead(u, id, b.userId);
  }
  @Post('fields') @HttpCode(201) addField(@CurrentUser() u: Principal, @Body() b: FieldDto) {
    return this.svc.saveField(u, null, b);
  }
  @Put('fields/:id') editField(@CurrentUser() u: Principal, @Param('id', ParseIntPipe) id: number, @Body() b: FieldDto) {
    return this.svc.saveField(u, id, b);
  }
  @Patch('fields/:id') patchField(@CurrentUser() u: Principal, @Param('id', ParseIntPipe) id: number, @Body() b: FieldPatchDto) {
    return this.svc.patchField(u, id, b);
  }
  @Delete('fields/:id') deleteField(@CurrentUser() u: Principal, @Param('id', ParseIntPipe) id: number) {
    return this.svc.deleteField(u, id);
  }
  @Put('sla') setSla(@CurrentUser() u: Principal, @Body() b: SlaDto) {
    return this.svc.setSla(u, b);
  }
  @Put('rules') setRule(@CurrentUser() u: Principal, @Body() b: RuleDto) {
    return this.svc.setRule(u, b.key, b.value);
  }
  @Put('escalation') setEscalation(@CurrentUser() u: Principal, @Body() b: EscalationDto) {
    return this.svc.setEscalation(u, b);
  }
  @Put('people/:id/roles') setRoles(@CurrentUser() u: Principal, @Param('id') id: string, @Body() b: RolesDto) {
    return this.svc.setRoles(u, id, b);
  }
  @Get('audit') auditLog() {
    return this.audit.list(100);
  }
  @Get('performance') performance(@CurrentUser() u: Principal, @Query('hd') hd?: string, @Query('range') range?: string, @Query('q') q?: string) {
    return this.svc.performance(u, { hd, range, q });
  }
  @Post('sla/run') @HttpCode(200) async runSla(@CurrentUser() u: Principal) {
    const r = await this.sla.tick();
    await this.audit.record(u.id, 'sla.run', `Ran the SLA check: ${r.escalated} escalated, ${r.responseBreaches} response breaches`);
    return { ...r, toast: `SLA check done: ${r.escalated} escalation${r.escalated === 1 ? '' : 's'}, ${r.responseBreaches} response breach${r.responseBreaches === 1 ? '' : 'es'}, ${r.warnings} warning${r.warnings === 1 ? '' : 's'}` };
  }
}
