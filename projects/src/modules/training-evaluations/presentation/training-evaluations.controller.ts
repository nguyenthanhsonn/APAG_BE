import { ExpectedVersionDto } from '../dto/expected-version.dto';
import { EVALUATION_ACCESS_ROLES } from '../domain/evaluation-access.policy';
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
import { UserRole } from '../../../common/shared';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user.type';
import { EvaluationQueryService } from '../application/evaluation-query.service';
import { EvaluationReviewService } from '../application/evaluation-review.service';
import { EvaluationScoreService } from '../application/evaluation-score.service';
import { EvaluationSubmitService } from '../application/evaluation-submit.service';
import { AdminListEvaluationsQueryDto } from '../dto/admin-list-evaluations-query.dto';
import { ConfirmReviewDto } from '../dto/confirm-review.dto';
import { CreateTrainingEvaluationDto } from '../dto/create-training-evaluation.dto';
import { ReturnEvaluationToStudentDto } from '../dto/return-evaluation-to-student.dto';
import { ReviewScoresDto } from '../dto/review-scores.dto';
import { ReviewTrainingEvaluationDto } from '../dto/review-training-evaluation.dto';
import { SubmitClassToAdvisorDto } from '../dto/submit-class-to-advisor.dto';
import { SubmitClassToFacultyDto } from '../dto/submit-class-to-faculty.dto';
import { SubmitFacultyToTrainingDepartmentDto } from '../dto/submit-faculty-to-training-department.dto';
import { UpdateActivityScoreDto } from '../dto/update-activity-score.dto';
import { UpdateCommunityScoreDto } from '../dto/update-community-score.dto';
import { UpdateDisciplineScoreDto } from '../dto/update-discipline-score.dto';
import { UpdateRoleScoreDto } from '../dto/update-role-score.dto';
import { UpdateStudyScoreDto } from '../dto/update-study-score.dto';
import { UpdateTrainingEvaluationDraftDto } from '../dto/update-training-evaluation-draft.dto';

import { ApiOperation, ApiResponse } from '@nestjs/swagger';

const ALL_ROLES = EVALUATION_ACCESS_ROLES.read;

@Controller('training-evaluations')
@UseGuards(JwtAuthGuard, RolesGuard)
export class TrainingEvaluationsController {
  constructor(
    private readonly queries: EvaluationQueryService,
    private readonly scores: EvaluationScoreService,
    private readonly submissions: EvaluationSubmitService,
    private readonly reviews: EvaluationReviewService,
  ) {}

  @Post()
  @Roles(...EVALUATION_ACCESS_ROLES.edit)
  create(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: CreateTrainingEvaluationDto,
  ) {
    return this.submissions.create(actor, dto);
  }

  @Get()
  @Roles(
    ...EVALUATION_ACCESS_ROLES.read.filter((role) => role !== UserRole.Student),
  )
  findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: AdminListEvaluationsQueryDto,
  ) {
    return this.queries.findAll(user, query);
  }

  @Get('me')
  @Roles(...EVALUATION_ACCESS_ROLES.edit)
  findMine(@CurrentUser() actor: AuthenticatedUser) {
    return this.queries.findMine(actor);
  }

  @ApiOperation({
    summary: 'Lớp trưởng gửi toàn bộ phiếu trong lớp lên CVHT',
    description:
      'Chỉ lớp trưởng được gán lớp mới được gọi. BE chuyển các phiếu đang ở trạng thái submitted của lớp sang class_leader_approved để CVHT tiếp tục duyệt.',
  })
  @ApiResponse({
    status: 201,
    description: 'Gửi danh sách lên CVHT thành công.',
  })
  @ApiResponse({ status: 400, description: 'Dữ liệu gửi lên không hợp lệ.' })
  @Post('classes/:classId/submit-to-advisor')
  @Roles(UserRole.ClassLeader)
  @ApiIdempotency()
  submitClassToAdvisor(
    @CurrentUser() reviewer: AuthenticatedUser,
    @Param('classId', ParseUUIDPipe) classId: string,
    @Body() dto: SubmitClassToAdvisorDto,
    @Headers('idempotency-key') key?: string,
  ) {
    return this.submissions.submitClassToAdvisor(reviewer, classId, dto, key);
  }

  @ApiOperation({
    summary: 'CVHT gửi toàn bộ phiếu trong lớp lên khoa',
    description:
      'Chỉ CVHT được gán lớp mới được gọi. BE chuyển các phiếu đang ở trạng thái class_leader_approved và đã có điểm CVHT sang class_approved để khoa/cấp trên tiếp tục xử lý.',
  })
  @ApiResponse({
    status: 201,
    description: 'Gửi danh sách lên khoa thành công.',
  })
  @ApiResponse({ status: 400, description: 'Dữ liệu gửi lên không hợp lệ.' })
  @Post('classes/:classId/submit-to-faculty')
  @Roles(UserRole.Advisor)
  @ApiIdempotency()
  submitClassToFaculty(
    @CurrentUser() reviewer: AuthenticatedUser,
    @Param('classId', ParseUUIDPipe) classId: string,
    @Body() dto: SubmitClassToFacultyDto,
    @Headers('idempotency-key') key?: string,
  ) {
    return this.submissions.submitClassToFaculty(reviewer, classId, dto, key);
  }

  @ApiOperation({
    summary: 'Khoa gửi toàn bộ phiếu lên Phòng Đào tạo',
    description:
      'Chỉ tài khoản khoa được gán khoa mới được gọi. BE chuyển các phiếu class_approved trong khoa sang faculty_approved để PĐT duyệt cuối. Có thể truyền classId để gửi riêng một lớp.',
  })
  @ApiResponse({
    status: 201,
    description: 'Gửi danh sách lên PĐT thành công.',
  })
  @ApiResponse({ status: 400, description: 'Dữ liệu gửi lên không hợp lệ.' })
  @Post('faculties/:facultyId/submit-to-training-department')
  @Roles(...EVALUATION_ACCESS_ROLES.approveFaculty)
  @ApiIdempotency()
  submitFacultyToTrainingDepartment(
    @CurrentUser() reviewer: AuthenticatedUser,
    @Param('facultyId', ParseUUIDPipe) facultyId: string,
    @Body() dto: SubmitFacultyToTrainingDepartmentDto,
    @Headers('idempotency-key') key?: string,
  ) {
    return this.submissions.submitFacultyToTrainingDepartment(
      reviewer,
      facultyId,
      dto,
      key,
    );
  }

  @Get(':id/summary')
  @Roles(...ALL_ROLES)
  getSummary(
    @CurrentUser('id') userId: string,
    @CurrentUser('role') role: UserRole,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.queries.getSummary(userId, role, id);
  }

  @Get(':id/status')
  @Roles(...ALL_ROLES)
  getStatus(
    @CurrentUser('id') userId: string,
    @CurrentUser('role') role: UserRole,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.queries.getStatus(userId, role, id);
  }

  @Patch(':id/study-score')
  @Roles(...EVALUATION_ACCESS_ROLES.edit)
  updateStudyScore(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateStudyScoreDto,
  ) {
    return this.scores.updateStudyScore(actor, id, dto);
  }

  @Patch(':id/discipline-score')
  @Roles(...EVALUATION_ACCESS_ROLES.edit)
  updateDisciplineScore(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDisciplineScoreDto,
  ) {
    return this.scores.updateDisciplineScore(actor, id, dto);
  }

  @Patch(':id/activity-score')
  @Roles(...EVALUATION_ACCESS_ROLES.edit)
  updateActivityScore(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateActivityScoreDto,
  ) {
    return this.scores.updateActivityScore(actor, id, dto);
  }

  @Patch(':id/community-score')
  @Roles(...EVALUATION_ACCESS_ROLES.edit)
  updateCommunityScore(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCommunityScoreDto,
  ) {
    return this.scores.updateCommunityScore(actor, id, dto);
  }

  @Patch(':id/role-score')
  @Roles(...EVALUATION_ACCESS_ROLES.edit)
  updateRoleScore(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRoleScoreDto,
  ) {
    return this.scores.updateRoleScore(actor, id, dto);
  }

  @Post(':id/submit')
  @Roles(...EVALUATION_ACCESS_ROLES.edit)
  @ApiIdempotency()
  submit(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ExpectedVersionDto,
    @Headers('idempotency-key') key?: string,
  ) {
    return this.submissions.submit(actor, id, key, dto?.expectedVersion);
  }

  @Patch(':id/review-scores')
  @Roles(...EVALUATION_ACCESS_ROLES.review)
  @ApiIdempotency()
  reviewScores(
    @CurrentUser() reviewer: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReviewScoresDto,
    @Headers('idempotency-key') key?: string,
  ) {
    return this.scores.reviewScores(reviewer, id, dto, undefined, key);
  }

  @ApiOperation({
    summary: 'Xác nhận đã đánh giá phiếu',
    description:
      'Lớp trưởng/CVHT xác nhận đã hoàn tất cột điểm đánh giá cho một sinh viên. API chỉ ghi nhận người xác nhận và thời điểm xác nhận, chưa chuyển phiếu lên cấp tiếp theo.',
  })
  @ApiResponse({ status: 201, description: 'Xác nhận đánh giá thành công.' })
  @ApiResponse({ status: 400, description: 'Dữ liệu gửi lên không hợp lệ.' })
  @Post(':id/confirm-review')
  @Roles(...EVALUATION_ACCESS_ROLES.review)
  @ApiIdempotency()
  confirmReview(
    @CurrentUser() reviewer: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ConfirmReviewDto,
    @Headers('idempotency-key') key?: string,
  ) {
    return this.reviews.confirmReview(reviewer, id, dto, key);
  }

  @ApiOperation({
    summary: 'Tạo/Xử lý dữ liệu',
    description:
      'Endpoint POST :id/review trong nhóm Training Evaluations; xem schema DTO/query và response mẫu trực tiếp trong Swagger.',
  })
  @ApiResponse({ status: 201, description: 'Thao tác thành công.' })
  @ApiResponse({ status: 400, description: 'Dữ liệu gửi lên không hợp lệ.' })
  @Post(':id/review')
  @Roles(UserRole.Admin)
  @ApiIdempotency()
  review(
    @CurrentUser() reviewer: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReviewTrainingEvaluationDto,
    @Headers('idempotency-key') key?: string,
  ) {
    return this.reviews.review(reviewer, id, dto, key);
  }

  @ApiOperation({
    summary: 'CVHT gửi lại phiếu đánh giá cho sinh viên',
    description:
      'Chỉ CVHT được gán lớp mới được gọi. Phiếu phải đang chờ CVHT duyệt; BE chuyển phiếu về rejected, lưu lý do vào note và gửi thông báo cho sinh viên.',
  })
  @ApiResponse({
    status: 201,
    description: 'Gửi lại phiếu cho sinh viên thành công.',
  })
  @ApiResponse({ status: 400, description: 'Dữ liệu gửi lên không hợp lệ.' })
  @Post(':id/return-to-student')
  @Roles(UserRole.Advisor)
  @ApiIdempotency()
  returnToStudent(
    @CurrentUser() reviewer: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReturnEvaluationToStudentDto,
    @Headers('idempotency-key') key?: string,
  ) {
    return this.reviews.returnToStudent(reviewer, id, dto, key);
  }

  @Get(':id')
  @Roles(...ALL_ROLES)
  findOne(
    @CurrentUser('id') userId: string,
    @CurrentUser('role') role: UserRole,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.queries.findOne(userId, role, id);
  }

  @Patch(':id')
  @Roles(...EVALUATION_ACCESS_ROLES.edit)
  updateDraft(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTrainingEvaluationDraftDto,
  ) {
    return this.scores.updateDraft(actor, id, dto);
  }
}
