import { ExpectedVersionDto } from './expected-version.dto';
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class ReviewScoreItemDto {
  @IsString()
  @MaxLength(20)
  criteriaCode: string;

  @IsInt()
  @Min(0)
  @Max(100)
  classScore: number;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reviewerNote?: string;
}

export class ReviewScoresDto extends ExpectedVersionDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ReviewScoreItemDto)
  scores: ReviewScoreItemDto[];
}
