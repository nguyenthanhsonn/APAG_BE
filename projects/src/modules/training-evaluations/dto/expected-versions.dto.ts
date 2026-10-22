import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsOptional,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';

export class EvaluationVersionItemDto {
  @IsUUID('4')
  id: string;

  @IsInt()
  @Min(0)
  version: number;
}

/** Snapshot của tập phiếu được chọn rõ ID trên UI; không dùng cho toàn bộ filter chưa tải. */
export class ExpectedVersionsDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => EvaluationVersionItemDto)
  expectedVersions?: EvaluationVersionItemDto[];
}
