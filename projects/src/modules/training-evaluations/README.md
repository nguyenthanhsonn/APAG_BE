# Đọc module đánh giá rèn luyện sau refactor

Refactor ngày **20/10/2026**. Controller, query, cập nhật điểm và vòng đời phiếu được tách thành các nhóm dưới đây. Application service gọi `PrismaService` trực tiếp; không có repository chỉ để chuyển tiếp lời gọi Prisma.

```text
training-evaluations/
├── application/
│   ├── evaluation-query.service.ts
│   ├── evaluation-score.service.ts
│   ├── evaluation-submit.service.ts
│   ├── evaluation-review.service.ts
│   ├── evaluation-finalize.service.ts
│   └── evaluation-concurrency.ts  # Guard CAS dùng chung, không phải repository
├── domain/
│   ├── evaluation-transition.ts
│   ├── evaluation-access.policy.ts
│   ├── evaluation-deadline.policy.ts
│   └── score-calculator.ts
├── presentation/
│   ├── training-evaluations.controller.ts
│   └── admin-training-evaluations.controller.ts
├── dto/                  # Hợp đồng request và validation hiện có
├── helpers/              # Mapper response và tra/cache học kỳ
├── selects/              # Các Prisma select giữ nguyên
├── constants/
├── types/
└── training-evaluations.module.ts
```

## Bắt đầu đọc từ đâu?

Đọc `presentation/training-evaluations.controller.ts` để biết endpoint gọi use case nào. Sau đó theo service tương ứng; công thức hoặc điều kiện trạng thái được chuyển sang domain. DTO và mapper vẫn giữ hợp đồng API cũ.

| Service | Trách nhiệm | Các method chính |
|---|---|---|
| [Query](application/evaluation-query.service.ts) | Đọc phiếu, phân trang, tra dữ kiện phân công để áp policy quyền | `findAll`, `findMine`, `findOne`, `getSummary`, `getStatus`, `findAdminApprovalList`, `assertClassAccess`, `assertFormAccess`, `requireFacultyAssignment` |
| [Score](application/evaluation-score.service.ts) | Lưu nháp, điểm tự chấm và điểm thẩm định | `updateDraft`, `update*Score`, `reviewScores` |
| [Submit](application/evaluation-submit.service.ts) | Tạo phiếu, sinh viên nộp và gửi danh sách giữa các cấp | `create`, `submit`, `submitClassToAdvisor`, `submitClassToFaculty`, `submitFacultyToTrainingDepartment` |
| [Review](application/evaluation-review.service.ts) | Xác nhận, duyệt hoặc trả về từng phiếu | `confirmReview`, `review`, `returnToStudent` |
| [Finalize](application/evaluation-finalize.service.ts) | Chốt điểm cuối, chốt hàng loạt và mở lại | `finalize`, `bulkFinalize`, `finalizeByFilter`, `reopen`, `finalizeReviewedForm` |

`create` ở Submit vì bắt đầu vòng đời phiếu. `updateDraft` ở Score vì thay đổi dữ liệu trước khi nộp. `reviewScores` cũng ở Score: nó ghi điểm và hủy xác nhận cũ, chưa chuyển cấp. `confirmReview` ở Review: ghi nhận người/thời gian xác nhận; chuyển trạng thái danh sách là việc của Submit.

## Chiều phụ thuộc

```text
HTTP controller → application service → Prisma / domain policy / mapper
Score → Query (tra phân công)
Submit → Query (tra phân công), Notifications
Review → Query, Score, Finalize, Notifications
Finalize → Prisma, domain, mapper
Query → Prisma, domain policy, mapper
```

Không có chiều ngược từ Query/Finalize về Review và không cần `forwardRef`. Các method Query dùng chung giải quyết việc tra cứu có ngữ nghĩa nghiệp vụ, không phải lớp bọc CRUD tổng quát.

## Các domain file

- [evaluation-transition.ts](domain/evaluation-transition.ts): bảng `EVALUATION_TRANSITIONS`, `assertTransition(current, target)`, bước duyệt theo role và policy sửa/mở lại/khóa. Không đọc DB.
- [evaluation-access.policy.ts](domain/evaluation-access.policy.ts): quyết định từ role và assignment đã đọc. Application chịu trách nhiệm lấy dữ kiện từ Prisma.
- [evaluation-deadline.policy.ts](domain/evaluation-deadline.policy.ts): `EvaluationDeadlinePolicy` chọn hạn theo cấp và chặn submit/review/chuyển cấp quá hạn trước khi ghi. Notifications dùng cùng ánh xạ deadline; xem hợp đồng bên dưới.
- [score-calculator.ts](domain/score-calculator.ts): công thức điểm từng mục, tổng điểm và xếp loại. Không ghi DB, không phát notification; đầu vào DTO chỉ được dùng dưới dạng type.

## Ranh giới transaction cần chú ý

1. Sinh viên nộp: reset điểm tiêu chí và audit của vòng duyệt cũ cùng lúc chuyển `submitted`.
2. Chấm thẩm định: upsert điểm tiêu chí, tính tổng điểm lớp và xóa xác nhận cũ trong cùng transaction.
3. Trả về/chuyển danh sách: cập nhật phiếu và tạo notification DB trong cùng transaction; chỉ emit realtime sau commit. Không đưa emit vào callback transaction.
4. `confirmReview` có thể gọi Score trước khi xác nhận. Sau bổ sung concurrency, hai bước dùng chung transaction; conflict rollback cả điểm và xác nhận. Hai thao tác ghi này tăng version riêng, trong cùng lần commit.
5. Finalize batch cập nhật từng phiếu theo thứ tự ID ổn định trong một transaction; một conflict rollback toàn bộ batch.

## State machine tập trung

`domain/evaluation-transition.ts` là nơi duy nhất khai báo cặp nguồn/đích được phép. Application lấy `from`/`target` từ `EVALUATION_TRANSITIONS` và gọi guard trước khi ghi:

```ts
assertTransition(FormStatus.draft, FormStatus.submitted); // Hợp lệ
assertTransition(FormStatus.rejected, FormStatus.submitted); // Nộp lại
assertTransition(FormStatus.submitted, FormStatus.finalized); // HTTP 409: nhảy cấp
assertTransition(FormStatus.finalized, FormStatus.finalized); // HTTP 409: self-transition
```

Đường chính: `draft → submitted → class_leader_approved → class_approved → faculty_approved → finalized`; `rejected → submitted` bắt đầu lại vòng duyệt. Các nhánh trả về hiện có từ `submitted`, `class_leader_approved`, `faculty_approved` tới `rejected` cũng nằm trong bảng.

`finalized` không có cạnh workflow thông thường đi ra. API admin `reopen` dùng `assertReopenTransition` với cạnh quản trị khai báo trong cùng bảng; nó không khiến `assertTransition(finalized, draft)` trở nên hợp lệ. Tạo phiếu mới là khởi tạo `draft`, không phải chuyển từ một trạng thái có sẵn.

Batch chuyển cấp và finalize đọc thêm `status` của từng candidate và kiểm tra trước khi tạo thao tác ghi; không giả định source hợp lệ chỉ vì query đã lọc status. Các nhóm trạng thái trong query đếm tiến độ vẫn là bộ lọc báo cáo, không phải bảng chuyển trạng thái thứ hai.

Guard chỉ xác nhận cạnh workflow: quyền người gọi, assignment, khóa và dữ liệu điểm vẫn kiểm tra riêng. Snapshot được bảo vệ khi ghi bằng CAS `id + version` như phần dưới.

## Access policy

[EvaluationAccessPolicy](domain/evaluation-access.policy.ts) có sáu capability thuần, không query DB và không phụ thuộc Nest DI. Application lấy dữ kiện ownership/assignment từ Prisma; quyền role khai báo tập trung ở `EVALUATION_ACCESS_ROLES`. Controller vẫn có `RolesGuard`, application cũng kiểm tra quyền để các lời gọi nội bộ không bỏ qua guard HTTP.

| Capability | Role và phạm vi |
|---|---|
| `canRead()` | Sinh viên: chủ phiếu; lớp trưởng/CVHT: assignment đúng lớp; khoa: assignment đúng khoa đang hoạt động; admin/PĐT: toàn hệ thống |
| `canEdit()` | Sinh viên là chủ phiếu, bao gồm thao tác evidence; tạo phiếu kiểm tra role trước khi khởi tạo |
| `canReview()` | Lớp trưởng/CVHT đúng assignment lớp, áp dụng chấm tiêu chí và xác nhận |
| `canSubmitClass()` | Lớp trưởng hoặc CVHT đúng assignment; bước gửi CVHT yêu cầu lớp trưởng, bước gửi khoa yêu cầu CVHT |
| `canApproveFaculty()` | Tài khoản khoa đúng assignment và khoa còn hoạt động |
| `canFinalize()` | Admin/PĐT, dùng cho finalize đơn/bulk/filter và reopen. Legacy review admin dùng capability này; route legacy giữ role admin như trước |

`can*` chỉ quyết định quyền, **không kiểm tra status, isLocked hoặc deadline**. Có quyền sửa chưa có nghĩa trạng thái hiện tại được sửa: permission hợp lệ mới đi tiếp đến state machine/lock/deadline guard. Nhờ đó sai role/assignment trả **403**, sai workflow hoặc stale version trả **409**. Sinh viên đọc/sửa ID phiếu người khác vẫn được che bằng owner filter, trả **404** như trước; ID không tồn tại cũng 404.

Service ghi nhận `{ id, role }` từ `CurrentUser`, không tự gán role dựa vào một bare user ID. `JwtStrategy` nạp principal từ DB mỗi request để lấy role/isActive/deletedAt hiện tại thay cho role có thể đã cũ trong JWT. Tài khoản không còn hợp lệ trả 401; token hợp lệ với role không có quyền endpoint trả 403. Việc này bổ sung một query tài khoản trên request bảo vệ, chưa dùng cache để tránh giữ quyền đã thu hồi.

Các query assignment chạy trong transaction hiện tại khi dùng từ command, không giữ thêm connection. `findAccessible` thêm các field scope nội bộ vào SELECT rồi kiểm tra `canRead` trước khi mapper trả response. Điều này **siết lại** hành vi cũ vốn cho non-student đọc mọi phiếu theo ID. API route/body/response giữ cấu trúc cũ; PĐT được đọc detail/summary/status cùng phạm vi quản trị.

Idempotency không bỏ qua authorization: role được kiểm tra trước lookup receipt; command có scope dùng `authorizeReplay` kiểm tra lại ownership/assignment trong cùng transaction trước khi trả kết quả đã lưu. Gỡ phân công thì replay trả 403; khôi phục quyền thì cùng key trả kết quả cũ, không tăng version hay tạo notification. Replay không kiểm tra lại trạng thái/deadline vì không có lần chuyển trạng thái mới.

### Definition of Done đã kiểm chứng

| Mục | Bằng chứng/trạng thái |
|---|---|
| Invalid transition → 409 | State machine + test HTTP: reviewer đã gán lớp nhưng draft chưa được confirm/finalize |
| Wrong role → 403 | Matrix capability, application boundary trước I/O và test HTTP; role DB thay đổi có hiệu lực với JWT cũ |
| Concurrent update không lost update | Test PostgreSQL hai request cùng version: một thành công, một 409; batch conflict rollback |
| Duplicate submit/finalize không duplicate effect | Receipt cùng transaction; test cùng key, role/scope replay và notification unique |
| Business invariants DB | Unique evaluation/studentCode/username/assignment đã có. Migration `20261020030000_enforce_business_invariants` đã áp dụng local ngày 20/10/2026 sau khi người dùng chọn đóng HK1, giữ HK2 năm học 2025–2026 active. Đã xác minh hai index mới và audit không có dữ liệu vi phạm. Chưa rollout staging/production. Xem [audit và điều kiện deploy](../../../../docs/database-business-invariants.md) |

## Deadline policy

`EvaluationDeadlinePolicy` là policy thuần, không query DB. Mapping deadline, cách tính thời điểm hết hạn và lỗi quá hạn được định nghĩa tại một nơi. Application đọc deadline từ **học kỳ của phiếu/đợt chuyển danh sách**, không lấy deadline của một học kỳ active khác.

| Cấp xử lý | Deadline | Các thao tác dùng policy |
|---|---|---|
| Sinh viên | `studentDeadline` | Submit lần đầu và nộp lại từ rejected |
| Lớp trưởng | `classDeadline` | Chấm tiêu chí, xác nhận, approve/reject, gửi danh sách lên CVHT |
| CVHT | `classDeadline` | Chấm tiêu chí, xác nhận, approve/reject/return-to-student, gửi danh sách lên khoa |
| Khoa | `facultyDeadline` | Duyệt/gửi danh sách từ class_approved lên faculty_approved |
| Admin/PĐT | Chưa có mốc riêng | Finalize đơn, legacy approve/reject, bulk/filter finalize, reopen vẫn qua cùng policy nhưng không mượn hạn của cấp trước |

Các deadline hiện được cấu hình bằng **ngày YYYY-MM-DD** ở API học kỳ. Mặc định policy cho phép đến **23:59:59.999 giờ Việt Nam** của ngày hạn; đúng mốc còn hợp lệ, sau đó trả **409 Conflict**. Ví dụ ngày `2026-10-20` hết hạn tại `2026-10-20T16:59:59.999Z`. Mốc dựng với timezone Việt Nam tường minh, không phụ thuộc timezone process/server. `deadlineFor()` trả giá trị gốc để nhắc việc; `expiresAt()` tính mốc cuối ngày; `assertWithinDeadline()` kiểm tra bằng thời gian server, cho truyền `now` khi unit test.

Deadline null/chưa cấu hình nghĩa là không giới hạn cấp đó. Không suy ra hạn từ endDate hoặc deadline của cấp khác. Tạo/sửa nháp và thêm/xóa evidence vẫn theo quyền sở hữu, trạng thái và khóa; yêu cầu này chặn **submit/review/transition**, không chặn việc chuẩn bị phiếu nháp.

Guard chạy ngay trong transaction trước lần ghi nghiệp vụ đầu tiên. Nếu quá hạn thì không tăng version, không reset/chấm điểm con, không ghi audit hay tạo notification/receipt. Batch quá hạn dừng toàn bộ; khi đã bắt đầu trong hạn, batch dùng mốc kiểm tra đầu transaction, không kiểm tra lại từng row theo tiến độ loop.

Idempotency giữ nguyên ý nghĩa: receipt thành công được replay kể cả khi retry sau hạn, vì không có transition mới. Request thất bại vì deadline không để lại receipt; gia hạn rồi retry cùng key được xử lý lại. Deadline policy không thêm migration hoặc sửa dữ liệu deadline hiện có. Migration business invariants đã áp dụng local sau khi người dùng chọn đóng HK1, giữ HK2 active.

## Optimistic concurrency

`EvaluationForm.version` là `Int @default(0)`. [evaluation-concurrency.ts](application/evaluation-concurrency.ts) thực hiện `updateMany` với `where: { id, version }` và `version: { increment: 1 }` trong cùng câu lệnh. `count = 0` trả HTTP **409 Conflict**, không đọc lại rồi tự ghi đè bằng version mới.

Các response danh sách/chi tiết/tóm tắt/điểm trả thêm `version`. Client có thể gửi `expectedVersion` trên body của thao tác từng phiếu; service kiểm tra snapshot client trước khi CAS id + version. Batch chọn ID nhận `expectedVersions: [{ id, version }]`; đủ selection phải còn đúng candidate/version, nếu không trả 409 và không cập nhật một phần. Client cũ thiếu field vẫn dùng snapshot server để tương thích. FE mới giữ version theo từng màn hình và gửi giá trị đã đọc, không tự GET version mới để ghi đè màn hình cũ. Submit/finalize/review có expectedVersion vẫn replay receipt trước khi kiểm tra lại version, nên retry cùng key không bị stale chỉ vì lần đầu đã tăng version.

- Ghi điểm và state đều CAS trong transaction; response được đọc khi row lock vẫn còn giữ để phản ánh đúng lần ghi vừa thành công.
- Chấm tiêu chí giành version của phiếu trước khi ghi bảng con. Tổng điểm được hoàn tất với version vừa giành, không tăng version lần thứ hai cho cùng thao tác chấm.
- Submit/reject giành version trước khi reset điểm con. Notification chỉ tạo trong transaction thắng và chỉ emit sau commit.
- Chuyển cấp/finalize batch đọc version từng candidate, khóa theo thứ tự ID; conflict một phiếu rollback toàn batch.
- Khóa/mở khóa học kỳ tăng version của mỗi phiếu bị đổi cờ bằng phép increment nguyên tử, làm snapshot cũ không còn ghi được. Những thao tác này không ghi đè điểm.
- Không thêm unique index `(id, version)`: primary key `id` đã định vị duy nhất một row cho điều kiện CAS.

Migration: `20261020010000_add_evaluation_form_version`. Đã áp dụng trên DB local `apag` ngày 20/10/2026. Môi trường khác cần chạy migration trước khi dùng code/client mới; chưa triển khai production.

## Hành vi cố ý giữ nguyên

- Prefix, HTTP method, DTO, role guard, cấu trúc response và alias `/admin/evaluations`, `/admin/training-evaluations`, `/training-department/evaluations` không đổi. Lỗi chuyển trạng thái dùng HTTP 409 với thông báo chung `Không thể chuyển phiếu từ <current> sang <target>`.
- Detail/summary/status đã áp dụng `canRead`: sinh viên chỉ xem phiếu của mình; lớp trưởng/CVHT theo assignment lớp; khoa theo assignment khoa; admin/PĐT đọc toàn hệ thống.
- Finalize đơn kiểm tra khóa và điểm hợp lệ. Batch vẫn dùng `classScore ?? 0` và giữ bộ lọc cũ. `finalizeReviewedForm` giữ riêng hành vi route `POST /:id/review`, không thêm kiểm tra khóa mới.
- `reopen` giữ nguyên điểm sinh viên và không tự xóa `isLocked`.
- Snapshot điểm/trạng thái dùng optimistic concurrency. Request có key dùng idempotency như phần dưới; outbox cho socket vẫn là phần việc riêng.

Các comment trong service đánh dấu những điểm này để tránh vô tình đổi hành vi khi tối ưu tiếp.

## Idempotent operations

Các route submit, gửi danh sách qua các cấp, review-scores, confirm-review, approve/reject/return-to-student, finalize đơn, bulk-finalize và finalize-by-filter nhận header **`Idempotency-Key`**. Swagger mô tả header trên từng route; các alias admin dùng chung receipt.

```http
PATCH /api/v1/admin/evaluations/bulk-finalize
Authorization: Bearer <access-token>
Idempotency-Key: 7f735fbd-0618-4fe0-85b5-9fd1bfba3215
Content-Type: application/json

{"ids":["<evaluation-id>"]}
```

Client tạo key khi bắt đầu **một ý định thao tác**, giữ cùng key/body cho double-click hoặc retry do timeout/mất kết nối. Không gọi `randomUUID()` riêng cho mỗi lần retry. Thao tác mới, thay đổi body, hoặc nộp/duyệt lại sau reject/reopen phải dùng key mới. Header gồm 1–200 ký tự ASCII hiển thị, không chứa khoảng trắng. Client cũ thiếu header vẫn dùng CAS như trước, nhưng không có replay kết quả; đặc biệt retry finalize-by-filter cần key để không xử lý thêm candidate mới.

Luồng trong [idempotent-operation.ts](../../common/idempotency/idempotent-operation.ts):

1. Scope = hash người gọi + action + key; hash body chuẩn hóa thứ tự thuộc tính, gồm cả resource ID. Không lưu key thô/token.
2. Mở transaction PostgreSQL và lấy advisory transaction lock theo scope. Các process/instance khác cùng key phải chờ transaction này.
3. Nếu đã có receipt, cùng payload kiểm tra lại authorization hiện tại rồi trả đúng kết quả ban đầu; payload khác trả **409**. Receipt giữ cả thời điểm/version/count cũ, không dùng trạng thái hiện tại để dựng lại response.
4. Nếu chưa có receipt, kiểm tra quyền/trạng thái và thực hiện nghiệp vụ trong transaction đó. Các callback transaction bên trong dùng lại cùng client; không commit riêng. Các query phân công cũng dùng client đó để không cần connection thứ hai.
5. Lưu receipt cùng transaction. Bất kỳ lỗi nào, kể cả khi lưu receipt, rollback toàn bộ; retry cùng key có thể chạy lại. Request khác key vẫn được bảo vệ bằng CAS.
6. Sau commit mới phát socket cho notification vừa tạo. Replay không phát lại. Socket thất bại không đổi một command đã commit thành lỗi API.

`operation_receipts` không tự hết hạn: retry cũ không được thực thi lại sau restart/deploy. Xóa receipt sẽ mất bảo đảm replay cho key đó, nên chưa thêm job xóa theo TTL. Đây là bảng kết quả command, không phải repository bọc Prisma.

Notification có `dedupe_key` unique, hash từ recipient và business event. `createNotificationOnce()` dùng `INSERT ... ON CONFLICT DO NOTHING` qua Prisma `createManyAndReturn(skipDuplicates: true)`; chỉ trả row vừa tạo để caller emit. Reject dùng form ID + version của lần reject, gửi danh sách dùng target + danh sách form ID/version đã chuyển. Nhờ vậy retry không tạo trùng nhưng vòng duyệt mới vẫn có notification riêng. Reminder và thông báo mở/đóng học kỳ tạo một lần/người/học kỳ/loại sự kiện, không phụ thuộc câu chữ/deadline.

Thông báo lưu DB là nguồn chính. Nếu process dừng sau commit nhưng trước emit, client vẫn đọc được qua API; chưa có outbox bảo đảm giao socket. Migration additive `20261020020000_add_idempotent_operations` đã áp dụng DB local `apag`; môi trường khác chạy `pnpm db:deploy` trước code mới.

## Kiểm tra

Chạy trong `projects/`:

```bash
pnpm typecheck
pnpm lint
pnpm test --runInBand
pnpm test:e2e --runInBand
pnpm test:concurrency
pnpm build
```

Unit test dùng Prisma/notification giả lập, kiểm tra scope quyền, công thức và ngưỡng xếp loại, reset vòng duyệt, xác nhận không chuyển cấp, emit sau commit và khác biệt finalize đơn/batch. Test fixture nằm ở `test/fixtures/evaluation.fixture.ts`; không cần chạy seed hay sửa dữ liệu DB thật để chạy unit test.

`domain/evaluation-transition.spec.ts` kiểm tra toàn bộ 49 cặp trạng thái, gồm nhảy cấp, self-transition và trạng thái kết thúc; reopen quản trị được kiểm tra riêng. Test application kiểm tra candidate sai trạng thái không được bắt đầu transaction hoặc emit notification.

`test:concurrency` chạy test PostgreSQL thật từ `test/evaluation-concurrency.e2e-spec.ts`, dùng DB cấu hình local hoặc `TEST_DATABASE_URL` nếu đặt. Test tạo và dọn schema ngẫu nhiên riêng, không sửa record trong `public`. Cần quyền tạo schema và migration version đã có ở database test. Test ép hai HTTP request đọc cùng version: đúng một response 200 và một 409, tổng điểm không mất cập nhật; request retry đọc version mới được phép chạy. Các test khác xác minh conflict ở candidate cuối làm rollback cả batch và hai lần finalize cùng phiếu chỉ một lần thành công. `test:e2e` thông thường bỏ qua nhóm PostgreSQL này khi không có `TEST_DATABASE_URL`; dùng lệnh riêng để chạy đầy đủ.

Nhóm PostgreSQL còn kiểm tra idempotency: submit/review/confirm/reject/finalize/bulk chạy đồng thời cùng key trả cùng kết quả; rollback cả notification và receipt khi lỗi; key khác payload trả 409; scope tách actor/action; retry filter không lấy thêm phiếu mới; notification/reminder không trùng khi nhiều request chạy song song. HTTP test kiểm tra header và replay xuyên hai alias admin.

Deadline được kiểm tra bằng unit test theo role và biên trước/đúng/sau hạn, ngày hạn theo giờ Việt Nam, null, phạm vi từng field; application test chặn trước khi ghi. PostgreSQL/HTTP test kiểm tra submit quá hạn 409, retry sau gia hạn, replay sau hạn, confirm kèm điểm không để lại dữ liệu và batch quá hạn không tạo notification.
