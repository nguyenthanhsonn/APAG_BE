-- Tối đa một học kỳ active; cho phép không có học kỳ active và nhiều kỳ inactive.
-- Không tự chọn/đóng học kỳ: dữ liệu vi phạm phải được nghiệp vụ xử lý trước deploy.
BEGIN;
-- Username có cùng ý nghĩa sau normalizeUsername() phải là cùng một định danh,
-- kể cả khi SQL/import ngoài app bỏ qua chuẩn hóa chữ thường/khoảng trắng.
CREATE UNIQUE INDEX "users_username_normalized_key"
  ON "users" (lower(btrim("username")));
CREATE UNIQUE INDEX "semesters_single_active_key"
  ON "semesters" ("is_active") WHERE "is_active" = true;
COMMIT;
