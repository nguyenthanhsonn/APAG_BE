import { ExpectedVersionDto } from './expected-version.dto';
import {
  ArrayMinSize,
  IsArray,
  IsObject,
  IsOptional,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ReviewScoreItemDto } from './review-scores.dto';

export class ConfirmReviewDto extends ExpectedVersionDto {
  @IsOptional()
  @IsObject()
  classLeaderReviewData?: Record<string, unknown>;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ReviewScoreItemDto)
  scores?: ReviewScoreItemDto[];
}
