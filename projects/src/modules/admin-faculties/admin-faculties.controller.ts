import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { UserRole } from '../../common/shared';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { GetMajorsQueryDto } from '../admin-majors/dto/get-majors-query.dto';
import { AdminFacultiesService } from './admin-faculties.service';
import { CreateFacultyDto } from './dto/create-faculty.dto';
import { GetFacultiesQueryDto } from './dto/get-faculties-query.dto';
import { UpdateFacultyStatusDto } from './dto/update-faculty-status.dto';
import { UpdateFacultyDto } from './dto/update-faculty.dto';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';


@ApiTags('Faculties')
@ApiBearerAuth('access-token')
@ApiResponse({ status: 401, description: 'Thiếu hoặc sai access token.' })
@ApiResponse({ status: 403, description: 'Không đủ quyền truy cập dữ liệu khoa này.' })
@Controller('faculties')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.Admin, UserRole.Faculty)
export class FacultiesController {
  constructor(private readonly adminFacultiesService: AdminFacultiesService) {}

  @ApiOperation({
    summary: 'Danh sách ngành thuộc khoa',
    description:
      'Endpoint dùng chung cho admin và khoa. Admin xem mọi khoa, tài khoản khoa chỉ xem đúng khoa được gán.',
  })
  @ApiResponse({ status: 200, description: 'Thao tác thành công.' })
  @Get(':id/majors')
  findMajorsByFaculty(
    @CurrentUser('id') userId: string,
    @CurrentUser('role') role: UserRole,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: GetMajorsQueryDto,
  ) {
    return this.adminFacultiesService.findMajorsForViewer(userId, role, id, query);
  }

  @ApiOperation({
    summary: 'Thống kê danh sách lớp thuộc khoa cho Dashboard Khoa',
    description:
      'Endpoint tổng hợp danh sách lớp, sĩ số, số phiếu đã nộp, trạng thái gửi PĐT và ngày chuyển cho Dashboard Khoa.',
  })
  @ApiResponse({ status: 200, description: 'Thao tác thành công.' })
  @Get(':id/class-stats')
  getClassStats(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('semesterId') semesterId?: string,
  ) {
    return this.adminFacultiesService.getClassStatsForFaculty(id, semesterId);
  }

  @ApiOperation({
    summary: 'Danh sách đánh giá của sinh viên trong lớp cho Biên bản Hội đồng Khoa',
    description:
      'Endpoint trả về danh sách sinh viên trong lớp kèm điểm ĐRL Lớp ĐG, ĐRL HĐ Khoa ĐG, Xếp loại và Ghi chú.',
  })
  @ApiResponse({ status: 200, description: 'Thao tác thành công.' })
  @Get(':id/classes/:classId/council-review')
  getCouncilReview(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('classId', ParseUUIDPipe) classId: string,
    @Query('semesterId') semesterId?: string,
  ) {
    return this.adminFacultiesService.getCouncilReviewForClass(id, classId, semesterId);
  }
}

@ApiTags('Admin Faculties')
@ApiBearerAuth('access-token')
@ApiResponse({ status: 401, description: 'Thiếu hoặc sai access token.' })
@Controller('admin/faculties')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.Admin)
export class AdminFacultiesController {
  constructor(private readonly adminFacultiesService: AdminFacultiesService) {}

  @ApiOperation({
    summary: 'Lấy dữ liệu',
    description:
      'Endpoint GET / trong nhóm Admin Faculties; xem schema DTO/query và response mẫu trực tiếp trong Swagger.',
  })
  @ApiResponse({ status: 200, description: 'Thao tác thành công.' })
  @Get()
  findAll(@Query() query: GetFacultiesQueryDto) {
    return this.adminFacultiesService.findAll(query);
  }

  // Backward-compatible route cũ; FE nên chuyển sang GET /faculties/:id/majors.
  @ApiOperation({
    summary: 'Danh sách ngành thuộc khoa (route admin cũ)',
    description:
      'Giữ để tương thích với FE cũ. Luồng dùng chung cho admin và khoa là GET /faculties/:id/majors.',
  })
  @ApiResponse({ status: 200, description: 'Thao tác thành công.' })
  @Get(':id/majors')
  findMajors(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: GetMajorsQueryDto,
  ) {
    return this.adminFacultiesService.findMajors(id, query);
  }

  @ApiOperation({
    summary: 'Lấy dữ liệu',
    description:
      'Endpoint GET :id trong nhóm Admin Faculties; xem schema DTO/query và response mẫu trực tiếp trong Swagger.',
  })
  @ApiResponse({ status: 200, description: 'Thao tác thành công.' })
  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.adminFacultiesService.findOne(id);
  }

  @ApiOperation({
    summary: 'Tạo/Xử lý dữ liệu',
    description:
      'Endpoint POST / trong nhóm Admin Faculties; xem schema DTO/query và response mẫu trực tiếp trong Swagger.',
  })
  @ApiResponse({ status: 201, description: 'Thao tác thành công.' })
  @ApiResponse({ status: 400, description: 'Dữ liệu gửi lên không hợp lệ.' })
  @Post()
  create(@Body() dto: CreateFacultyDto) {
    return this.adminFacultiesService.create(dto);
  }

  @ApiOperation({
    summary: 'Cập nhật dữ liệu',
    description:
      'Endpoint PATCH :id trong nhóm Admin Faculties; xem schema DTO/query và response mẫu trực tiếp trong Swagger.',
  })
  @ApiResponse({ status: 200, description: 'Thao tác thành công.' })
  @ApiResponse({ status: 400, description: 'Dữ liệu gửi lên không hợp lệ.' })
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateFacultyDto,
  ) {
    return this.adminFacultiesService.update(id, dto);
  }

  @ApiOperation({
    summary: 'Cập nhật dữ liệu',
    description:
      'Endpoint PATCH :id/status trong nhóm Admin Faculties; xem schema DTO/query và response mẫu trực tiếp trong Swagger.',
  })
  @ApiResponse({ status: 200, description: 'Thao tác thành công.' })
  @ApiResponse({ status: 400, description: 'Dữ liệu gửi lên không hợp lệ.' })
  @Patch(':id/status')
  updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateFacultyStatusDto,
  ) {
    return this.adminFacultiesService.updateStatus(id, dto);
  }

  @ApiOperation({
    summary: 'Xóa dữ liệu',
    description:
      'Endpoint DELETE :id trong nhóm Admin Faculties; xem schema DTO/query và response mẫu trực tiếp trong Swagger.',
  })
  @ApiResponse({ status: 200, description: 'Thao tác thành công.' })
  @Delete(':id')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.adminFacultiesService.remove(id);
  }
}
