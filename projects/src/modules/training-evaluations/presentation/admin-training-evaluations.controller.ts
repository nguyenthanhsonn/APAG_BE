import { ExpectedVersionDto } from '../dto/expected-version.dto';
import {
  EVALUATION_ACCESS_ROLES,
  type EvaluationActor,
} from '../domain/evaluation-access.policy';
import { ApiIdempotency } from '../../../common/idempotency/api-idempotency.decorator';
import {
  Body,
  Headers,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { EvaluationFinalizeService } from '../application/evaluation-finalize.service';
import { EvaluationQueryService } from '../application/evaluation-query.service';

import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AdminListEvaluationsQueryDto } from '../dto/admin-list-evaluations-query.dto';
import { BulkFinalizeDto } from '../dto/bulk-finalize.dto';
import { FinalizeByFilterDto } from '../dto/finalize-by-filter.dto';
import { FinalizeEvaluationDto } from '../dto/finalize-evaluation.dto';

@ApiTags('Admin Evaluations')
@ApiBearerAuth('access-token')
@ApiResponse({ status: 401, description: 'Thiếu hoặc sai access token.' })
@Controller([
  'admin/evaluations',
  // TODO: Route /admin/training-evaluations là alias tạm giữ tương thích
  // ngược cho client cũ. Sau khi FE xác nhận đã chuyển hẳn sang
  // /admin/evaluations, xóa alias này. Ngày thêm: 18/07/2026.
  'admin/training-evaluations',
  'training-department/evaluations',
])
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(...EVALUATION_ACCESS_ROLES.finalize)
export class AdminTrainingEvaluationsController {
  constructor(
    private readonly queries: EvaluationQueryService,
    private readonly finalization: EvaluationFinalizeService,
  ) {}

  @ApiOperation({
    summary: 'Lấy dữ liệu',
    description:
      'Endpoint GET / trong nhóm Admin Evaluations; xem schema DTO/query và response mẫu trực tiếp trong Swagger.',
  })
  @ApiResponse({ status: 200, description: 'Thao tác thành công.' })
  @Get()
  findAll(
    @CurrentUser() actor: EvaluationActor,
    @Query() query: AdminListEvaluationsQueryDto,
  ) {
    return this.queries.findAdminApprovalList(actor, query);
  }

  @ApiOperation({
    summary: 'Cập nhật dữ liệu',
    description:
      'Endpoint PATCH bulk-finalize trong nhóm Admin Evaluations; xem schema DTO/query và response mẫu trực tiếp trong Swagger.',
  })
  @ApiResponse({ status: 200, description: 'Thao tác thành công.' })
  @ApiResponse({ status: 400, description: 'Dữ liệu gửi lên không hợp lệ.' })
  @Patch('bulk-finalize')
  @ApiIdempotency()
  bulkFinalize(
    @CurrentUser() actor: EvaluationActor,
    @Body() dto: BulkFinalizeDto,
    @Headers('idempotency-key') key?: string,
  ) {
    return this.finalization.bulkFinalize(actor, dto, key);
  }

  @ApiOperation({
    summary: 'Tạo/Xử lý dữ liệu',
    description:
      'Endpoint POST finalize-by-filter trong nhóm Admin Evaluations; xem schema DTO/query và response mẫu trực tiếp trong Swagger.',
  })
  @ApiResponse({ status: 201, description: 'Thao tác thành công.' })
  @ApiResponse({ status: 400, description: 'Dữ liệu gửi lên không hợp lệ.' })
  @Post('finalize-by-filter')
  @ApiIdempotency()
  finalizeByFilter(
    @CurrentUser() actor: EvaluationActor,
    @Body() dto: FinalizeByFilterDto,
    @Headers('idempotency-key') key?: string,
  ) {
    return this.finalization.finalizeByFilter(actor, dto, key);
  }

  @ApiOperation({
    summary: 'Tạo/Xử lý dữ liệu',
    description:
      'Endpoint POST :id/reopen trong nhóm Admin Evaluations; xem schema DTO/query và response mẫu trực tiếp trong Swagger.',
  })
  @ApiResponse({ status: 201, description: 'Thao tác thành công.' })
  @ApiResponse({ status: 400, description: 'Dữ liệu gửi lên không hợp lệ.' })
  @Post(':id/reopen')
  reopen(
    @CurrentUser() actor: EvaluationActor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ExpectedVersionDto,
  ) {
    return this.finalization.reopen(actor, id, dto?.expectedVersion);
  }

  @ApiOperation({
    summary: 'Cập nhật dữ liệu',
    description:
      'Endpoint PATCH :id/finalize trong nhóm Admin Evaluations; xem schema DTO/query và response mẫu trực tiếp trong Swagger.',
  })
  @ApiResponse({ status: 200, description: 'Thao tác thành công.' })
  @ApiResponse({ status: 400, description: 'Dữ liệu gửi lên không hợp lệ.' })
  @Patch(':id/finalize')
  @ApiIdempotency()
  finalize(
    @CurrentUser() actor: EvaluationActor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: FinalizeEvaluationDto,
    @Headers('idempotency-key') key?: string,
  ) {
    return this.finalization.finalize(actor, id, dto, key);
  }
}
