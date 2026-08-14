import { Injectable, NotFoundException } from '@nestjs/common';
import Docxtemplater from 'docxtemplater';
import { existsSync, readFileSync } from 'node:fs';
import * as path from 'node:path';
import PizZip from 'pizzip';
import type {
  BbHopKhoaMeetingInfoDto,
  BbHopKhoaStudentDto,
  ExportBbHopKhoaDto,
} from '../dto/export-bb-hop-khoa.dto';

@Injectable()
export class BbHopKhoaDocxExportService {
  export(
    info: BbHopKhoaMeetingInfoDto,
    students: BbHopKhoaStudentDto[],
    payload?: ExportBbHopKhoaDto,
  ): Buffer {
    const content = readFileSync(this.getTemplatePath(), 'binary');
    const zip = new PizZip(content);
    const doc = new Docxtemplater(zip, {
      paragraphLoop: true,
      linebreaks: true,
    });

    doc.render({
      ten_khoa: info.tenKhoa,
      ten_lop: info.tenLop,
      hoc_ky: info.hocKy,
      nam_hoc: info.namHoc,
      ngay_hop: info.ngayHop,
      thang_hop: info.thangHop,
      nam_hop: info.namHop,
      dia_diem: info.diaDiem,
      chu_toa: info.chuToa,
      thu_ky: info.thuKy,
      students,
      tong_so: students.length,
      ...this.buildPayloadTemplateData(payload),
      ...this.buildSummary(students),
    });

    return doc.getZip().generate({ type: 'nodebuffer' }) as Buffer;
  }

  private getTemplatePath(): string {
    const candidates = [
      path.join(process.cwd(), 'assets/templates/bb-hop-khoa.docx'),
      path.join(process.cwd(), 'projects/assets/templates/bb-hop-khoa.docx'),
      path.join(__dirname, '../../../assets/templates/bb-hop-khoa.docx'),
    ];

    const templatePath = candidates.find((candidate) => existsSync(candidate));
    if (!templatePath) {
      throw new NotFoundException(
        `Không tìm thấy template bb-hop-khoa.docx. Đã kiểm tra: ${candidates.join(', ')}`,
      );
    }

    return templatePath;
  }

  private buildSummary(students: BbHopKhoaStudentDto[]) {
    const count = (rank: BbHopKhoaStudentDto['xepLoai']) =>
      students.filter((student) => student.xepLoai === rank).length;

    return {
      xuat_sac: count('Xuất sắc'),
      tot: count('Tốt'),
      kha: count('Khá'),
      trung_binh: count('Trung bình'),
      yeu: count('Yếu'),
    };
  }

  private buildPayloadTemplateData(payload?: ExportBbHopKhoaDto) {
    const value = (...values: Array<string | undefined>) =>
      values.find((item) => item !== undefined) ?? '';

    return {
      khoa: value(payload?.khoa, payload?.facultyName),
      lop: value(payload?.lop, payload?.className),
      faculty_name: value(payload?.facultyName, payload?.khoa),
      class_name: value(payload?.className, payload?.lop),
      qd_so: value(payload?.qdSo, payload?.decisionNo),
      qd_ngay: value(payload?.qdNgay, payload?.decisionDay),
      qd_thang: value(payload?.qdThang, payload?.decisionMonth),
      qd_nam: value(payload?.qdNam, payload?.decisionYear),
      decision_no: value(payload?.decisionNo, payload?.qdSo),
      decision_day: value(payload?.decisionDay, payload?.qdNgay),
      decision_month: value(payload?.decisionMonth, payload?.qdThang),
      decision_year: value(payload?.decisionYear, payload?.qdNam),
      gio_bat_dau: value(payload?.gioBatDau, payload?.startTime),
      start_time: value(payload?.startTime, payload?.gioBatDau),
      tong_so_hoi_dong: value(payload?.tongSoHoiDong, payload?.councilTotal),
      du_hop_hoi_dong: value(payload?.duHopHoiDong, payload?.councilPresent),
      vang_hoi_dong: value(payload?.vangHoiDong, payload?.councilAbsent),
      ly_do_vang_hoi_dong: value(
        payload?.lyDoVangHoiDong,
        payload?.absentReason,
      ),
      council_total: value(payload?.councilTotal, payload?.tongSoHoiDong),
      council_present: value(payload?.councilPresent, payload?.duHopHoiDong),
      council_absent: value(payload?.councilAbsent, payload?.vangHoiDong),
      absent_reason: value(payload?.absentReason, payload?.lyDoVangHoiDong),
      moi_du: value(payload?.moiDu, payload?.invited),
      invited: value(payload?.invited, payload?.moiDu),
      chu_tich_hoi_dong: value(
        payload?.chuTichHoiDong,
        payload?.councilChairman,
      ),
      council_chairman: value(
        payload?.councilChairman,
        payload?.chuTichHoiDong,
      ),
      truong_khoa: value(payload?.truongKhoa, payload?.dean),
      dean: value(payload?.dean, payload?.truongKhoa),
      ten_thu_ky: value(payload?.tenThuKy, payload?.signerSecretary),
      signer_secretary: value(payload?.signerSecretary, payload?.tenThuKy),
    };
  }
}
