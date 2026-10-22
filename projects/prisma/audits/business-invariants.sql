-- Read-only. Chạy trên schema mục tiêu trước migration; chỉ trả số lượng, không xuất PII.
SELECT
  (SELECT count(*) FROM semesters WHERE is_active) AS active_semesters,
  (SELECT count(*) FROM (SELECT student_id, semester_id FROM evaluation_forms GROUP BY 1,2 HAVING count(*) > 1) x) AS duplicate_evaluations,
  (SELECT count(*) FROM (SELECT username FROM users GROUP BY 1 HAVING count(*) > 1) x) AS duplicate_usernames,
  (SELECT count(*) FROM (SELECT lower(btrim(username)) FROM users GROUP BY 1 HAVING count(*) > 1) x) AS duplicate_normalized_usernames,
  (SELECT count(*) FROM (SELECT student_code FROM class_students GROUP BY 1 HAVING count(*) > 1) x) AS duplicate_student_codes,
  (SELECT count(*) FROM (SELECT student_id FROM class_students GROUP BY 1 HAVING count(*) > 1) x) AS duplicate_student_enrollments,
  (SELECT count(*) FROM (SELECT user_id FROM class_leader_assignments GROUP BY 1 HAVING count(*) > 1) x) AS duplicate_class_leader_users,
  (SELECT count(*) FROM (SELECT user_id, class_id FROM advisor_assignments GROUP BY 1,2 HAVING count(*) > 1) x) AS duplicate_advisor_pairs,
  (SELECT count(*) FROM (SELECT user_id FROM faculty_assignments GROUP BY 1 HAVING count(*) > 1) x) AS duplicate_faculty_users;

-- Đối chiếu catalog thực tế, không suy luận chỉ từ schema.prisma.
SELECT tablename, indexname, indexdef
FROM pg_indexes
WHERE schemaname = current_schema()
  AND tablename IN ('evaluation_forms', 'users', 'class_students',
    'class_leader_assignments', 'advisor_assignments', 'faculty_assignments', 'semesters')
  AND indexdef LIKE 'CREATE UNIQUE INDEX%'
ORDER BY tablename, indexname;
