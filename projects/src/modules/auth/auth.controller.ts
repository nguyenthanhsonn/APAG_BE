import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { LoginDto } from './dto/login.dto';
import { LogoutDto } from './dto/logout.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import type { RequestWithUser } from './types/authenticated-user.type';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

@ApiTags('Auth')
@ApiBearerAuth('access-token')
@ApiResponse({ status: 401, description: 'Thiếu hoặc sai access token.' })
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @ApiOperation({
    summary: 'Tạo/Xử lý dữ liệu',
    description:
      'Endpoint POST login trong nhóm Auth; xem schema DTO/query và response mẫu trực tiếp trong Swagger.',
  })
  @ApiResponse({ status: 201, description: 'Thao tác thành công.' })
  @ApiResponse({ status: 400, description: 'Dữ liệu gửi lên không hợp lệ.' })
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @ApiOperation({
    summary: 'Yêu cầu đặt lại mật khẩu',
    description:
      'Nhận username hoặc email, nếu tài khoản đang hoạt động tồn tại thì hệ thống gửi email chứa link đặt lại mật khẩu. Response luôn dùng message chung để tránh lộ tài khoản có tồn tại hay không.',
  })
  @ApiBody({
    type: ForgotPasswordDto,
    examples: {
      byUsername: {
        summary: 'Quên mật khẩu bằng username',
        value: { identifier: 'nguyenson' },
      },
      byEmail: {
        summary: 'Quên mật khẩu bằng email',
        value: { identifier: 'nguyenson@example.com' },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description:
      'Đã tiếp nhận yêu cầu. Người dùng vui lòng kiểm tra email để tiếp tục đặt lại mật khẩu.',
    schema: {
      example: {
        message:
          'Vui lòng kiểm tra email của bạn để tiếp tục đặt lại mật khẩu.',
      },
    },
  })
  @HttpCode(200)
  @Post('forgot-password')
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto);
  }

  @ApiOperation({
    summary: 'Đặt lại mật khẩu',
    description:
      'FE gửi token nhận trong email cùng mật khẩu mới. Token chỉ dùng một lần, có thời hạn 15 phút; sau khi đổi mật khẩu, refresh token cũ bị thu hồi.',
  })
  @ApiBody({
    type: ResetPasswordDto,
    examples: {
      default: {
        value: {
          token: 'reset-token-tu-email',
          newPassword: 'NewPass123',
        },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Đặt lại mật khẩu thành công.',
    schema: {
      example: {
        message:
          'Đặt lại mật khẩu thành công. Vui lòng đăng nhập bằng mật khẩu mới.',
      },
    },
  })
  @ApiResponse({
    status: 400,
    description:
      'Token không hợp lệ, hết hạn, đã dùng hoặc mật khẩu mới không hợp lệ.',
  })
  @HttpCode(200)
  @Post('reset-password')
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto);
  }

  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Lấy dữ liệu',
    description:
      'Endpoint GET me trong nhóm Auth; xem schema DTO/query và response mẫu trực tiếp trong Swagger.',
  })
  @ApiResponse({ status: 200, description: 'Thao tác thành công.' })
  @Get('me')
  me(@Req() request: RequestWithUser) {
    return this.authService.getProfile(request.user.id);
  }

  @ApiOperation({
    summary: 'Tạo/Xử lý dữ liệu',
    description:
      'Endpoint POST refresh-token trong nhóm Auth; xem schema DTO/query và response mẫu trực tiếp trong Swagger.',
  })
  @ApiResponse({ status: 201, description: 'Thao tác thành công.' })
  @ApiResponse({ status: 400, description: 'Dữ liệu gửi lên không hợp lệ.' })
  @Post('refresh-token')
  refreshToken(@Body() dto: RefreshTokenDto) {
    return this.authService.refreshToken(dto);
  }

  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Tạo/Xử lý dữ liệu',
    description:
      'Endpoint POST logout trong nhóm Auth; xem schema DTO/query và response mẫu trực tiếp trong Swagger.',
  })
  @ApiResponse({ status: 201, description: 'Thao tác thành công.' })
  @ApiResponse({ status: 400, description: 'Dữ liệu gửi lên không hợp lệ.' })
  @Post('logout')
  logout(@Req() request: RequestWithUser, @Body() dto: LogoutDto) {
    return this.authService.logout(request.user, dto);
  }

  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Tạo/Xử lý dữ liệu',
    description:
      'Endpoint POST change-password trong nhóm Auth; xem schema DTO/query và response mẫu trực tiếp trong Swagger.',
  })
  @ApiResponse({ status: 201, description: 'Thao tác thành công.' })
  @ApiResponse({ status: 400, description: 'Dữ liệu gửi lên không hợp lệ.' })
  @Post('change-password')
  changePassword(
    @Req() request: RequestWithUser,
    @Body() dto: ChangePasswordDto,
  ) {
    return this.authService.changePassword(request.user, dto);
  }
}
