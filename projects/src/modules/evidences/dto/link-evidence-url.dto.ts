import { ExpectedVersionDto } from '../../training-evaluations/dto/expected-version.dto';
import { ApiProperty } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsString,
  IsUrl,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';

/** FE chỉ rõ phiếu đang sửa; backend không suy ra phiếu từ thời gian tạo. */
export class LinkEvidenceUrlDto extends ExpectedVersionDto {
  @ApiProperty({
    format: 'uuid',
    description: 'ID phiếu đánh giá đang chỉnh sửa',
  })
  @IsUUID()
  evaluationFormId: string;

  @ApiProperty({ example: 'I.1', maxLength: 20 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  criteriaCode: string;

  @ApiProperty({
    example: 'https://res.cloudinary.com/example/image/upload/evidence.jpg',
    maxLength: 1000,
  })
  @IsUrl({ require_protocol: true, protocols: ['https'] })
  @Matches(/^https:\/\/res\.cloudinary\.com\/.+/i, {
    message: 'Đường dẫn ảnh phải là URL bảo mật của Cloudinary',
  })
  @MaxLength(1000)
  imageUrl: string;

  @ApiProperty({ example: 'evidences/student-proof', maxLength: 500 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  publicId: string;
}
