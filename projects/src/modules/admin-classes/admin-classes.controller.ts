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
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { ConfirmImportDto } from '../../common/dto/confirm-import.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { UserRole } from '../../common/shared';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminStudentsService } from '../admin-students/admin-students.service';
import { CreateStudentDto } from '../admin-students/dto/create-student.dto';
import { GetAdminStudentsQueryDto } from '../admin-students/dto/get-admin-students-query.dto';
import { UpdateStudentDto } from '../admin-students/dto/update-student.dto';
import { AdminClassCatalogService } from './admin-class-catalog.service';
import type { UploadedClassExcelFile } from './admin-class-catalog.service';
import { AddClassStudentDto } from './dto/add-class-student.dto';
import { ConfirmImportStudentsDto } from './dto/confirm-import-students.dto';
import { CreateClassDto } from './dto/create-class.dto';
import { GetClassesQueryDto } from './dto/get-classes-query.dto';
import { GetClassStudentsQueryDto } from './dto/get-class-students-query.dto';
import { UpdateClassDto } from './dto/update-class.dto';
import { UpdateClassLeadersDto } from './dto/update-class-leaders.dto';
import {
  AdminClassesService,
  type UploadedExcelFile,
} from './admin-classes.service';

@Controller('admin/classes')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.Admin, UserRole.ClassLeader, UserRole.Advisor, UserRole.Faculty)
export class AdminClassesController {
  constructor(
    private readonly adminClassesService: AdminClassesService,
    private readonly adminClassCatalogService: AdminClassCatalogService,
  ) {}

  @Get(':classId/students')
  findStudents(
    @CurrentUser('id') userId: string,
    @CurrentUser('role') role: UserRole,
    @Param('classId', ParseUUIDPipe) classId: string,
    @Query() query: GetClassStudentsQueryDto,
  ) {
    return this.adminClassesService.findStudents(userId, role, classId, query);
  }

  @Post(':classId/students')
  addStudent(
    @CurrentUser('id') userId: string,
    @CurrentUser('role') role: UserRole,
    @Param('classId', ParseUUIDPipe) classId: string,
    @Body() dto: AddClassStudentDto,
  ) {
    return this.adminClassesService.addStudent(userId, role, classId, dto);
  }

  @Delete(':classId/students/:studentId')
  removeStudent(
    @CurrentUser('id') userId: string,
    @CurrentUser('role') role: UserRole,
    @Param('classId', ParseUUIDPipe) classId: string,
    @Param('studentId', ParseUUIDPipe) studentId: string,
  ) {
    return this.adminClassesService.removeStudent(
      userId,
      role,
      classId,
      studentId,
    );
  }

  @Post(':classId/students/import')
  @UseInterceptors(FileInterceptor('file'))
  importStudents(
    @CurrentUser('id') userId: string,
    @CurrentUser('role') role: UserRole,
    @Param('classId', ParseUUIDPipe) classId: string,
    @UploadedFile() file: UploadedExcelFile | undefined,
  ) {
    return this.adminClassesService.importStudents(userId, role, classId, file);
  }

  // ─── CRUD danh mục lớp (Task 4.2) - Admin-only, đặt sau route nested phía trên ──
  // để đảm bảo "/:classId/students*" luôn được match trước route ":id" ở đây.
  // (Về bản chất path đã khác độ sâu nên không thực sự xung đột, nhưng giữ thứ tự
  // này để nhất quán và an toàn tuyệt đối.)

  @Get()
  @Roles(UserRole.Admin)
  findAllClasses(@Query() query: GetClassesQueryDto) {
    return this.adminClassCatalogService.findAll(query);
  }

  @Get('import-template')
  @Roles(UserRole.Admin)
  async downloadClassImportTemplate(@Res() res: Response) {
    const buffer = await this.adminClassCatalogService.generateImportTemplate();

    res.set({
      'Content-Type':
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename=mau_import_lop.xlsx',
    });
    res.send(buffer);
  }

  @Post('import')
  @Roles(UserRole.Admin)
  @UseInterceptors(FileInterceptor('file'))
  importClasses(@UploadedFile() file: UploadedClassExcelFile | undefined) {
    return this.adminClassCatalogService.importFromTemplate(file);
  }

  @Post('import/confirm')
  @Roles(UserRole.Admin)
  confirmImportClasses(@Body() dto: ConfirmImportDto) {
    return this.adminClassCatalogService.confirmImport(dto.importToken);
  }

  @Get(':id')
  @Roles(UserRole.Admin)
  findOneClass(@Param('id', ParseUUIDPipe) id: string) {
    return this.adminClassCatalogService.findOne(id);
  }

  @Patch(':id/class-leaders')
  @Roles(UserRole.Admin)
  updateClassLeaders(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateClassLeadersDto,
  ) {
    return this.adminClassCatalogService.updateClassLeaders(id, dto);
  }

  @Post()
  @Roles(UserRole.Admin)
  createClass(@Body() dto: CreateClassDto) {
    return this.adminClassCatalogService.create(dto);
  }

  @Patch(':id')
  @Roles(UserRole.Admin)
  updateClass(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateClassDto,
  ) {
    return this.adminClassCatalogService.update(id, dto);
  }

  @Delete(':id')
  @Roles(UserRole.Admin)
  removeClass(@Param('id', ParseUUIDPipe) id: string) {
    return this.adminClassCatalogService.remove(id);
  }
}

@Controller('classes')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ClassLeader, UserRole.Advisor, UserRole.Faculty, UserRole.Admin)
export class ClassLeaderClassesController {
  constructor(
    private readonly adminClassesService: AdminClassesService,
    private readonly adminClassCatalogService: AdminClassCatalogService,
  ) {}

  @Get(':id')
  findOneManagedClass(
    @CurrentUser('id') userId: string,
    @CurrentUser('role') role: UserRole,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.adminClassCatalogService.findOneForClassLeader(userId, role, id);
  }

  @Get(':classId/students')
  findStudents(
    @CurrentUser('id') userId: string,
    @CurrentUser('role') role: UserRole,
    @Param('classId', ParseUUIDPipe) classId: string,
    @Query() query: GetClassStudentsQueryDto,
  ) {
    return this.adminClassesService.findStudents(userId, role, classId, query);
  }
}

@Controller('admin/students')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.Admin)
export class AdminStudentsController {
  constructor(
    private readonly adminClassesService: AdminClassesService,
    private readonly adminStudentsService: AdminStudentsService,
  ) {}

  @Get('import-template')
  async downloadImportTemplate(@Res() res: Response) {
    const buffer = await this.adminClassesService.generateImportTemplate();

    res.set({
      'Content-Type':
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename=mau_import_sinh_vien.xlsx',
    });
    res.send(buffer);
  }

  @Post('import')
  @UseInterceptors(FileInterceptor('file'))
  importStudents(
    @CurrentUser('id') userId: string,
    @CurrentUser('role') role: UserRole,
    @UploadedFile() file: UploadedExcelFile | undefined,
  ) {
    return this.adminClassesService.importStudentsFromTemplate(
      userId,
      role,
      file,
    );
  }

  @Post('import/confirm')
  confirmImportStudents(
    @CurrentUser('id') userId: string,
    @CurrentUser('role') role: UserRole,
    @Body() dto: ConfirmImportStudentsDto,
  ) {
    return this.adminClassesService.confirmImportStudents(
      userId,
      role,
      dto.importToken,
    );
  }

  // ─── CRUD hồ sơ sinh viên (Task 4.1) - Admin-only, đặt sau route tĩnh phía trên ──
  // để đảm bảo "import-template"/"import" luôn được match trước route ":id".

  @Get()
  @Roles(UserRole.Admin)
  findAll(@Query() query: GetAdminStudentsQueryDto) {
    return this.adminStudentsService.findAll(query);
  }

  @Get(':id/evaluations')
  @Roles(UserRole.Admin)
  findEvaluations(@Param('id', ParseUUIDPipe) id: string) {
    return this.adminStudentsService.findEvaluations(id);
  }

  @Get(':id')
  @Roles(UserRole.Admin)
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.adminStudentsService.findOne(id);
  }

  @Post()
  @Roles(UserRole.Admin)
  create(@Body() dto: CreateStudentDto) {
    return this.adminStudentsService.create(dto);
  }

  @Patch(':id')
  @Roles(UserRole.Admin)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateStudentDto,
  ) {
    return this.adminStudentsService.update(id, dto);
  }

  @Delete(':id')
  @Roles(UserRole.Admin)
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.adminStudentsService.remove(id);
  }
}
