import { ExpectedVersionDto } from './expected-version.dto';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class DisciplineViolationDto {
  @IsString()
  @MaxLength(80)
  @Matches(/^[A-Z0-9_]+$/)
  code: string;

  @IsInt()
  @Min(0)
  @Max(100)
  count: number;

  @IsInt()
  @Min(0)
  @Max(25)
  deductScore: number;
}

export class UpdateDisciplineScoreDto extends ExpectedVersionDto {
  @IsInt()
  @Min(0)
  @Max(25)
  baseScore: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => DisciplineViolationDto)
  violations: DisciplineViolationDto[];
}
