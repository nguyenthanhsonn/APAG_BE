import { ExpectedVersionDto } from '../training-evaluations/dto/expected-version.dto';
import {
  EVALUATION_ACCESS_ROLES,
  type EvaluationActor,
} from '../training-evaluations/domain/evaluation-access.policy';
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { LinkEvidenceUrlDto } from './dto/link-evidence-url.dto';
import { EvidencesService } from './evidences.service';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

@ApiTags('Evidences')
@ApiBearerAuth('access-token')
@ApiResponse({ status: 401, description: 'Thiếu hoặc sai access token.' })
@Controller('evidences')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(...EVALUATION_ACCESS_ROLES.edit)
export class EvidencesController {
  constructor(private readonly evidencesService: EvidencesService) {}

  @ApiOperation({
    summary: 'Gắn URL minh chứng vào phiếu được chỉ định',
    description:
      'Bắt buộc evaluationFormId, criteriaCode, imageUrl và publicId. Phiếu phải thuộc sinh viên hiện tại, đang draft/rejected và chưa khóa.',
  })
  @ApiResponse({ status: 201, description: 'Thao tác thành công.' })
  @ApiResponse({ status: 400, description: 'Dữ liệu gửi lên không hợp lệ.' })
  @ApiResponse({
    status: 404,
    description:
      'Phiếu không thuộc người gọi/không tồn tại hoặc tiêu chí không hoạt động.',
  })
  @ApiResponse({
    status: 409,
    description: 'Phiếu không còn được sửa, đã khóa hoặc version đã thay đổi.',
  })
  @Post('link-url')
  linkUrl(
    @CurrentUser() actor: EvaluationActor,
    @Body() dto: LinkEvidenceUrlDto,
  ) {
    return this.evidencesService.linkUrl(actor, dto);
  }

  @ApiOperation({
    summary: 'Lấy dữ liệu',
    description:
      'Endpoint GET my trong nhóm Evidences; xem schema DTO/query và response mẫu trực tiếp trong Swagger.',
  })
  @ApiResponse({ status: 200, description: 'Thao tác thành công.' })
  @Get('my')
  findMine(@CurrentUser() actor: EvaluationActor) {
    return this.evidencesService.findMine(actor);
  }

  @ApiOperation({
    summary: 'Xóa dữ liệu',
    description:
      'Endpoint DELETE :id trong nhóm Evidences; xem schema DTO/query và response mẫu trực tiếp trong Swagger.',
  })
  @ApiResponse({ status: 200, description: 'Thao tác thành công.' })
  @Delete(':id')
  remove(
    @CurrentUser() actor: EvaluationActor,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: ExpectedVersionDto,
  ) {
    return this.evidencesService.remove(actor, id, query.expectedVersion);
  }
}
