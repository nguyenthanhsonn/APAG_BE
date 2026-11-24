import {
  EVALUATION_ACCESS_ROLES,
  type EvaluationActor,
} from '../domain/evaluation-access.policy';
import { ApiIdempotency } from '../../../common/idempotency/api-idempotency.decorator';
import {
  Body,
  Headers,
  Controller,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { EvaluationFinalizeService } from '../application/evaluation-finalize.service';

import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { BulkFinalizeDto } from '../dto/bulk-finalize.dto';
import { FinalizeByFilterDto } from '../dto/finalize-by-filter.dto';
import { FinalizeEvaluationDto } from '../dto/finalize-evaluation.dto';

@ApiTags('Training Department Evaluations')
@ApiBearerAuth('access-token')
@ApiResponse({ status: 401, description: 'Thiếu hoặc sai access token.' })
@Controller('training-department/evaluations')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(...EVALUATION_ACCESS_ROLES.finalize)
export class TrainingDepartmentEvaluationsController {
  constructor(private readonly finalization: EvaluationFinalizeService) {}

  @ApiOperation({
    summary: 'Duyệt cuối các phiếu đã chọn',
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
    summary: 'Duyệt cuối các phiếu theo bộ lọc',
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
    summary: 'Duyệt cuối một phiếu',
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
