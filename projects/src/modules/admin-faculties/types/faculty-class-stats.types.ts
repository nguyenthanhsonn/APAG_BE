export type FacultyClassStatus =
  | 'IN_PROGRESS'
  | 'PENDING_FACULTY'
  | 'FACULTY_APPROVED';

export interface FacultyClassStatsItem {
  id: string;
  className: string;
  classCode: string;
  leader: string;
  totalStudents: number;
  totalStudentsLabel: string;
  submittedCount: number;
  approvedCount: number;
  submittedFraction: string;
  status: FacultyClassStatus;
  statusLabel: string;
  transferredDate: string;
  canSubmitToTrainingDepartment: boolean;
}

export interface FacultyClassStatsResponse {
  totalClasses: number;
  items: FacultyClassStatsItem[];
}

export interface FacultyCouncilReviewItem {
  stt: number;
  studentId: string;
  studentCode: string;
  fullName: string;
  dateOfBirth: string;
  evaluationId: string | null;
  status: string;
  classScore: number | null;
  facultyScore: number | null;
  classification: string;
  note: string;
}

export interface FacultyCouncilReviewResponse {
  classId: string;
  className: string;
  totalStudents: number;
  items: FacultyCouncilReviewItem[];
}
