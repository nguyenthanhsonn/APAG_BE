# Các luồng API quan trọng

Khảo sát ngày **19/10/2026**, commit `4876b15aa63e8b79945aae626bd6fc3b0be53d5b`. Mọi đường dẫn HTTP dưới đây có prefix `/api/v1`. Đây là bản đồ hành vi từ source, chưa phải kết quả kiểm thử toàn bộ luồng trên môi trường triển khai.

## 1. Đăng nhập, duy trì phiên và thu hồi

| Endpoint | Xử lý chính | DB/state và điểm cần đo |
|---|---|---|
| `POST /auth/login` | Tra username, bcrypt compare, kiểm tra active, phát access/refresh token | Đọc user và ghi refresh token hash; đo bcrypt, DB, tổng latency riêng |
| `GET /auth/me` | Trả profile; kiểm tra active khi cache miss | Profile cache 30 giây; phân biệt hit/miss |
| `POST /auth/refresh-token` | Xác minh refresh JWT, hash và hạn lưu trong DB; tạo phiên mới | Ghi đè refresh hash hiện tại; đo cạnh tranh refresh cùng user |
| `POST /auth/logout` | Thu hồi access token trong RAM, xóa refresh hash trong DB và cache profile | Đo/tái hiện sau restart và khi dùng hai instance |
| `POST /auth/forgot-password`, `POST /auth/reset-password` | Sinh token, lưu hash/hạn dùng, gửi SMTP; dùng token đổi mật khẩu | SMTP là phụ thuộc ngoài; dùng mailbox thử nghiệm khi đo |

Protected request: bearer JWT → `JwtStrategy` → token store trong RAM → role guard nếu route yêu cầu → service. Strategy hiện trả user từ claims, không đọc DB mỗi request. Vì vậy thay đổi trạng thái/role trong DB và việc token cũ còn được chấp nhận cần được kiểm thử riêng.

Refresh hash nằm trên một record user, không phải bảng session nhiều thiết bị. Không dùng cùng một tài khoản để mô phỏng nhiều người đăng nhập độc lập khi benchmark vì các lần tạo phiên có thể thay refresh token của nhau.

Nguồn: [AuthController](../projects/src/modules/auth/auth.controller.ts), [AuthService](../projects/src/modules/auth/auth.service.ts), [JwtStrategy](../projects/src/modules/auth/strategies/jwt.strategy.ts).

## 2. Sinh viên tạo, sửa và nộp phiếu

1. `POST /training-evaluations` nhận `semester` (`HK1`, `HK2`, `SUMMER`) và `academicYear` (`YYYY-YYYY`). Service đọc học kỳ và lớp hiện tại song song, tạo phiếu `draft`. Unique `(studentId, semesterId)` chặn tạo trùng; Prisma `P2002` được chuyển thành HTTP 409.
2. `GET /training-evaluations/me` lấy các phiếu của sinh viên; `GET /training-evaluations/:id` lấy chi tiết, có quan hệ điểm/minh chứng theo select. Danh sách `me` hiện không phân trang.
3. `PATCH /training-evaluations/:id` cập nhật nháp; các route `/:id/study-score`, `discipline-score`, `activity-score`, `community-score`, `role-score` cập nhật từng phần. Service kiểm tra sở hữu, trạng thái được sửa và khóa.
4. `POST /evidences/link-url` yêu cầu rõ `evaluationFormId`, `criteriaCode`, `imageUrl`, `publicId`; chỉ lưu vào đúng phiếu thuộc người gọi, đang draft/rejected và chưa khóa. Không chọn phiếu theo `createdAt`. Thêm/xóa evidence cùng CAS tăng version của phiếu trong transaction để không ghi bằng snapshot cũ khi submit/khóa đồng thời; đây không phải API upload file. `GET /evidences/my` chưa phân trang; `DELETE /evidences/:id` xóa record thuộc người gọi khi phiếu còn được sửa.
5. `POST /training-evaluations/:id/submit` chỉ nhận phiếu `draft`/`rejected`, chưa khóa và thuộc sinh viên. Tính tổng điểm; transaction xóa điểm duyệt cũ ở các tiêu chí và cập nhật phiếu sang `submitted`, reset điểm/reviewer các cấp sau.

Điểm đo: số query, payload chi tiết, thời gian transaction, p95 khi nhiều sinh viên nộp cùng đợt. Cập nhật 20/10/2026: snapshot có version; ghi theo id + version và tăng version nguyên tử, stale snapshot trả 409. Kiểm tra cạnh chuyển trạng thái nằm trong state machine tập trung. Các test cạnh tranh điểm/state và rollback batch đã chạy trên PostgreSQL trong schema tạm; vẫn cần đo tải lớn riêng.

Nguồn: [TrainingEvaluationsService](../projects/src/modules/training-evaluations/README.md), [selects](../projects/src/modules/training-evaluations/selects/evaluation-form.select.ts), [EvidencesService](../projects/src/modules/evidences/evidences.service.ts).

Cập nhật deadline 20/10/2026: submit dùng studentDeadline; chấm/xác nhận/duyệt/trả phiếu của lớp trưởng và CVHT dùng classDeadline; khoa gửi PĐT dùng facultyDeadline. Tất cả dùng `EvaluationDeadlinePolicy` trước khi ghi transaction; quá hạn trả 409. API cấu hình hạn theo ngày, mặc định cho phép đến cuối ngày Việt Nam; null không giới hạn. Admin/PĐT chưa có deadline riêng. Xem [hợp đồng policy](../projects/src/modules/training-evaluations/README.md).

## 3. Danh sách và chi tiết phục vụ duyệt

| Endpoint | Quyền/phạm vi | Hành vi dữ liệu |
|---|---|---|
| `GET /training-evaluations` | Admin; lớp trưởng/CVHT phải chọn lớp được phân công; khoa giới hạn theo assignment | `findMany` + `count` song song; offset pagination |
| `GET /admin/evaluations` | Admin hoặc PĐT | Bộ lọc học kỳ, lớp, khoa, trạng thái, từ khóa; `findMany` + `count`, join relations |
| `GET /training-evaluations/:id`, `/:id/summary`, `/:id/status` | Sinh viên sở hữu phiếu; lớp trưởng/CVHT đúng assignment lớp; khoa đúng assignment khoa; admin/PĐT toàn hệ thống | `findAccessible` lấy dữ kiện scope rồi kiểm tra `canRead` trước mapper; truy cập ngoài scope bị từ chối |

DTO danh sách phiếu mặc định page 1, limit 20, tối đa 100. Alias admin hiện có `/admin/training-evaluations` và `/training-department/evaluations` với cùng handler.

Đo trang đầu và trang sâu, có/không keyword, bộ lọc lớp và khoa, response bytes, số query và plan thực tế. Không mặc định coi `relationLoadStrategy: 'join'` luôn nhanh hơn: cần so sánh trên dataset đủ lớn. Access policy ngày 20/10 đã siết detail/summary/status theo assignment và có test HTTP scope lớp/khoa, thu hồi assignment và role hiện tại từ DB.

Nguồn: [controller chính](../projects/src/modules/training-evaluations/presentation/training-evaluations.controller.ts), [controller admin](../projects/src/modules/training-evaluations/presentation/admin-training-evaluations.controller.ts), [DTO](../projects/src/modules/training-evaluations/dto/admin-list-evaluations-query.dto.ts).

## 4. Xác nhận từng phiếu và chuyển danh sách lên cấp sau

| Bước | Endpoint | Điều kiện và kết quả |
|---|---|---|
| Chấm | `PATCH /training-evaluations/:id/review-scores` | Lớp trưởng/CVHT đúng assignment; lưu điểm tiêu chí và tổng điểm lớp |
| Xác nhận | `POST /training-evaluations/:id/confirm-review` | Có thể chấm kèm; yêu cầu điểm lớp; lớp trưởng ở `submitted`, CVHT ở `class_leader_approved`; ghi reviewer/time, chưa chuyển trạng thái |
| Lớp → CVHT | `POST /training-evaluations/classes/:classId/submit-to-advisor` | Lớp trưởng đúng lớp, có CVHT active; chuyển phiếu đủ điều kiện `submitted → class_leader_approved` |
| CVHT → khoa | `POST /training-evaluations/classes/:classId/submit-to-faculty` | CVHT đúng lớp, có người nhận cấp khoa; phiếu có điểm/xác nhận; `class_leader_approved → class_approved` |
| Khoa → PĐT | `POST /training-evaluations/faculties/:facultyId/submit-to-training-department` | Khoa đúng assignment, có người nhận PĐT; `class_approved → faculty_approved` |

Các bước chuyển danh sách đọc tập phiếu đủ điều kiện và thống kê trước; transaction cập nhật phiếu cùng notification DB; sau commit mới emit Socket.IO. Cả ba bước hiện CAS từng phiếu theo `id + version` trong thứ tự ID ổn định; thời gian transaction có thể tăng theo số phiếu. Request có `Idempotency-Key` lưu receipt trong cùng transaction; retry trả lại count/thời điểm ban đầu. Notification dùng unique recipient/event và chỉ emit row mới tạo.

Đã có test cạnh tranh và retry sau commit; vẫn cần kiểm chứng assignment thay đổi sau khi đọc và tải lớn. Chưa thấy cơ chế outbox đảm bảo emit sau commit: DB có thể đã ghi thành công nhưng client không nhận sự kiện nếu tiến trình dừng giữa hai bước. Client cần đọc lại danh sách notification để phục hồi.

## 5. Trả về, phê duyệt cuối và mở lại

- `POST /training-evaluations/:id/return-to-student`: CVHT trả về với lý do, dùng chung `review(... action: reject)`; hiện yêu cầu trạng thái của bước CVHT. Transaction reset điểm duyệt và tạo notification; emit sau commit.
- `POST /training-evaluations/:id/review`: controller hiện chỉ cho admin; helper chọn bước từ `faculty_approved`, cho approve hoặc reject. Không suy diễn các role có trong helper đều truy cập được route này.
- `PATCH /admin/evaluations/:id/finalize`: admin/PĐT, yêu cầu `faculty_approved`, chưa khóa, có điểm lớp hoặc điểm cuối được gửi lên; ghi `finalized`, điểm và xếp loại.
- `PATCH /admin/evaluations/bulk-finalize`: tối đa 500 ID đầu vào; lấy phiếu `faculty_approved`, bỏ qua ID không khớp trạng thái; transaction gồm một update cho mỗi phiếu.
- `POST /admin/evaluations/finalize-by-filter`: lấy toàn bộ candidates theo bộ lọc; hơn 500 yêu cầu `confirmLargeAction=true`. Xác nhận này không tạo hard cap hoặc chia batch.
- `POST /admin/evaluations/:id/reopen`: admin/PĐT đưa phiếu không ở `draft` về `draft`, xóa thời điểm nộp, điểm lớp/điểm cuối và các mốc reviewer; giữ điểm tự chấm. Nhánh này không reset `isLocked`, nên mở lại trạng thái chưa đồng nghĩa mở khóa để sửa.

Đặc biệt: nhánh batch dùng `classScore ?? 0` và bộ lọc đọc candidates không kiểm tra `isLocked` như nhánh finalize một phiếu. Đây là khác biệt từ source cần kiểm thử và thống nhất trước tối ưu. Cập nhật 20/10/2026: batch ghi theo id + version của từng candidate, conflict rollback toàn batch; khóa/mở khóa học kỳ cũng tăng version. Test cạnh tranh đã chạy riêng trong schema tạm; các số đo baseline ngày 19/10 không thay đổi.

Submit/review/confirm/finalize đơn và batch hỗ trợ header `Idempotency-Key`; cùng actor/action/key/payload trả kết quả ban đầu, khác payload trả 409. Với finalize-by-filter, retry có key không xử lý phiếu mới đủ điều kiện sau lần đầu. Client phải giữ key cho cùng một ý định thao tác; xem [hợp đồng đầy đủ](../projects/src/modules/training-evaluations/README.md).

Nguồn: [service admin](../projects/src/modules/training-evaluations/application/evaluation-finalize.service.ts), [review helper](../projects/src/modules/training-evaluations/domain/evaluation-transition.ts).

## 6. Import sinh viên và gửi tài khoản

```mermaid
sequenceDiagram
    participant A as Admin
    participant API as Backend
    participant RAM as Import Map
    participant DB as PostgreSQL
    participant Mail as SMTP
    A->>API: POST /admin/students/import (file)
    API->>DB: Đọc trước lớp và tài khoản để kiểm tra
    API->>RAM: Lưu kế hoạch, token, TTL 10 phút
    API-->>A: Preview và importToken
    A->>API: POST /admin/students/import/confirm
    API->>RAM: Kiểm tra chủ sở hữu, TTL; xóa token
    API->>API: bcrypt hash các password
    API->>DB: Transaction tạo user và enrollment
    DB-->>API: Commit
    API->>Mail: Gửi email theo nhóm 10
    API-->>A: Kết quả import và gửi email
```

Ngoài template toàn bộ sinh viên, có route preview `/admin/classes/:classId/students/import`; confirm dùng `/admin/students/import/confirm`. Import danh mục lớp là luồng riêng `/admin/classes/import` và `/admin/classes/import/confirm`.

Hash password dùng bcrypt rounds 10, được chuẩn bị bằng `Promise.all` trước transaction. Transaction import sinh viên có timeout 60 giây. Email nhóm 10, nghỉ 1 giây giữa các nhóm và vẫn được await trong request. Có log `admin-students-import.timing` cho từng bước.

Rủi ro cần đo/kiểm thử: CPU và hàng đợi bcrypt, RSS khi parse Excel, transaction dài, SMTP chậm/lỗi, mất preview khi restart hoặc request sang replica khác. Token bị xóa trước commit nên lỗi commit có thể buộc preview lại. Email lỗi sau commit không có nghĩa DB rollback; phải đọc các trường kết quả gửi email, không import lại mù quáng.

Nguồn: [controller import](../projects/src/modules/admin-classes/admin-classes.controller.ts), [service import sinh viên](../projects/src/modules/admin-classes/admin-classes.service.ts), [service import lớp](../projects/src/modules/admin-classes/admin-class-catalog.service.ts).

## 7. Tổng hợp, xuất file và notification

| Luồng | Endpoint/hành vi | Điểm cần đo |
|---|---|---|
| Tiến độ | `GET /reports/overview`: count + groupBy theo trạng thái | Query time theo học kỳ/khoa |
| Kết quả | `GET /reports/training-results`, `/reports/by-class`, `/reports/by-faculty`: chỉ phiếu finalized; aggregate/groupBy trong DB | Plan join/filter, latency khi chạy cùng submit |
| PDF | `GET /reports/export-pdf`: lấy toàn bộ rows khớp bộ lọc, rồi stream PDF | TTFB, tổng thời gian, RSS, số rows/bytes; streaming output chưa giới hạn dữ liệu đầu vào |
| Biên bản khoa | `POST /reports/export/excel/bien-ban-hop-khoa`, `/reports/export/word/bien-ban-hop-khoa`: role faculty | Dữ liệu sinh viên từ body, render template thành Buffer; không coi là truy vấn báo cáo DB |
| Biên bản lớp | `POST /reports/export/excel/bien-ban-hop-lop`: role class_leader | Body → Excel Buffer → response |
| Notification | `GET /notifications`, `/notifications/unread-count` | Với sinh viên, có thể tạo reminder trong DB trước khi đọc; GET không hoàn toàn chỉ đọc |
| Realtime | Namespace `/notifications`, event `notifications:join`, `notifications:new`, `notifications:refresh` | Join room hiện dựa vào userId client gửi; chưa thấy auth trong gateway hoặc adapter liên instance |

Báo cáo GET mặc định role admin; role method của export biên bản ghi đè role controller. Không đưa notification GET vào phép đo “chỉ đọc” trên dữ liệu thật vì có side effect tạo reminder.

Nguồn: [ReportsService](../projects/src/modules/reports/reports.service.ts), [ReportsController](../projects/src/modules/reports/reports.controller.ts), [NotificationsService](../projects/src/modules/notifications/notifications.service.ts), [Gateway](../projects/src/modules/gateways/notifications.gateway.ts).

## 8. Ma trận kiểm chứng trước tối ưu

| Tình huống | Kết quả cần xác nhận trên dataset thử nghiệm |
|---|---|
| Tạo phiếu trùng học kỳ | Một phiếu duy nhất, request trùng trả conflict |
| Hai request sửa/nộp/duyệt cùng phiếu | Không ghi đè trạng thái/điểm trái quy trình |
| Sinh viên khác, lớp/khoa khác | Đúng giới hạn sở hữu/phân công ở cả list và detail |
| Phiếu khóa, điểm lớp null, batch lặp ID | Hành vi nhất quán giữa duyệt đơn và batch |
| DB commit nhưng mất response/emit | Retry hoặc đọc lại không tạo tác dụng phụ trùng |
| Import lỗi DB hoặc SMTP | Phân biệt chưa commit và đã commit nhưng chưa gửi email |
| Hai instance và restart | Thu hồi token, preview và notification hoạt động đúng sau thay đổi kiến trúc |

Các mục này là kế hoạch xác minh, chưa được đánh dấu pass. Số đo đã thực hiện nằm trong [performance-baseline.md](performance-baseline.md).
