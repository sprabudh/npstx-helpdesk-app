import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsIn, IsInt, IsObject, IsOptional, IsString, Length, MaxLength, Min } from 'class-validator';

export class ListQueryDto {
  @ApiPropertyOptional({ description: 'mine | assigned | queue | queues | unassigned | approvals | hrall | all | org' }) @IsOptional() @IsString() view?: string;
  @ApiPropertyOptional({ description: 'ALL or a helpdesk key' }) @IsOptional() @IsString() hd?: string;
  @ApiPropertyOptional({ enum: ['open', 'closed'] }) @IsOptional() @IsIn(['open', 'closed']) tab?: 'open' | 'closed';
  @ApiPropertyOptional({ description: 'HD.CAT, for example IT.HW' }) @IsOptional() @IsString() cat?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() pri?: string;
  @ApiPropertyOptional({ description: 'A helpdesk status, or ui:<Open|In Progress|Pending Input>' }) @IsOptional() @IsString() status?: string;
  @ApiPropertyOptional({ description: 'Closing response filter (closed tab)' }) @IsOptional() @IsString() reason?: string;
  @ApiPropertyOptional({ description: 'escalated | breached | atrisk | overdue | reopened | unassigned | month | waitingme' }) @IsOptional() @IsString() flag?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) q?: string;
  @ApiPropertyOptional({ description: 'YYYY-MM-DD' }) @IsOptional() @IsString() from?: string;
  @ApiPropertyOptional({ description: 'YYYY-MM-DD' }) @IsOptional() @IsString() to?: string;
  @ApiPropertyOptional({ enum: ['key', 'pri', 'updated', 'created', 'sla', 'closed'] }) @IsOptional() @IsString() sort?: string;
  @ApiPropertyOptional({ enum: ['asc', 'desc'] }) @IsOptional() @IsIn(['asc', 'desc']) dir?: 'asc' | 'desc';
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) size?: number;
}

export class CreateTicketDto {
  @ApiProperty({ enum: ['HR', 'LND', 'IT', 'ADM', 'SF'] }) @IsIn(['HR', 'LND', 'IT', 'ADM', 'SF']) helpdesk: 'HR' | 'LND' | 'IT' | 'ADM' | 'SF';
  @ApiProperty({ description: 'cat, sub, title, desc, pri and the category fields', type: 'object', additionalProperties: { type: 'string' } }) @IsObject() fields: Record<string, string>;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @IsString({ each: true }) cc?: string[];
  @ApiPropertyOptional() @IsOptional() @IsBoolean() mgrCc?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() related?: string | null;
  @ApiPropertyOptional({ description: 'Voice transcript, stored only when submitted' }) @IsOptional() @IsString() @MaxLength(4000) aiTranscript?: string | null;
}
export class StatusDto { @ApiProperty() @IsString() @Length(1, 40) status: string }
export class PriorityDto { @ApiProperty() @IsString() @Length(1, 12) priority: string }
export class ReassignDto { @ApiProperty() @IsString() assigneeId: string; @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) note?: string }
export class EscalateDto { @ApiProperty() @IsString() @MaxLength(2000) reason: string }
export class CloseDto {
  @ApiProperty({ description: 'Closed (HR, SF) or Resolved / Rejected (L&D, IT, Admin Desk)' }) @IsString() to: string;
  @ApiPropertyOptional({ enum: ['Resolved', 'Rejected', 'Cancelled', 'Duplicate'] }) @IsOptional() @IsString() response?: string;
  @ApiProperty() @IsString() @MaxLength(4000) message: string;
}
export class NoteDto { @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(4000) note?: string }
export class FollowerDto { @ApiProperty() @IsString() userId: string; @ApiProperty({ enum: ['FOLLOWER', 'CC'] }) @IsIn(['FOLLOWER', 'CC']) relation: 'FOLLOWER' | 'CC' }
export class CommentDto { @ApiProperty() @IsString() @MaxLength(8000) body: string; @ApiPropertyOptional() @IsOptional() @IsBoolean() internal?: boolean }
export class DecisionDto { @ApiProperty({ enum: ['Approved', 'Rejected'] }) @IsIn(['Approved', 'Rejected']) decision: 'Approved' | 'Rejected'; @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) note?: string }
