# Database business invariants

Cập nhật 20/10/2026. Đã đối chiếu schema Prisma, lịch sử migration, catalog PostgreSQL local và các endpoint tạo/cập nhật/import.

## Quy tắc và hai lớp bảo vệ

| Rule | Application validation | DB constraint/index |
|---|---|---|
| Một phiếu / sinh viên / học kỳ | `EvaluationSubmitService.create` tra cặp trước khi tạo; race trả 409 | UNIQUE `evaluation_forms(student_id, semester_id)` đã có |
| Username duy nhất | Chuẩn hóa trim/lower tại DTO **và service**, precheck create/update tài khoản quản trị và sinh viên, bao gồm tài khoản xóa mềm; import có precheck riêng | UNIQUE `users(username)` đã có; migration mới bổ sung UNIQUE `lower(btrim(username))` cho writer bỏ qua chuẩn hóa |
| Mã sinh viên duy nhất | Precheck create/update enrollment và import; tính cả hồ sơ xóa mềm; race trả 409 | UNIQUE `class_students(student_code)` đã có |
| Một hồ sơ lớp / sinh viên | Chuyển lớp bằng update enrollment hiện có; import kiểm tra enrollment | UNIQUE `class_students(student_id)` đã có; unique cặp `(class_id, student_id)` giữ nguyên |
| Lớp trưởng thuộc tối đa một lớp | API danh sách lớp trưởng kiểm tra phân công ở lớp khác trước khi thay thế; quản lý tài khoản thay thế assignment trong transaction | UNIQUE `class_leader_assignments(user_id)` đã có |
| Không trùng phân công CVHT/lớp | Thay thế assignment trong transaction khi quản lý tài khoản | UNIQUE `advisor_assignments(user_id, class_id)` đã có |
| Tài khoản khoa thuộc tối đa một khoa | Thay thế assignment trong transaction, kiểm tra khoa và role | UNIQUE `faculty_assignments(user_id)` đã có |
| Không trùng năm/học kỳ | Precheck create/update; race trả 409 | UNIQUE `semesters(year, semester)` đã có |
| Tối đa một học kỳ active | Mở kỳ sẽ đóng kỳ khác, khóa phiếu kỳ cũ và mở khóa phiếu kỳ đích trong cùng transaction. Advisory transaction lock dùng chung giữa các instance, đọc lại trạng thái sau khi có khóa | Migration mới: UNIQUE `semesters(is_active) WHERE is_active = true` |

Không thêm unique trên `class_id` của assignment hoặc `faculty_id`: source/API hiện cho phép nhiều lớp trưởng trong một lớp, nhiều CVHT của một lớp và nhiều tài khoản phụ trách một khoa. CVHT có thể có các assignment khác lớp; không ép unique trên `advisor_assignments.user_id`.

“Single active” là **tối đa một**, không bắt buộc luôn có một: API hiện cho phép đóng kỳ mà chưa mở kỳ khác. Không khai báo `isActive @unique` trong Prisma vì như vậy còn giới hạn số kỳ inactive. Partial/expression index được quản lý bằng SQL migration và có comment chỉ dẫn tại schema Prisma.

Unique username/studentCode là toàn cục, kể cả record soft delete. Mã sinh viên giữ phép so sánh case-sensitive hiện tại; không tự thay đổi rule sang case-insensitive. Username có quy tắc normalize rõ trong `username.helper.ts`, nên index mới bảo vệ cả giá trị khác hoa/thường/khoảng trắng bên ngoài app.

## Xử lý cạnh tranh

Precheck dùng để báo lỗi trước khi ghi, không thay thế constraint. Hai request cùng vượt qua precheck vẫn chỉ một lần ghi thành công. `throwBusinessUniqueConflict` chuyển P2002 thành 409 đúng theo loại dữ liệu, nhận cả target dạng mảng cột và tên index; các lỗi DB khác giữ handler cũ. Vi phạm studentCode/enrollment lúc thêm vào lớp hoặc confirm import không còn thoát ra dưới dạng 500.

Chuyển active được serialize từ đầu transaction ở create/update/toggle; update/toggle đọc lại cờ active sau khi giành khóa. Constraint vẫn chặn SQL ngoài app vì advisory lock là giao thức tự nguyện của application. Transaction giữ cả đổi active và cập nhật khóa/version của phiếu để không lưu nửa lần chuyển kỳ.

## Kết quả audit và trạng thái migration

Audit local ngày 20/10/2026: không có cặp evaluation trùng, username trùng, mã sinh viên trùng hoặc assignment trùng. Catalog xác nhận các unique index đã có ở bảng trên. Index CVHT trong DB vẫn mang tên lịch sử `class_council_assignments_user_id_class_id_key` nhưng nằm trên bảng `advisor_assignments`, đúng cặp cột cần bảo vệ; không tạo thêm index trùng chỉ để đổi tên.

Ban đầu local có hai kỳ active: HK1 và HK2 năm học 2025–2026. Sau khi người dùng xác nhận áp dụng và chọn đóng HK1, **HK1 đã inactive, HK2 giữ active**. Migration `20261020030000_enforce_business_invariants` đã áp dụng thành công vào DB local `apag` ngày 20/10/2026. Audit sau áp dụng xác nhận một kỳ active, không có nhóm dữ liệu trùng theo các rule đã kiểm tra và hai index `users_username_normalized_key`, `semesters_single_active_key` đã tồn tại. Chưa triển khai staging/production.

Migration dùng transaction và không có DELETE/UPDATE dọn dữ liệu. Nó sẽ từ chối nếu có nhiều kỳ active hoặc username trùng sau chuẩn hóa. Trước khi deploy: chạy [SQL audit chỉ đọc](../projects/prisma/audits/business-invariants.sql), xác định kỳ giữ mở và xử lý dữ liệu theo quyết định nghiệp vụ, audit lại rồi mới `pnpm db:deploy`. `start:prod` hiện tự chạy migrate deploy, nên dữ liệu vi phạm phải được xử lý trước khi khởi động qua lệnh đó.

## Kiểm tra

Trong `projects/`:

```bash
pnpm typecheck
pnpm lint
pnpm test --runInBand
pnpm test:invariants
pnpm test:concurrency
pnpm build
```

`test:invariants` tạo schema ngẫu nhiên, copy cấu trúc/index đã có, chạy đúng SQL migration mới **chỉ trong schema test**, sau đó dùng SQL trực tiếp và application service để kiểm tra unique, request cạnh tranh, active/form-lock consistency, soft delete và mapping lỗi 409. Schema test được dọn sau khi chạy, không sửa record nghiệp vụ hoặc đánh dấu migration local đã applied.
