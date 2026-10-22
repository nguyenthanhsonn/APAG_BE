import { ArrayMaxSize, ArrayMinSize, IsArray, IsUUID } from 'class-validator';
import { ExpectedVersionsDto } from './expected-versions.dto';

export class BulkFinalizeDto extends ExpectedVersionsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500, { message: 'Chỉ được phê duyệt tối đa 500 phiếu mỗi lần' })
  @IsUUID('4', { each: true })
  ids: string[];
}
