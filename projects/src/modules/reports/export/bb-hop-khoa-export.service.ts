import { Injectable, NotFoundException } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { existsSync } from 'node:fs';
import * as path from 'node:path';
import type {
  BbHopKhoaMeetingInfoDto,
  BbHopKhoaStudentDto,
} from '../dto/export-bb-hop-khoa.dto';

@Injectable()
export class BbHopKhoaExportService {
  private readonly worksheetName = 'Mau BB HOP KHOA';
  private readonly firstStudentRow = 30;
  private readonly templateMaxRows = 48;

  async export(
    info: BbHopKhoaMeetingInfoDto,
    students: BbHopKhoaStudentDto[],
  ): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(this.getTemplatePath());

    const sheet = workbook.getWorksheet(this.worksheetName);
    if (!sheet) {
      throw new NotFoundException(
        `Không tìm thấy worksheet "${this.worksheetName}" trong template.`,
      );
    }

    this.fillHeader(sheet, info);
    this.fillStudentTable(sheet, students);
    this.fillSummary(sheet, students);

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }

  private getTemplatePath(): string {
    const candidates = [
      path.join(process.cwd(), 'assets/templates/bb-hop-khoa.xlsx'),
      path.join(process.cwd(), 'projects/assets/templates/bb-hop-khoa.xlsx'),
      path.join(__dirname, '../../../assets/templates/bb-hop-khoa.xlsx'),
    ];

    const templatePath = candidates.find((candidate) => existsSync(candidate));
    if (!templatePath) {
      throw new NotFoundException(
        `Không tìm thấy template bb-hop-khoa.xlsx. Đã kiểm tra: ${candidates.join(', ')}`,
      );
    }

    return templatePath;
  }

  private fillHeader(sheet: ExcelJS.Worksheet, info: BbHopKhoaMeetingInfoDto) {
    sheet.getCell('A3').value = `KHOA: ${info.tenKhoa}`;
    sheet.getCell(
      'D3',
    ).value = `Đà Nẵng, ngày ${info.ngayHop} tháng ${info.thangHop} năm ${this.normalizeYear(info.namHop)}`;

    sheet.getCell(
      'A7',
    ).value = `Về việc đánh giá kết quả rèn luyện của sinh viên lớp ${info.tenLop}`;
    sheet.getCell('A8').value = `học kỳ ${info.hocKy} năm học ${info.namHoc}`;

    sheet.getCell('A11').value = `II. Địa điểm: ${info.diaDiem}`;
    sheet.getCell('A18').value = `Chủ tọa: ${info.chuToa}`;
    sheet.getCell('A19').value = `Thư ký: ${info.thuKy}`;
  }

  private normalizeYear(year: string): string {
    return year.length === 2 ? `20${year}` : year;
  }

  private fillStudentTable(
    sheet: ExcelJS.Worksheet,
    students: BbHopKhoaStudentDto[],
  ) {
    const extraRows = students.length - this.templateMaxRows;

    if (extraRows > 0) {
      const templateRow = sheet.getRow(
        this.firstStudentRow + this.templateMaxRows - 1,
      );

      for (let i = 0; i < extraRows; i++) {
        const newRowIndex = this.firstStudentRow + this.templateMaxRows + i;
        sheet.insertRow(newRowIndex, []);

        const newRow = sheet.getRow(newRowIndex);
        newRow.height = templateRow.height;
        templateRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
          newRow.getCell(colNumber).style = { ...cell.style };
        });
      }
    }

    students.forEach((student, index) => {
      const row = sheet.getRow(this.firstStudentRow + index);
      row.getCell(1).value = student.stt;
      row.getCell(2).value = student.maSV;
      row.getCell(3).value = student.hoTen;
      row.getCell(5).value = student.ngaySinh;
      row.getCell(6).value = student.drlLop;
      row.getCell(7).value = student.drlKhoa;
      row.getCell(8).value = student.xepLoai;
      row.getCell(9).value = student.ghiChu ?? '';
    });
  }

  private fillSummary(sheet: ExcelJS.Worksheet, students: BbHopKhoaStudentDto[]) {
    const count = (rank: BbHopKhoaStudentDto['xepLoai']) =>
      students.filter((student) => student.xepLoai === rank).length;

    const extraRows = Math.max(0, students.length - this.templateMaxRows);
    const base = this.firstStudentRow + this.templateMaxRows + extraRows;

    sheet.getRow(base + 1).getCell(3).value = students.length;
    sheet.getRow(base + 2).getCell(4).value = count('Xuất sắc');
    sheet.getRow(base + 3).getCell(4).value = count('Tốt');
    sheet.getRow(base + 4).getCell(4).value = count('Khá');
    sheet.getRow(base + 5).getCell(4).value = count('Trung bình');
    sheet.getRow(base + 6).getCell(4).value = count('Yếu');
  }
}
