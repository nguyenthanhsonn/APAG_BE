import { ExpectedVersionDto } from './expected-version.dto';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class FinalizeEvaluationDto extends ExpectedVersionDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  finalScore?: number;
}
