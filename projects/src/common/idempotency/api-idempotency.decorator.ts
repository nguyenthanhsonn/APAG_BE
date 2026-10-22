import { applyDecorators } from '@nestjs/common';
import { ApiHeader, ApiResponse } from '@nestjs/swagger';

export function ApiIdempotency() {
  return applyDecorators(
    ApiHeader({
      name: 'Idempotency-Key',
      required: false,
      description:
        'Key 1–200 ký tự ASCII không có khoảng trắng. Giữ nguyên key và body khi retry; thao tác mới dùng key mới.',
    }),
    ApiResponse({
      status: 409,
      description:
        'Conflict version/trạng thái hoặc key đã dùng với dữ liệu khác.',
    }),
  );
}
