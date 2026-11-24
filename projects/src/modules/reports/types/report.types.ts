import type { EvalRank, FormStatus } from '../../../generated/prisma/client';

/** Số lượng phiếu theo từng xếp loại rèn luyện. */
export type RankDistribution = Record<EvalRank, number>;

/** Số lượng phiếu theo từng trạng thái trong luồng duyệt. */
export type StatusDistribution = Partial<Record<FormStatus, number>>;

/** GET /admin/reports/overview — bức tranh tổng quan theo trạng thái duyệt. */
export type ReportOverviewResponse = {
  totalForms: number;
  byStatus: StatusDistribution;
};

/** GET /admin/reports/training-results — kết quả rèn luyện đã chốt (chỉ tính phiếu finalized). */
export type TrainingResultsResponse = {
  totalFinalized: number;
  averageFinalScore: number | null;
  byRank: RankDistribution;
};

/** 1 dòng trong GET /admin/reports/by-class. */
export type ReportByClassItem = {
  classId: string;
  classCode: string;
  className: string;
  totalFinalized: number;
  averageFinalScore: number | null;
  byRank: RankDistribution;
};

/** 1 dòng trong GET /admin/reports/by-faculty (roll-up từ dữ liệu theo lớp). */
export type ReportByFacultyItem = {
  facultyId: string;
  facultyCode: string;
  facultyName: string;
  totalFinalized: number;
  averageFinalScore: number | null;
  byRank: RankDistribution;
};

/** 1 dòng dữ liệu phẳng dùng để render ra file Excel/PDF. */
export type FlatExportRow = {
  fullName: string;
  email: string;
  className: string;
  facultyName: string;
  semester: string;
  academicYear: string;
  studentScore: number | string;
  classScore: number | string;
  facultyScore: number | string;
  finalScore: number | string;
  classification: string;
  statusLabel: string;
};
