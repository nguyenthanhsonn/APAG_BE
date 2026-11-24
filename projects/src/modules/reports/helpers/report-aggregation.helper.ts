import { EvalRank, FormStatus } from '../../../generated/prisma/client';
import type { EvaluationAdminListItem } from '../../training-evaluations/types/evaluation-form.types';
import type {
  FlatExportRow,
  RankDistribution,
  ReportByFacultyItem,
  StatusDistribution,
} from '../types/report.types';

export type RankGroup = {
  classId: string;
  rank: EvalRank | null;
  _count: { _all: number };
};

export type RankOnlyGroup = {
  rank: EvalRank | null;
  _count: { _all: number };
};

export type ClassScoreSumGroup = {
  classId: string;
  _sum: { finalScore: number | null };
  _count: { _all: number };
};

export type StatusGroup = {
  status: FormStatus;
  _count: { _all: number };
};

/** Khởi tạo phân bố xếp loại rỗng — đảm bảo luôn đủ 6 key dù không có dữ liệu. */
export function emptyRankDistribution(): RankDistribution {
  return {
    [EvalRank.excellent]: 0,
    [EvalRank.good]: 0,
    [EvalRank.fair]: 0,
    [EvalRank.average]: 0,
    [EvalRank.weak]: 0,
    [EvalRank.poor]: 0,
  };
}

/** Khởi tạo phân bố trạng thái rỗng — đảm bảo luôn đủ 6 key dù không có dữ liệu. */
export function emptyStatusDistribution(): StatusDistribution {
  return {
    [FormStatus.draft]: 0,
    [FormStatus.submitted]: 0,
    [FormStatus.class_leader_approved]: 0,
    [FormStatus.class_approved]: 0,
    [FormStatus.faculty_approved]: 0,
    [FormStatus.finalized]: 0,
    [FormStatus.rejected]: 0,
  };
}

/** Gom nhóm kết quả groupBy(status) thành phân bố trạng thái phẳng. */
export function buildStatusDistribution(groups: StatusGroup[]): StatusDistribution {
  const distribution = emptyStatusDistribution();

  for (const group of groups) {
    distribution[group.status] =
      (distribution[group.status] ?? 0) + group._count._all;
  }

  return distribution;
}

/** Gom nhóm kết quả groupBy(rank) — không kèm classId — thành phân bố xếp loại toàn hệ thống. */
export function buildRankDistribution(groups: RankOnlyGroup[]): RankDistribution {
  const distribution = emptyRankDistribution();

  for (const group of groups) {
    if (group.rank) {
      distribution[group.rank] += group._count._all;
    }
  }

  return distribution;
}

/**
 * Pivot kết quả groupBy(classId, rank) thành Map<classId, phân bố xếp loại>.
 * Dùng chung cho cả build-by-class và roll-up lên by-faculty.
 */
export function pivotRankByClass(groups: RankGroup[]): Map<string, RankDistribution> {
  const map = new Map<string, RankDistribution>();

  for (const group of groups) {
    if (!group.rank) continue;

    const distribution = map.get(group.classId) ?? emptyRankDistribution();
    distribution[group.rank] += group._count._all;
    map.set(group.classId, distribution);
  }

  return map;
}

/** Tính điểm trung bình từ tổng điểm + số lượng, làm tròn 1 chữ số thập phân. */
export function calculateAverage(sum: number | null, count: number): number | null {
  if (count === 0 || sum === null) {
    return null;
  }

  return Math.round((sum / count) * 10) / 10;
}

/**
 * Gom nhóm số liệu theo lớp lên theo khoa (Class -> Major -> Faculty).
 * Tính trực tiếp từ tổng điểm + số lượng thô (không phải trung bình của trung bình
 * đã làm tròn) để đảm bảo điểm trung bình cấp khoa chính xác.
 */
export function rollUpToFaculties(
  sumGroups: ClassScoreSumGroup[],
  rankGroups: RankGroup[],
  classToFaculty: Map<string, { id: string; code: string; name: string }>,
): ReportByFacultyItem[] {
  type FacultyBucket = {
    faculty: { id: string; code: string; name: string };
    sum: number;
    count: number;
    byRank: RankDistribution;
  };

  const rankByClass = pivotRankByClass(rankGroups);
  const buckets = new Map<string, FacultyBucket>();

  for (const sumGroup of sumGroups) {
    const faculty = classToFaculty.get(sumGroup.classId);
    if (!faculty) continue;

    const bucket = buckets.get(faculty.id) ?? {
      faculty,
      sum: 0,
      count: 0,
      byRank: emptyRankDistribution(),
    };

    bucket.sum += sumGroup._sum.finalScore ?? 0;
    bucket.count += sumGroup._count._all;

    const classRank = rankByClass.get(sumGroup.classId) ?? emptyRankDistribution();
    for (const rank of Object.values(EvalRank)) {
      bucket.byRank[rank] += classRank[rank];
    }

    buckets.set(faculty.id, bucket);
  }

  return [...buckets.values()].map((bucket) => ({
    facultyId: bucket.faculty.id,
    facultyCode: bucket.faculty.code,
    facultyName: bucket.faculty.name,
    totalFinalized: bucket.count,
    averageFinalScore: calculateAverage(bucket.sum, bucket.count),
    byRank: bucket.byRank,
  }));
}

/** Chuyển 1 dòng danh sách admin (nested) sang dòng phẳng để render Excel/PDF. */
export function flattenForExport(item: EvaluationAdminListItem): FlatExportRow {
  const classScoreVal = item.classScore ?? '';
  const facultyScoreVal = (item as any).facultyScore ?? classScoreVal;
  const finalScoreVal = item.finalScore ?? classScoreVal;

  return {
    fullName: item.student.fullName,
    email: item.student.email,
    className: item.class.name,
    facultyName: item.faculty.name,
    semester: item.semester,
    academicYear: item.academicYear,
    studentScore: item.studentScore ?? '',
    classScore: classScoreVal,
    facultyScore: facultyScoreVal,
    finalScore: finalScoreVal,
    classification: item.classification ?? '',
    statusLabel: item.statusLabel,
  };
}
