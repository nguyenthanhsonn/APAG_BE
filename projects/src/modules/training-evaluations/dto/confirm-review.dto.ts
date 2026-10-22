import { ExpectedVersionDto } from './expected-version.dto';
import {
  ArrayMinSize,
  IsArray,
  IsOptional,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ReviewScoreItemDto } from './review-scores.dto';

export class ConfirmReviewDto extends ExpectedVersionDto {
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ReviewScoreItemDto)
  scores?: ReviewScoreItemDto[];
}
