import { safeError } from '../../observability/safe-log';
import {
  ArgumentsHost,
  BadRequestException,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { ApiErrorDetail, ApiErrorResponse } from 'src/common/shared';

type ExceptionResponseBody = {
  message?: string | string[];
  error?: string;
  errors?: ApiErrorDetail[] | string[] | Record<string, string | string[]>;
};

type HttpRequest = {
  url: string;
};

type HttpResponse = {
  status(statusCode: number): {
    json(payload: ApiErrorResponse): void;
  };
};

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const context = host.switchToHttp();
    const response = context.getResponse<HttpResponse>();
    const request = context.getRequest<HttpRequest>();
    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;
    const exceptionResponse =
      exception instanceof HttpException ? exception.getResponse() : null;
    const body = normalizeExceptionResponse(exceptionResponse);
    const validationErrors = getValidationErrors(exception, body);
    const message = resolveErrorMessage(body, status, validationErrors);

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logServerError(exception);
    }

    const payload: ApiErrorResponse = {
      success: false,
      statusCode: status,
      message,
      data: null,
      ...(validationErrors.length > 0 ? { errors: validationErrors } : {}),
      path: request.url,
      timestamp: new Date().toISOString(),
    };

    response.status(status).json(payload);
  }

  private logServerError(exception: unknown): void {
    this.logger.error({
      event: 'http.unhandled_error',
      error: safeError(exception),
    });
  }
}

function normalizeExceptionResponse(
  response: string | object | null,
): ExceptionResponseBody {
  if (typeof response === 'string') {
    return { message: response };
  }

  if (response && typeof response === 'object') {
    return response;
  }

  return {};
}

function resolveErrorMessage(
  body: ExceptionResponseBody,
  status: number,
  validationErrors: ApiErrorDetail[],
): string {
  if (validationErrors.length > 0) {
    return 'Dữ liệu không hợp lệ';
  }

  if (typeof body.message === 'string') {
    return translateValidationMessage(body.message);
  }

  if (Array.isArray(body.message) && body.message.length > 0) {
    return translateValidationMessage(body.message[0] ?? 'Yêu cầu thất bại');
  }

  if (typeof body.error === 'string') {
    return translateValidationMessage(body.error);
  }

  return resolveDefaultErrorMessage(status);
}

function getValidationErrors(
  exception: unknown,
  body: ExceptionResponseBody,
): ApiErrorDetail[] {
  if (!(exception instanceof BadRequestException)) {
    return normalizeErrors(body.errors);
  }

  const errors = normalizeErrors(body.errors);
  if (errors.length > 0) {
    return errors;
  }

  if (!Array.isArray(body.message)) {
    return [];
  }

  return body.message.map((error) => ({
    field: extractFieldName(error),
    error: translateValidationMessage(error),
  }));
}

function normalizeErrors(
  errors: ExceptionResponseBody['errors'],
): ApiErrorDetail[] {
  if (!errors) {
    return [];
  }

  if (Array.isArray(errors)) {
    return errors.map((error) =>
      typeof error === 'string'
        ? { error: translateValidationMessage(error) }
        : {
            ...error,
            error: translateValidationMessage(error.error),
          },
    );
  }

  return Object.entries(errors).flatMap(([field, value]) => {
    const messages = Array.isArray(value) ? value : [value];
    return messages.map((error) => ({
      field,
      error: translateValidationMessage(error),
    }));
  });
}

function extractFieldName(error: string): string | undefined {
  const [field] = error.split(' ');
  return field || undefined;
}

function translateValidationMessage(message: string): string {
  const normalizedMessage = normalizeTechnicalMessage(message);
  if (normalizedMessage !== message) {
    return normalizedMessage;
  }

  const translations: Array<[RegExp, string]> = [
    [/^Validation failed$/, 'Dữ liệu không hợp lệ'],
    [/^Bad Request$/, 'Dữ liệu gửi lên chưa hợp lệ'],
    [/^Unauthorized$/, 'Vui lòng đăng nhập để tiếp tục'],
    [/^Forbidden$/, 'Bạn không có quyền thực hiện thao tác này'],
    [/^Not Found$/, 'Không tìm thấy dữ liệu phù hợp'],
    [/^Conflict$/, 'Dữ liệu bị trùng hoặc không thể cập nhật'],
    [
      /^Internal server error$/,
      'Hệ thống đang gặp sự cố, vui lòng thử lại sau',
    ],
    [
      /^Cannot (GET|POST|PATCH|PUT|DELETE) (.+)$/,
      'Đường dẫn API không tồn tại hoặc chưa được hỗ trợ',
    ],
    [/^Validation failed \(uuid is expected\)$/, 'Mã định danh không hợp lệ'],
    [/^(.+) must be an email$/, '$1 phải là địa chỉ thư điện tử hợp lệ'],
    [/^(.+) must be a string$/, '$1 phải là chuỗi'],
    [/^(.+) must be a UUID$/, '$1 phải là UUID hợp lệ'],
    [/^(.+) must be a UUID hợp lệ$/, '$1 phải là UUID hợp lệ'],
    [/^(.+) must be a URL address$/, '$1 phải là đường dẫn hợp lệ'],
    [/^(.+) must be a JWT string$/, '$1 phải là mã xác thực hợp lệ'],
    [/^(.+) must be an integer number$/, '$1 phải là số nguyên'],
    [/^(.+) must be an array$/, '$1 phải là mảng'],
    [
      /^(.+) must be one of the following values: (.+)$/,
      '$1 phải là một trong các giá trị sau: $2',
    ],
    [/^(.+) must not be greater than (.+)$/, '$1 không được lớn hơn $2'],
    [/^(.+) must not be less than (.+)$/, '$1 không được nhỏ hơn $2'],
    [
      /^(.+) must be shorter than or equal to (.+) characters$/,
      '$1 không được vượt quá $2 ký tự',
    ],
    [
      /^(.+) must be longer than or equal to (.+) characters$/,
      '$1 phải có ít nhất $2 ký tự',
    ],
    [
      /^(.+) must contain at least (.+) elements$/,
      '$1 phải có ít nhất $2 phần tử',
    ],
    [/^(.+) should not be empty$/, '$1 không được để trống'],
    [
      /^(.+) must match (.+) regular expression$/,
      '$1 không đúng định dạng yêu cầu',
    ],
  ];

  for (const [pattern, replacement] of translations) {
    if (pattern.test(message)) {
      return translateFieldNames(message.replace(pattern, replacement));
    }
  }

  return translateFieldNames(message);
}

function normalizeTechnicalMessage(message: string): string {
  const technicalPatterns: Array<[RegExp, string]> = [
    [
      /PrismaClient/i,
      'Hệ thống đang gặp sự cố khi xử lý dữ liệu, vui lòng thử lại sau',
    ],
    [
      /Invalid `.*prisma.*` invocation/i,
      'Hệ thống đang gặp sự cố khi xử lý dữ liệu, vui lòng thử lại sau',
    ],
    [
      /Authentication failed against the database server/i,
      'Hệ thống chưa kết nối được cơ sở dữ liệu, vui lòng kiểm tra cấu hình',
    ],
    [
      /The column .* does not exist/i,
      'Dữ liệu hệ thống chưa được đồng bộ, vui lòng cập nhật cơ sở dữ liệu',
    ],
    [
      /Value .* not found in enum/i,
      'Dữ liệu hệ thống chưa được đồng bộ, vui lòng kiểm tra lại dữ liệu nền',
    ],
    [/SMTP/i, 'Chưa gửi được email, vui lòng kiểm tra cấu hình gửi thư'],
    [
      /ECONNREFUSED|ETIMEDOUT|ENOTFOUND|ECONNRESET/i,
      'Không thể kết nối dịch vụ bên ngoài, vui lòng thử lại sau',
    ],
    [
      /TypeError|RangeError|ReferenceError|SyntaxError/i,
      'Hệ thống đang gặp sự cố, vui lòng thử lại sau',
    ],
  ];

  for (const [pattern, replacement] of technicalPatterns) {
    if (pattern.test(message)) {
      return replacement;
    }
  }

  return message;
}

function resolveDefaultErrorMessage(status: number): string {
  const messages: Record<number, string> = {
    [HttpStatus.BAD_REQUEST]: 'Dữ liệu gửi lên chưa hợp lệ',
    [HttpStatus.UNAUTHORIZED]: 'Vui lòng đăng nhập để tiếp tục',
    [HttpStatus.FORBIDDEN]: 'Bạn không có quyền thực hiện thao tác này',
    [HttpStatus.NOT_FOUND]: 'Không tìm thấy dữ liệu phù hợp',
    [HttpStatus.CONFLICT]: 'Dữ liệu bị trùng hoặc không thể cập nhật',
    [HttpStatus.UNPROCESSABLE_ENTITY]: 'Dữ liệu gửi lên chưa thể xử lý',
    [HttpStatus.TOO_MANY_REQUESTS]:
      'Bạn thao tác quá nhanh, vui lòng thử lại sau',
    [HttpStatus.INTERNAL_SERVER_ERROR]:
      'Hệ thống đang gặp sự cố, vui lòng thử lại sau',
    [HttpStatus.BAD_GATEWAY]:
      'Dịch vụ đang tạm thời gián đoạn, vui lòng thử lại sau',
    [HttpStatus.SERVICE_UNAVAILABLE]: 'Dịch vụ đang bận, vui lòng thử lại sau',
    [HttpStatus.GATEWAY_TIMEOUT]:
      'Dịch vụ phản hồi quá lâu, vui lòng thử lại sau',
  };

  return messages[status] ?? 'Yêu cầu chưa thể xử lý, vui lòng thử lại sau';
}

function translateFieldNames(message: string): string {
  const labels: Record<string, string> = {
    action: 'Hành động',
    academicYear: 'Năm học',
    authorId: 'Mã tác giả',
    classScore: 'Điểm lớp đánh giá',
    code: 'Mã',
    comment: 'Ghi chú',
    content: 'Nội dung',
    criteriaCode: 'Mã tiêu chí',
    currentPassword: 'Mật khẩu hiện tại',
    email: 'Địa chỉ thư điện tử',
    facultyId: 'Mã khoa',
    imageUrl: 'Đường dẫn ảnh',
    isActive: 'Trạng thái hoạt động',
    classId: 'Mã lớp',
    classIds: 'Danh sách lớp',
    criterionId: 'Mã tiêu chí',
    evaluationFormId: 'Mã phiếu đánh giá',
    fullName: 'Họ và tên',
    importToken: 'Mã xác nhận import',
    limit: 'Số lượng mỗi trang',
    majorId: 'Mã ngành',
    name: 'Tên',
    newPassword: 'Mật khẩu mới',
    note: 'Ghi chú',
    page: 'Trang',
    password: 'Mật khẩu',
    phone: 'Số điện thoại',
    publicId: 'Mã ảnh',
    refreshToken: 'Mã làm mới',
    reviewerNote: 'Ghi chú thẩm định',
    scores: 'Danh sách điểm',
    semester: 'Học kỳ',
    studentCode: 'Mã sinh viên',
    studentDeadline: 'Hạn sinh viên nộp',
    classDeadline: 'Hạn lớp duyệt',
    facultyDeadline: 'Hạn cấp trên duyệt',
    startDate: 'Ngày bắt đầu',
    endDate: 'Ngày kết thúc',
    title: 'Tiêu đề',
    username: 'Tên đăng nhập',
    userIds: 'Danh sách cố vấn',
  };

  return Object.entries(labels).reduce(
    (translated, [field, label]) =>
      translated.replace(new RegExp(`\\b${field}\\b`, 'g'), label),
    message,
  );
}
