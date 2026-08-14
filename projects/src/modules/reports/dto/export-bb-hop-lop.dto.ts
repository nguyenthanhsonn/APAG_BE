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
import { TRAINING_RANK_LABELS, type TrainingRankLabel } from './export-bb-hop-khoa.dto';

export class BbHopLopStudentDto {
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

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  drlSinhVien?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  drlSV?: number;

  @IsInt()
  @Min(0)
  @Max(100)
  drlLop: number;

  @IsOptional()
  @IsIn(TRAINING_RANK_LABELS)
  xepLoai?: TrainingRankLabel;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  bieuQuyet?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  ghiChu?: string;
}

export class ExportBbHopLopDto {
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BbHopLopStudentDto)
  students?: BbHopLopStudentDto[];

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
  gioBatDau?: string;

  @Allow()
  startTime?: string;

  @Allow()
  chuToa?: string;

  @Allow()
  chairperson?: string;

  @Allow()
  thuKy?: string;

  @Allow()
  secretary?: string;

  @Allow()
  tongSoDuHop?: string;

  @Allow()
  totalPresent?: string;

  @Allow()
  vangHop?: string;

  @Allow()
  absentCount?: string;

  @Allow()
  lyDoVang?: string;

  @Allow()
  absentReason?: string;

  @Allow()
  classId?: string;

  @Allow()
  facultyId?: string;

  @Allow()
  phuLuc?: string;

  @Allow()
  appendixLabel?: string;
}
