import { Injectable, NotFoundException } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { existsSync } from 'node:fs';
import * as path from 'node:path';
import type {
  BbHopLopStudentDto,
  ExportBbHopLopDto,
} from '../dto/export-bb-hop-lop.dto';
import type { TrainingRankLabel } from '../dto/export-bb-hop-khoa.dto';

type BbHopLopInfo = {
  phuLuc: string;
  tenKhoa: string;
  tenLop: string;
  hocKy: string;
  namHoc: string;
  ngayHop: string;
  thangHop: string;
  namHop: string;
  diaDiem: string;
  gioBatDau: string;
  chuToa: string;
  thuKy: string;
  tongSoDuHop: string;
  vangHop: string;
  lyDoVang: string;
};

@Injectable()
export class BbHopLopExportService {
  private readonly worksheetName = 'Mau BB HOP LOP';
  private readonly standardHeaderRows = 6;
  private readonly firstStudentRow = 31;
  private readonly templateMaxRows = 48;

  async export(payload: ExportBbHopLopDto): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(this.getTemplatePath());

    const sheet = workbook.getWorksheet(this.worksheetName);
    if (!sheet) {
      throw new NotFoundException(
        `Không tìm thấy worksheet "${this.worksheetName}" trong template.`,
      );
    }

    const info = this.normalizeInfo(payload);
    const students = payload.students ?? [];

    this.insertStandardHeader(sheet, info);
    this.fillHeader(sheet, info);
    this.fillStudentTable(sheet, students);
    this.fillSummary(sheet, students);

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }

  getFileName(payload: ExportBbHopLopDto): string {
    const className = payload.lop ?? payload.className ?? 'lop';
    const safeClassName = className
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .toLowerCase();

    return `bb-hop-lop-${safeClassName || 'lop'}.xlsx`;
  }

  private getTemplatePath(): string {
    const candidates = [
      path.join(process.cwd(), 'assets/templates/bb-hop-lop.xlsx'),
      path.join(process.cwd(), 'projects/assets/templates/bb-hop-lop.xlsx'),
      path.join(__dirname, '../../../assets/templates/bb-hop-lop.xlsx'),
    ];

    const templatePath = candidates.find((candidate) => existsSync(candidate));
    if (!templatePath) {
      throw new NotFoundException(
        `Không tìm thấy template bb-hop-lop.xlsx. Đã kiểm tra: ${candidates.join(', ')}`,
      );
    }

    return templatePath;
  }

  private normalizeInfo(payload: ExportBbHopLopDto): BbHopLopInfo {
    return {
      phuLuc: payload.phuLuc ?? payload.appendixLabel ?? 'Phụ lục 02',
      tenKhoa: payload.khoa ?? payload.facultyName ?? '',
      tenLop: payload.lop ?? payload.className ?? '',
      hocKy: payload.hocKy ?? payload.semester ?? '',
      namHoc: payload.namHoc ?? payload.academicYear ?? '',
      ngayHop: payload.ngayHop ?? payload.meetingDay ?? '',
      thangHop: payload.thangHop ?? payload.meetingMonth ?? '',
      namHop: this.normalizeYear(payload.namHop ?? payload.meetingYear ?? ''),
      diaDiem: payload.diaDiem ?? payload.location ?? '',
      gioBatDau: payload.gioBatDau ?? payload.startTime ?? '',
      chuToa: payload.chuToa ?? payload.chairperson ?? '',
      thuKy: payload.thuKy ?? payload.secretary ?? '',
      tongSoDuHop: payload.tongSoDuHop ?? payload.totalPresent ?? '',
      vangHop: payload.vangHop ?? payload.absentCount ?? '',
      lyDoVang: payload.lyDoVang ?? payload.absentReason ?? '',
    };
  }

  private fillHeader(sheet: ExcelJS.Worksheet, info: BbHopLopInfo) {
    const row = (rowNumber: number) => rowNumber + this.standardHeaderRows;

    sheet.getCell(`A${row(1)}`).value = `KHOA: ${info.tenKhoa}`;
    sheet.getCell(`A${row(2)}`).value = `LỚP: ${info.tenLop}`;
    sheet.getCell(
      `E${row(3)}`,
    ).value = `Đà Nẵng, ngày ${info.ngayHop} tháng ${info.thangHop} năm ${info.namHop}`;
    sheet.getCell(`A${row(5)}`).value = `BIÊN BẢN HỌP LỚP ${info.tenLop}`;
    sheet.getCell(
      `A${row(6)}`,
    ).value = `Về việc đánh giá kết quả rèn luyện học kỳ ${info.hocKy} năm học: ${info.namHoc}`;
    sheet.getCell(
      `A${row(9)}`,
    ).value = `I. Thời gian: Cuộc họp bắt đầu vào hồi: ${info.gioBatDau} ngày ${info.ngayHop} tháng ${info.thangHop} năm ${info.namHop}`;
    sheet.getCell(`A${row(10)}`).value = `II. Địa điểm: ${info.diaDiem}`;
    sheet.getCell(`A${row(13)}`).value = `Tổng số người dự họp: ${info.tongSoDuHop} người`;
    sheet.getCell(
      `A${row(14)}`,
    ).value = `Vắng họp: ${info.vangHop} người, lý do vắng họp: ${info.lyDoVang}`;
    sheet.getCell(`A${row(15)}`).value = `Chủ tọa: ${info.chuToa}`;
    sheet.getCell(`A${row(16)}`).value = `Thư ký: ${info.thuKy}`;
  }

  private insertStandardHeader(sheet: ExcelJS.Worksheet, info: BbHopLopInfo) {
    const templateMerges = [...sheet.model.merges];
    templateMerges.forEach((range) => sheet.unMergeCells(range));
    sheet.insertRows(1, Array.from({ length: this.standardHeaderRows }, () => []));
    templateMerges.forEach((range) =>
      sheet.mergeCells(this.shiftRangeRows(range, this.standardHeaderRows)),
    );

    sheet.mergeCells('A1:D5');
    sheet.mergeCells('A6:D6');
    sheet.mergeCells('E1:J1');
    sheet.mergeCells('E2:J2');
    sheet.mergeCells('E3:J3');

    sheet.getRow(1).height = 22;
    sheet.getRow(2).height = 22;
    sheet.getRow(3).height = 22;
    sheet.getRow(4).height = 22;
    sheet.getRow(5).height = 22;
    sheet.getRow(6).height = 18;

    const leftHeader = sheet.getCell('A1');
    leftHeader.value =
      'HỌC VIỆN HÀNH CHÍNH\n' +
      'VÀ QUẢN TRỊ CÔNG\n' +
      'PHÂN HIỆU HỌC VIỆN\n' +
      'HÀNH CHÍNH VÀ QUẢN TRỊ CÔNG\n' +
      'TẠI THÀNH PHỐ ĐÀ NẴNG';
    leftHeader.font = {
      bold: true,
      size: 14,
      name: 'Times New Roman',
      family: 1,
    };
    leftHeader.alignment = {
      horizontal: 'center',
      vertical: 'middle',
      wrapText: true,
    };

    const star = sheet.getCell('A6');
    star.value = '*';
    star.font = {
      bold: true,
      size: 14,
      name: 'Times New Roman',
      family: 1,
    };
    star.alignment = { horizontal: 'center', vertical: 'middle' };

    const appendix = sheet.getCell('E1');
    appendix.value = info.phuLuc;
    appendix.font = {
      italic: true,
      bold: true,
      size: 14,
      name: 'Times New Roman',
      family: 1,
    };
    appendix.alignment = { horizontal: 'right', vertical: 'middle' };

    const party = sheet.getCell('E2');
    party.value = 'ĐẢNG CỘNG SẢN VIỆT NAM';
    party.font = {
      bold: true,
      underline: 'single',
      size: 14,
      name: 'Times New Roman',
      family: 1,
    };
    party.alignment = { horizontal: 'center', vertical: 'middle' };
  }

  private shiftRangeRows(range: string, offset: number): string {
    return range.replace(/\d+/g, (rowNumber) =>
      (Number(rowNumber) + offset).toString(),
    );
  }

  private fillStudentTable(
    sheet: ExcelJS.Worksheet,
    students: BbHopLopStudentDto[],
  ) {
    const firstStudentRow = this.firstStudentRow + this.standardHeaderRows;
    const extraRows = students.length - this.templateMaxRows;

    if (extraRows > 0) {
      const templateRow = sheet.getRow(
        firstStudentRow + this.templateMaxRows - 1,
      );

      for (let i = 0; i < extraRows; i++) {
        const newRowIndex = firstStudentRow + this.templateMaxRows + i;
        sheet.insertRow(newRowIndex, []);

        const newRow = sheet.getRow(newRowIndex);
        newRow.height = templateRow.height;
        templateRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
          newRow.getCell(colNumber).style = { ...cell.style };
        });
      }
    }

    students.forEach((student, index) => {
      const row = sheet.getRow(firstStudentRow + index);
      row.getCell(1).value = student.stt;
      row.getCell(2).value = student.maSV;
      row.getCell(3).value = student.hoTen;
      row.getCell(5).value = student.ngaySinh;
      row.getCell(6).value = student.drlSinhVien ?? student.drlSV ?? '';
      row.getCell(7).value = student.drlLop;
      row.getCell(8).value = student.xepLoai ?? this.rankFromScore(student.drlLop);
      row.getCell(9).value = student.bieuQuyet ?? '';
      row.getCell(10).value = student.ghiChu ?? '';
    });
  }

  private fillSummary(sheet: ExcelJS.Worksheet, students: BbHopLopStudentDto[]) {
    const count = (rank: TrainingRankLabel) =>
      students.filter((student) => (student.xepLoai ?? this.rankFromScore(student.drlLop)) === rank)
        .length;

    const extraRows = Math.max(0, students.length - this.templateMaxRows);
    const base =
      this.firstStudentRow +
      this.standardHeaderRows +
      this.templateMaxRows +
      extraRows;

    sheet.getRow(base + 1).getCell(3).value = students.length;
    sheet.getRow(base + 2).getCell(4).value = count('Xuất sắc');
    sheet.getRow(base + 3).getCell(4).value = count('Tốt');
    sheet.getRow(base + 4).getCell(4).value = count('Khá');
    sheet.getRow(base + 5).getCell(4).value = count('Trung bình');
    sheet.getRow(base + 6).getCell(4).value = count('Yếu');
  }

  private rankFromScore(score: number): TrainingRankLabel {
    if (score >= 90) {
      return 'Xuất sắc';
    }

    if (score >= 80) {
      return 'Tốt';
    }

    if (score >= 65) {
      return 'Khá';
    }

    if (score >= 50) {
      return 'Trung bình';
    }

    return 'Yếu';
  }

  private normalizeYear(year: string): string {
    return year.length === 2 ? `20${year}` : year;
  }
}
