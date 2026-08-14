import { IsIn, IsOptional } from 'class-validator';
import { FormStatus } from '../../../generated/prisma/client';
import { ReportsAggregateQueryDto } from './reports-aggregate-query.dto';

const FORM_STATUS_VALUES = Object.values(FormStatus);

/**
 * Query cho export-pdf — kế thừa bộ lọc gom nhóm, thêm lọc theo trạng thái
 * vì export cần xuất đúng danh sách đang xem trên admin panel (mọi trạng thái, không chỉ finalized).
 */
export class ReportsExportQueryDto extends ReportsAggregateQueryDto {
  @IsOptional()
  @IsIn(FORM_STATUS_VALUES)
  status?: FormStatus;
}
