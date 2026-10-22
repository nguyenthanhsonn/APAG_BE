import { ExpectedVersionDto } from './expected-version.dto';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

export const REVIEW_ACTIONS = ['approve', 'reject'] as const;
export type ReviewAction = (typeof REVIEW_ACTIONS)[number];

/**
 * DTO dùng chung cho luồng duyệt 2 cấp sau sinh viên (lớp/CVHT, admin).
 * `classScore` chỉ áp dụng khi lớp/CVHT duyệt (bắt buộc — kiểm tra ở service vì
 * phụ thuộc role người gọi, DTO không biết role). `comment` bắt buộc khi từ chối.
 */
export class ReviewTrainingEvaluationDto extends ExpectedVersionDto {
  @IsIn(REVIEW_ACTIONS)
  action: ReviewAction;

  @ValidateIf(
    (dto: ReviewTrainingEvaluationDto) => dto.classScore !== undefined,
  )
  @IsInt()
  @Min(0)
  @Max(100)
  classScore?: number;

  @ValidateIf((dto: ReviewTrainingEvaluationDto) => dto.action === 'reject')
  @IsString()
  @IsNotEmpty({ message: 'Phải nhập lý do khi từ chối phiếu' })
  @MaxLength(1000)
  comment?: string;
}
