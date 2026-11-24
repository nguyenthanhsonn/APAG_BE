import { IsEnum, IsOptional } from 'class-validator';
import { FormStatus } from '../../../generated/prisma/client';
import { GetClassStudentsQueryDto } from './get-class-students-query.dto';

export class GetFacultyClassEvaluationsQueryDto extends GetClassStudentsQueryDto {
  @IsOptional()
  @IsEnum(FormStatus)
  status?: FormStatus;
}
