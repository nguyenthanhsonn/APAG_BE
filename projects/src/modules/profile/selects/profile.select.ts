import { Prisma } from '../../../generated/prisma/client';

export const profileSelect = {
  id: true,
  username: true,
  email: true,
  fullName: true,
  role: true,
  phone: true,
  dateOfBirth: true,
  isActive: true,
  classStudents: {
    where: { deletedAt: null },
    orderBy: { enrolledAt: 'desc' },
    take: 1,
    select: {
      studentCode: true,
      enrolledAt: true,
      class: {
        select: {
          id: true,
          code: true,
          name: true,
          enrollmentYear: true,
          major: {
            select: {
              id: true,
              code: true,
              name: true,
              faculty: {
                select: {
                  id: true,
                  code: true,
                  name: true,
                },
              },
            },
          },
        },
      },
    },
  },
  classLeaderAssignments: {
    select: {
      assignedAt: true,
      class: {
        select: {
          id: true,
          code: true,
          name: true,
          enrollmentYear: true,
          _count: {
            select: {
              classStudents: true,
            },
          },
          major: {
            select: {
              id: true,
              code: true,
              name: true,
              faculty: {
                select: {
                  id: true,
                  code: true,
                  name: true,
                },
              },
            },
          },
        },
      },
    },
    orderBy: {
      assignedAt: 'desc',
    },
  },
  advisorAssignments: {
    select: {
      assignedAt: true,
      class: {
        select: {
          id: true,
          code: true,
          name: true,
          enrollmentYear: true,
          _count: {
            select: {
              classStudents: true,
            },
          },
          major: {
            select: {
              id: true,
              code: true,
              name: true,
              faculty: {
                select: {
                  id: true,
                  code: true,
                  name: true,
                },
              },
            },
          },
        },
      },
    },
    orderBy: {
      assignedAt: 'desc',
    },
  },
  facultyAssignment: {
    select: {
      assignedAt: true,
      faculty: {
        select: {
          id: true,
          code: true,
          name: true,
        },
      },
    },
  },
} satisfies Prisma.UserSelect;

export type ProfileRecord = Prisma.UserGetPayload<{
  select: typeof profileSelect;
}>;
