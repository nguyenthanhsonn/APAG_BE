import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, Min } from 'class-validator';

/** Version đã hiển thị trên client; không tự lấy lại version mới để ghi đè màn hình cũ. */
export class ExpectedVersionDto {
  @ApiPropertyOptional({
    minimum: 0,
    description: 'Version của phiếu client đã đọc',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  expectedVersion?: number;
}
