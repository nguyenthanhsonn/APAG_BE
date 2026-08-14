import { Type } from 'class-transformer';
import {
  Allow,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export const TRAINING_RANK_LABELS = [
  'Xuất sắc',
  'Tốt',
  'Khá',
  'Trung bình',
  'Yếu',
] as const;

export type TrainingRankLabel = (typeof TRAINING_RANK_LABELS)[number];

export class BbHopKhoaStudentDto {
  @IsInt()
  @Min(1)
  stt: number;

  @IsString()
  @MaxLength(50)
  maSV: string;

  @IsString()
  @MaxLength(150)
  hoTen: string;

  @IsString()
  @MaxLength(20)
  ngaySinh: string;

  @IsInt()
  @Min(0)
  @Max(100)
  drlLop: number;

  @IsInt()
  @Min(0)
  @Max(100)
  drlKhoa: number;

  @IsIn(TRAINING_RANK_LABELS)
  xepLoai: TrainingRankLabel;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  ghiChu?: string;
}

export class BbHopKhoaMeetingInfoDto {
  @IsString()
  @MaxLength(150)
  tenKhoa: string;

  @IsString()
  @MaxLength(100)
  tenLop: string;

  @IsString()
  @MaxLength(50)
  hocKy: string;

  @IsString()
  @MaxLength(50)
  namHoc: string;

  @IsString()
  @MaxLength(2)
  ngayHop: string;

  @IsString()
  @MaxLength(2)
  thangHop: string;

  @IsString()
  @MaxLength(4)
  namHop: string;

  @IsString()
  @MaxLength(255)
  diaDiem: string;

  @IsString()
  @MaxLength(150)
  chuToa: string;

  @IsString()
  @MaxLength(150)
  thuKy: string;
}

export class ExportBbHopKhoaDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => BbHopKhoaMeetingInfoDto)
  info?: BbHopKhoaMeetingInfoDto;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BbHopKhoaStudentDto)
  students?: BbHopKhoaStudentDto[];

  @Allow()
  khoa?: string;

  @Allow()
  facultyName?: string;

  @Allow()
  lop?: string;

  @Allow()
  className?: string;

  @Allow()
  hocKy?: string;

  @Allow()
  semester?: string;

  @Allow()
  namHoc?: string;

  @Allow()
  academicYear?: string;

  @Allow()
  ngayHop?: string;

  @Allow()
  meetingDay?: string;

  @Allow()
  thangHop?: string;

  @Allow()
  meetingMonth?: string;

  @Allow()
  namHop?: string;

  @Allow()
  meetingYear?: string;

  @Allow()
  diaDiem?: string;

  @Allow()
  location?: string;

  @Allow()
  chuToa?: string;

  @Allow()
  chairperson?: string;

  @Allow()
  thuKy?: string;

  @Allow()
  secretary?: string;

  @Allow()
  qdSo?: string;

  @Allow()
  decisionNo?: string;

  @Allow()
  qdNgay?: string;

  @Allow()
  decisionDay?: string;

  @Allow()
  qdThang?: string;

  @Allow()
  decisionMonth?: string;

  @Allow()
  qdNam?: string;

  @Allow()
  decisionYear?: string;

  @Allow()
  gioBatDau?: string;

  @Allow()
  startTime?: string;

  @Allow()
  tongSoHoiDong?: string;

  @Allow()
  councilTotal?: string;

  @Allow()
  duHopHoiDong?: string;

  @Allow()
  councilPresent?: string;

  @Allow()
  vangHoiDong?: string;

  @Allow()
  councilAbsent?: string;

  @Allow()
  lyDoVangHoiDong?: string;

  @Allow()
  absentReason?: string;

  @Allow()
  moiDu?: string;

  @Allow()
  invited?: string;

  @Allow()
  chuTichHoiDong?: string;

  @Allow()
  councilChairman?: string;

  @Allow()
  truongKhoa?: string;

  @Allow()
  dean?: string;

  @Allow()
  tenThuKy?: string;

  @Allow()
  signerSecretary?: string;

  @Allow()
  classId?: string;

  @Allow()
  facultyId?: string;
}
