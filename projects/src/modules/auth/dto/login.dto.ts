import { Transform, type TransformFnParams } from 'class-transformer';
import { IsString, Length, Matches, MinLength } from 'class-validator';
import {
  normalizeUsername,
  USERNAME_FORMAT_MESSAGE,
  USERNAME_PATTERN,
} from '../../../common/helpers/username.helper';

export class LoginDto {
  @Transform(({ value }: TransformFnParams): unknown =>
    typeof value === 'string' ? normalizeUsername(value) : value,
  )
  @IsString()
  @Length(3, 50)
  @Matches(USERNAME_PATTERN, { message: USERNAME_FORMAT_MESSAGE })
  username: string;

  @IsString()
  @MinLength(6)
  password: string;
}
