import { ExpectedVersionDto } from './expected-version.dto';
import { Transform, type TransformFnParams } from 'class-transformer';
import {
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';

export class UpdateTrainingEvaluationDraftDto extends ExpectedVersionDto {
  @IsOptional()
  @Transform(({ value }: TransformFnParams): unknown =>
    typeof value === 'string' ? value.trim() : value,
  )
  @ValidateIf((_, value: unknown) => value !== null && value !== undefined)
  @IsString()
  @MaxLength(20)
  @Matches(/^\+?[0-9]{9,15}$/, {
    message: 'Số điện thoại phải có 9 đến 15 chữ số, có thể bắt đầu bằng dấu +',
  })
  phone?: string | null;

  @IsOptional()
  @Transform(({ value }: TransformFnParams): unknown =>
    typeof value === 'string' ? value.trim() : value,
  )
  @ValidateIf((_, value: unknown) => value !== null && value !== undefined)
  @IsString()
  @MaxLength(2000)
  note?: string | null;
}
