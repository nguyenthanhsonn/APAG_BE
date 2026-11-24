import { Transform, Type, type TransformFnParams } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { FormStatus } from '../../../generated/prisma/client';
import { TRAINING_EVALUATION_SEMESTERS } from './create-training-evaluation.dto';
import type { TrainingEvaluationSemester } from './create-training-evaluation.dto';

const FORM_STATUS_VALUES = Object.values(FormStatus);

function emptyToUndefined({ value }: TransformFnParams): unknown {
  return value === '' ? undefined : value;
}

/**
 * Query params cho API admin lấy danh sách toàn bộ phiếu đánh giá.
 * `semester` và `academicYear` phải đi kèm nhau (validate ở service).
 */
export class AdminListEvaluationsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  limit: number = 20;

  @IsOptional()
  @Transform(emptyToUndefined)
  @IsIn(FORM_STATUS_VALUES)
  status?: FormStatus;

  @IsOptional()
  @Transform(emptyToUndefined)
  @IsUUID()
  semesterId?: string;

  @IsOptional()
  @Transform(emptyToUndefined)
  @IsIn(TRAINING_EVALUATION_SEMESTERS)
  semester?: TrainingEvaluationSemester;

  @IsOptional()
  @Transform(emptyToUndefined)
  @Matches(/^\d{4}-\d{4}$/, {
    message: 'academicYear phải theo định dạng YYYY-YYYY',
  })
  academicYear?: string;

  @IsOptional()
  @Transform(emptyToUndefined)
  @IsUUID()
  classId?: string;

  @IsOptional()
  @Transform(emptyToUndefined)
  @IsUUID()
  facultyId?: string;

  @IsOptional()
  @Transform(emptyToUndefined)
  @IsString()
  keyword?: string;

  @IsOptional()
  @Transform(emptyToUndefined)
  @IsString()
  search?: string;
}
