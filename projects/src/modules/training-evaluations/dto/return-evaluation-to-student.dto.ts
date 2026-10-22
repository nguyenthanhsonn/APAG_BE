import { ExpectedVersionDto } from './expected-version.dto';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class ReturnEvaluationToStudentDto extends ExpectedVersionDto {
  @IsString()
  @IsNotEmpty({ message: 'Phải nhập lý do gửi lại phiếu cho sinh viên' })
  @MaxLength(1000)
  reason: string;
}
