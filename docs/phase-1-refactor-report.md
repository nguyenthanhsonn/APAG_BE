# Báo cáo Phase 1 — Refactor và bảo vệ nghiệp vụ đánh giá rèn luyện

Ngày báo cáo: **20/10/2026**.

**Cập nhật sau báo cáo:** đã tích hợp FE và bổ sung BE nhận `expectedVersion`/`expectedVersions`; giới hạn về màn hình cũ nêu dưới đây mô tả thời điểm chốt Phase 1 trước đợt FE. Trạng thái mới nằm tại [FE API integration](../../APAG_FE/docs/phase-1-api-integration.md). Phạm vi Phase 1 trong báo cáo là **8 hạng mục refactor và bảo vệ nghiệp vụ đã thống nhất**, không phải “Giai đoạn 1 — Tối ưu một instance” trong scaling roadmap.

**Kết quả:** đã triển khai và kiểm thử trên local; cả ba migration của Phase 1 đã áp dụng vào DB local `apag`. Chưa triển khai staging/production. Phase này xây dựng nền tảng về tính đúng và khả năng bảo trì; chưa có số đo để kết luận API nhanh hơn hoặc hệ thống chịu được bao nhiêu người dùng đồng thời.

## 1. Vấn đề và thay đổi tổng thể

Module cũ tập trung nhiều công việc trong service đánh giá: đọc dữ liệu, tính/ghi điểm, kiểm tra quyền, xử lý trạng thái, nộp phiếu, duyệt, chốt điểm và notification. Khi sửa một nhánh nghiệp vụ, người đọc phải hiểu nhiều phần không trực tiếp liên quan; các điều kiện dễ bị lặp hoặc khác nhau giữa endpoint.

Phase 1 giữ kiến trúc modular monolith, tách code theo use case và đưa các quy tắc dùng chung về domain. Đồng thời bổ sung cơ chế ở transaction và DB để kiểm tra nghiệp vụ vẫn đúng khi request chạy đồng thời, bị retry hoặc có writer ngoài ứng dụng.

| Hạng mục | Thay đổi chính | Giá trị đạt được |
|---|---|---|
| Tách service | Query, Score, Submit, Review, Finalize | Dễ tìm nơi cần sửa và kiểm thử từng use case |
| State machine | Một bảng allowed transitions | Không nhảy cấp hoặc chuyển trạng thái tùy endpoint |
| Concurrency | CAS theo `id + version` | Request đọc cùng snapshot không ghi đè nhau âm thầm |
| Idempotency | Receipt bền vững, khóa theo key, notification dedupe | Retry cùng ý định không thực hiện lại nghiệp vụ đã thành công |
| Evidence | Request chỉ định form cụ thể | Không gắn nhầm minh chứng do chọn phiếu theo thời gian tạo |
| DB invariants | Validation ở application và unique index ở DB | Chặn dữ liệu trùng kể cả khi precheck bị race hoặc import/SQL bỏ qua app |
| Deadline | Policy chung theo cấp và giờ Việt Nam | Các luồng áp dụng cùng cách tính hạn |
| Access | Sáu capability, kiểm tra ownership/assignment | Quyền dựa trên role và phạm vi dữ liệu hiện tại |

## 2. Tách trách nhiệm của TrainingEvaluationsService

```text
training-evaluations/
├── presentation/
│   ├── training-evaluations.controller.ts
│   └── admin-training-evaluations.controller.ts
├── application/
│   ├── evaluation-query.service.ts
│   ├── evaluation-score.service.ts
│   ├── evaluation-submit.service.ts
│   ├── evaluation-review.service.ts
│   ├── evaluation-finalize.service.ts
│   └── evaluation-concurrency.ts
└── domain/
    ├── evaluation-transition.ts
    ├── evaluation-access.policy.ts
    ├── evaluation-deadline.policy.ts
    └── score-calculator.ts
```

| Thành phần | Trách nhiệm và ranh giới |
|---|---|
| Presentation | Nhận request, validation DTO, guard HTTP và chuyển đúng use case |
| Query | List/detail/summary/status, phân trang, tra assignment để kiểm tra phạm vi đọc và thao tác |
| Score | Lưu nháp, tự chấm, chấm tiêu chí, tính tổng và hủy xác nhận cũ khi sửa điểm |
| Submit | Tạo phiếu, sinh viên nộp/nộp lại, chuyển danh sách qua lớp trưởng → CVHT → khoa → PĐT |
| Review | Xác nhận, duyệt, từ chối hoặc trả phiếu về sinh viên |
| Finalize | Chốt đơn/bulk/theo bộ lọc, tính kết quả cuối và mở lại theo quyền quản trị |
| Domain | Công thức và policy dùng chung; không truy vấn hoặc ghi DB |

Chiều gọi chính là `Controller → Application → Domain / Prisma / Mapper`. Review có thể phối hợp Score và Finalize; các use case dùng Query để tra phân công. Không thêm repository chỉ để chuyển tiếp lời gọi Prisma và không cần `forwardRef` cho vòng phụ thuộc giữa các service này.

Ví dụ, chấm tiêu chí và xác nhận được phân biệt rõ: `reviewScores` thay đổi điểm và hủy xác nhận cũ, còn `confirmReview` ghi nhận người/thời gian xác nhận. Chuyển cấp danh sách thuộc Submit. Điều này giúp tránh việc một hàm “duyệt” vừa sửa điểm vừa ngầm chuyển nhiều bước workflow.

Các ranh giới khó như reset điểm khi nộp lại, CAS trước khi ghi bảng con và emit sau commit đã có comment trong code. Hướng dẫn đọc chi tiết nằm tại [README module](../projects/src/modules/training-evaluations/README.md).

## 3. State machine tập trung

Luồng chính:

```text
draft → submitted → class_leader_approved → class_approved
      → faculty_approved → finalized

rejected → submitted  (bắt đầu lại vòng duyệt)
```

`EVALUATION_TRANSITIONS` trong [evaluation-transition.ts](../projects/src/modules/training-evaluations/domain/evaluation-transition.ts) là nguồn khai báo các cạnh hợp lệ. `assertTransition(current, target)` từ chối nhảy cấp, self-transition và cạnh không được phép bằng **409 Conflict**.

Các nhánh trả về hiện có cũng được đưa về bảng chung. `reopen` là ngoại lệ quản trị có guard riêng; việc cho phép admin mở lại không biến `finalized → draft` thành cạnh workflow thông thường cho mọi luồng.

State machine chỉ trả lời “từ trạng thái này có được chuyển sang trạng thái kia không?”. Quyền, khóa phiếu và deadline được kiểm tra bằng policy riêng. Các bộ lọc status trong query báo cáo vẫn tồn tại để đếm/lọc dữ liệu, không phải bảng chuyển trạng thái thứ hai.

## 4. Optimistic concurrency và transaction

`EvaluationForm` có thêm `version Int @default(0)`. Mỗi lần ghi sử dụng điều kiện `id + version` và tăng version trong cùng câu UPDATE:

```sql
UPDATE evaluation_forms
SET ..., version = version + 1
WHERE id = :id AND version = :expected_version;
```

Nếu không cập nhật được row nào, helper trả **409** và yêu cầu tải lại dữ liệu. Không tự đọc version mới rồi ghi đè bằng dữ liệu từ snapshot cũ.

Ví dụ: A và B cùng đọc version 5. A cập nhật thành công, DB lên version 6. B vẫn ghi với version 5 nên bị từ chối; thay đổi của A được giữ nguyên.

CAS nằm trong transaction cùng điểm tiêu chí, audit và notification liên quan. Với thao tác chấm điểm, application giành version của phiếu trước khi ghi bảng con. Nếu request thua hoặc ghi bảng con lỗi, toàn bộ transaction rollback. Finalize batch xử lý ID theo thứ tự ổn định; conflict một candidate rollback cả batch.

**Giới hạn hiện tại:** expected version được server đọc trong request. Client chưa bắt buộc gửi version của màn hình đang mở. Vì vậy đã bảo vệ request cạnh tranh trên cùng snapshot, nhưng chưa bảo vệ đầy đủ tình huống người dùng giữ màn hình cũ rất lâu rồi gửi dữ liệu sau một lần cập nhật đã hoàn tất. Muốn giải quyết trường hợp đó cần hợp đồng version từ client hoặc cơ chế tương đương.

## 5. Idempotency và notification

Các command submit, review/confirm, chuyển cấp, finalize đơn/bulk/theo bộ lọc nhận header `Idempotency-Key`. Client tạo một key cho một ý định thao tác và giữ nguyên khi double-click hoặc retry.

Luồng xử lý:

1. Tạo scope từ actor, action và key; tạo hash của payload.
2. Lấy PostgreSQL advisory transaction lock theo scope, để request cùng key chờ nhau kể cả qua nhiều process.
3. Có receipt thành công và payload khớp: kiểm tra quyền hiện tại rồi trả lại kết quả đã lưu.
4. Cùng key nhưng payload khác: trả **409**.
5. Chưa có receipt: thực hiện nghiệp vụ và lưu receipt trong cùng transaction. Có lỗi thì rollback cả hai.

Ví dụ finalize đã commit nhưng client bị timeout: retry cùng key trả lại kết quả lần đầu, không chốt lại, tăng version lần nữa hoặc tạo thêm notification.

Notification có unique `dedupe_key` theo người nhận và business event. Một vòng reject mới có version/event mới nên vẫn được tạo thông báo riêng. Socket chỉ emit cho notification vừa tạo và chỉ sau commit; replay không emit lại.

Authorization vẫn có hiệu lực khi replay: người đã bị gỡ assignment không được dùng receipt cũ để tiếp tục đọc kết quả trong scope đó. Ngược lại, retry thành công sau deadline vẫn được replay vì không có transition mới.

Các giới hạn cần giữ rõ:

- Header còn tùy chọn để tương thích client cũ. Thiếu key vẫn có CAS nhưng không có bảo đảm replay kết quả; frontend cần giữ đúng key khi retry.
- Receipt chưa có TTL tự xóa. Cần theo dõi dung lượng và xác định chính sách lưu trước khi bổ sung cleanup.
- Notification lưu DB được chống trùng; Socket.IO chưa có transactional outbox. Process dừng sau commit nhưng trước emit vẫn có thể làm mất tín hiệu realtime, trong khi notification còn đọc được qua API.

Nguồn: [idempotent-operation.ts](../projects/src/common/idempotency/idempotent-operation.ts), [create-notification-once.ts](../projects/src/modules/notifications/create-notification-once.ts).

## 6. Evidence gắn với form cụ thể

Request thêm minh chứng bắt buộc truyền `evaluationFormId`, `criteriaCode`, `imageUrl`, `publicId`. Backend không còn chọn “phiếu mới nhất còn sửa được” dựa vào `createdAt`.

Backend tìm đúng phiếu thuộc người đăng nhập, kiểm tra quyền sửa, trạng thái `draft/rejected`, chưa khóa và tiêu chí hợp lệ. Sau đó CAS version của phiếu trước khi tạo evidence trong cùng transaction. Xóa evidence cũng kiểm tra chủ sở hữu, phiếu cha và áp dụng CAS.

Điều này xử lý cả hai rủi ro: sinh viên có nhiều phiếu bị gắn ảnh sai học kỳ; hoặc phiếu vừa được submit/khóa trong lúc request upload đang xử lý. Khi có cạnh tranh, một thao tác bị từ chối thay vì lưu minh chứng trái trạng thái.

Frontend cần gửi ID của phiếu đang mở. Record cũ có `publicId = null` vẫn đọc/xóa được; không cần ép migration dữ liệu cũ. Chi tiết: [Evidence README](../projects/src/modules/evidences/README.md).

## 7. Database business invariants

Validation ở application cung cấp lỗi dễ hiểu; constraint DB là lớp chặn cuối khi hai request cùng vượt precheck hoặc SQL/import không đi qua application.

| Rule | DB bảo vệ |
|---|---|
| Một evaluation / student / semester | Unique `(student_id, semester_id)` |
| Username duy nhất | Unique username hiện có và unique `lower(btrim(username))` bổ sung |
| Student code duy nhất | Unique `student_code` |
| Một hồ sơ lớp / sinh viên | Unique `student_id` trên enrollment |
| Assignment không trùng | Lớp trưởng theo user; CVHT theo cặp user/lớp; khoa theo user |
| Không trùng năm/học kỳ | Unique `(year, semester)` |
| Tối đa một kỳ active | Partial unique index với điều kiện `is_active = true` |

Không thêm constraint quá chặt như một CVHT chỉ được phụ trách một lớp hoặc mỗi khoa chỉ được có một tài khoản. Username/studentCode vẫn duy nhất toàn cục, kể cả record xóa mềm. Mã sinh viên giữ phép so sánh hiện tại; chỉ username có index chuẩn hóa chữ thường/khoảng trắng.

Application chuyển lỗi unique race phù hợp thành **409**. Mở/chuyển học kỳ dùng transaction và advisory lock, cập nhật khóa/version của phiếu liên quan; unique index vẫn bảo vệ writer ngoài app không tuân theo lock.

Theo xác nhận của người dùng, **HK1 2025–2026 đã đóng, HK2 vẫn mở**. Sau đó migration business invariants đã áp dụng thành công vào DB local. Audit sau áp dụng xác nhận một kỳ active, không có nhóm dữ liệu trùng theo các rule đã kiểm tra và cả hai index mới tồn tại.

Chi tiết constraint và quy trình môi trường khác: [database-business-invariants.md](database-business-invariants.md).

## 8. Deadline policy

`EvaluationDeadlinePolicy` chọn hạn theo cấp xử lý:

| Cấp | Hạn áp dụng |
|---|---|
| Sinh viên nộp/nộp lại | `studentDeadline` |
| Lớp trưởng/CVHT chấm, xác nhận, duyệt và chuyển cấp | `classDeadline` |
| Khoa duyệt/chuyển danh sách | `facultyDeadline` |
| Admin/PĐT finalize/reopen | Chưa có mốc riêng; không tự mượn hạn của cấp trước |

Ngày `YYYY-MM-DD` được hiểu đến **23:59:59.999 giờ Việt Nam**, độc lập timezone của server. Đúng mốc vẫn hợp lệ; sau mốc trả **409**. Deadline null nghĩa là chưa giới hạn cấp đó.

Policy lấy hạn từ học kỳ của phiếu/danh sách đang xử lý. Guard chạy trước lần ghi nghiệp vụ; request quá hạn không để lại điểm, version, notification hoặc receipt thành công. Sửa nháp và evidence vẫn theo quyền/trạng thái/khóa; không bị chặn thêm chỉ vì deadline submit đã qua.

## 9. Access policy và principal hiện tại

| Capability | Quyền và phạm vi |
|---|---|
| `canRead()` | Sinh viên: phiếu của mình; lớp trưởng/CVHT: lớp được phân công; khoa: khoa được phân công còn hoạt động; admin/PĐT: toàn hệ thống |
| `canEdit()` | Sinh viên là chủ phiếu |
| `canReview()` | Lớp trưởng/CVHT có assignment đúng lớp |
| `canSubmitClass()` | Assignment đúng lớp và role phù hợp bước chuyển |
| `canApproveFaculty()` | Tài khoản khoa có assignment đúng khoa hợp lệ |
| `canFinalize()` | Admin/PĐT |

Controller dùng role guard; application kiểm tra lại capability để lời gọi nội bộ không bỏ qua authorization. Domain nhận dữ kiện từ application, không tự query DB.

Role và trạng thái tài khoản được đọc từ DB mỗi request bảo vệ, thay cho tin role cũ trong JWT. Đổi role hoặc vô hiệu hóa tài khoản có hiệu lực ở request tiếp theo; gỡ assignment cũng ảnh hưởng lần kiểm tra scope tiếp theo, gồm receipt replay.

Phân loại lỗi: tài khoản/token không hợp lệ **401**; sai role hoặc assignment **403**; sai workflow, khóa, quá hạn, stale version hoặc key khác payload **409**. Sinh viên truy cập phiếu của người khác vẫn trả **404** qua owner filter để giữ hành vi che tài nguyên.

Việc này siết quyền đọc detail/summary/status vốn rộng với non-student. Đổi lại, request bảo vệ có thêm query principal và có thể thêm query assignment; cần đo chi phí trước khi tối ưu hoặc cache quyền.

## 10. Migration, API và cấu hình liên quan

| Migration | Nội dung | Local |
|---|---|---|
| `20261020010000_add_evaluation_form_version` | Version của phiếu | Đã áp dụng |
| `20261020020000_add_idempotent_operations` | Operation receipt và notification dedupe | Đã áp dụng |
| `20261020030000_enforce_business_invariants` | Username chuẩn hóa và single active semester | Đã áp dụng |

Không đổi prefix/HTTP method và các alias quản trị chính. Các thay đổi client cần biết là response có thêm version, command hỗ trợ `Idempotency-Key`, evidence yêu cầu đủ bốn field và quyền đọc được kiểm tra theo assignment.

Các công việc nền đã thực hiện trước chuỗi 8 mục gồm chuẩn hóa env, quy tắc ưu tiên URL DB, validation cấu hình, mức log và ghi lại kiến trúc/deployment/baseline. Log debug không cần thiết được dọn hoặc đưa về Nest Logger có mức điều khiển; log lỗi vận hành được giữ. Chi tiết ở [environment.md](environment.md), [architecture.md](architecture.md), [deployment.md](deployment.md), [api-critical-flows.md](api-critical-flows.md).

## 11. Kiểm chứng và Definition of Done

Kết quả lần kiểm tra code gần nhất trước khi lập báo cáo:

| Nhóm | Kết quả |
|---|---|
| Unit tests | **273 tests / 21 suites đạt** |
| PostgreSQL/HTTP concurrency, retry, deadline, evidence, scope | **26 tests đạt** |
| PostgreSQL business invariants và principal | **12 tests đạt** |
| Build, TypeScript typecheck, lint | Đạt |
| Sau deploy migration local | Xác nhận migration hoàn tất, hai index mới tồn tại và audit không có dữ liệu vi phạm |

Các số test trên là kết quả đã chạy trong đợt triển khai, không phải lần chạy mới chỉ để viết report. Test PostgreSQL dùng schema tạm riêng và dọn sau khi chạy.

Definition of Done đã được kiểm chứng trong phạm vi local:

- Invalid transition trả 409; có test các cặp trạng thái và HTTP.
- Wrong role/assignment trả 403; có test application boundary, scope và thu hồi quyền khi replay.
- Hai request cùng version: một thành công, một 409; không mất cập nhật trên snapshot cạnh tranh.
- Duplicate submit/finalize cùng key replay kết quả, không lặp business effect; notification có unique dedupe.
- Business invariants có constraint ở DB; hai constraint mới đã rollout local.

## 12. Đánh giá kết quả và phần tiếp theo

Lợi ích chính của Phase 1 là quy tắc có nơi định nghĩa rõ, use case có trách nhiệm nhỏ hơn và lỗi cạnh tranh được chuyển thành kết quả có thể xử lý. Transaction bảo vệ cả dữ liệu phụ và notification, thay vì chỉ kiểm tra trạng thái trước một lần UPDATE. DB trở thành lớp bảo vệ nghiệp vụ cuối cùng.

Những điểm chưa được Phase 1 giải quyết hoàn toàn:

1. **Frontend concurrency/retry:** cần xác minh client giữ key đúng vòng đời; bổ sung expected version từ client nếu muốn chặn màn hình cũ ghi dữ liệu mới.
2. **Realtime delivery:** chưa có outbox; gateway authorization và khả năng chạy nhiều node vẫn là công việc riêng.
3. **Finalize đơn và batch:** còn giữ khác biệt nghiệp vụ cũ về kiểm tra khóa/điểm null; cần thống nhất rule trước khi thay hành vi.
4. **Performance:** chưa có benchmark nghiệp vụ sau refactor. Baseline trước đó chỉ là smoke measurement trên dataset nhỏ và chưa bao gồm query authorization mới.
5. **Vận hành:** chưa deploy staging/production; các môi trường đó cần audit dữ liệu và chạy migration trước code mới. Receipt retention, telemetry/readiness, backup/restore và shared state nhiều instance còn trong roadmap.

Phase 1 đã hoàn tất phần code, kiểm thử và migration local của 8 hạng mục. Bước tiếp theo hợp lý là tích hợp client và kiểm thử workflow xuyên các role trên staging, sau đó đo baseline nghiệp vụ với dataset đại diện để chọn tối ưu bằng bằng chứng.
