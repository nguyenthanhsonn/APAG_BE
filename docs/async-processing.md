# Phase 6 — BullMQ async email và export

Cập nhật 21/10/2026. API producer và worker chạy ở **process riêng**; không khởi chạy SMTP/render nặng trong API. Không thay schema DB nghiệp vụ trong phase này.

## Luồng và cấu trúc

```text
HTTP → DB commit → encrypted job trong Redis/BullMQ → response
                            ↓
                    worker process riêng
                    ├── email → SMTP
                    └── report → DB → PDF/XLSX/DOCX → private shared volume
```

| File/nhóm | Trách nhiệm |
|---|---|
| `src/infrastructure/queue/queue.service.ts` | Queue producer, bounded connection/startup, retry/backoff/retention, idempotent job IDs, metrics snapshots |
| `queue-crypto.service.ts` | AES-256-GCM với random IV, AAD gắn namespace/queue/job; HMAC intent/idempotency |
| `report-storage.service.ts` | File private, atomic rename, TTL và cleanup |
| `src/workers/email.worker.ts` | Decrypt payload, kiểm tra expiry/reset token, gọi SMTP transport |
| `src/workers/report.worker.ts` | Kiểm tra owner hiện tại, query dữ liệu, render file, lưu output |
| `src/workers/worker-job.ts` | Khôi phục requestId/correlation/trace, consumer span, log và duration |
| `src/workers/main.ts` | Bootstrap process chỉ có `/metrics`; drain jobs trước khi đóng DB/queue |
| `src/modules/mail/student-account-mail.service.ts` | Facade giữ các method cũ nhưng chỉ enqueue |
| `src/modules/mail/smtp-mail.service.ts` | Templates + Nodemailer, chỉ được khởi tạo trong worker |
| `src/modules/reports/report-jobs.service.ts` | Create/status/download và owner checks |

## Email

Các luồng tạo tài khoản sinh viên, nhân sự, import tài khoản và forgot-password enqueue sau khi DB transaction đã commit. Bỏ khoảng nghỉ SMTP 1 giây giữa các batch trong HTTP import; tốc độ gửi do worker/queue điều tiết.

- Tối đa **4 attempts**, exponential backoff mặc định 1s, 2s, 4s. Producer không có offline queue để request không chờ vô hạn khi Redis mất.
- Email concurrency mặc định 3 trên mỗi worker process; limiter 20 jobs/giây trên queue. Thay concurrency qua env nếu SMTP provider cho phép.
- Nodemailer có connection/greeting timeout 10s, idle socket timeout 30s. SMTP exception thô không đưa vào BullMQ failedReason/stacktrace hoặc log.
- Account job trùng nội dung dùng cùng HMAC jobId trong thời gian job còn được giữ. Không lưu plaintext mật khẩu, email body hoặc reset URL trong Redis job data; worker giải mã khi xử lý.
- Message-ID ổn định theo jobId hỗ trợ nhận diện retry; SMTP không bảo đảm exactly-once khi process mất ngay sau nhà cung cấp đã nhận mail.
- Reset email dùng deadline của token đã commit. Worker bỏ qua token hết hạn, đã dùng/bị thay thế, user bị khóa/xóa; những job này terminal failed, không retry vô ích.
- Completed jobs giữ tối đa 24h/10.000 job mỗi queue; failed jobs giữ tối đa 7 ngày/10.000 job. BullMQ dọn theo hoạt động của queue, không phải cron TTL chính xác từng giây.

Response tạo tài khoản có `accountEmailQueued`; `accountEmailSent=false` vì API không thể khẳng định SMTP đã giao mail. Import có `emailQueuedCount`; `emailSentCount=0`. `accountEmailError`/`emailFailedCount` ở response phản ánh lỗi enqueue/config, không phải kết quả delivery về sau. Kết quả delivery xem worker logs và queue metrics. FE đã cập nhật câu chữ “đã vào hàng đợi”.

**Giới hạn atomicity:** DB commit và Redis enqueue là hai bước riêng. Không có transactional outbox trong thay đổi này; crash giữa hai bước có thể để lại tài khoản chưa có email job. Enqueue lỗi được trả/ghi nhận; cần cơ chế outbox/reconciliation nếu muốn loại bỏ khoảng trống đó. Không tự nhận bảo đảm exactly-once hoặc delivery thành công chỉ vì enqueue thành công.

## Export API

Các endpoint mới dành cho **admin**, chỉ owner được đọc trạng thái/tải file. Worker còn kiểm tra user đang active, chưa xóa và vẫn là admin trước khi tạo báo cáo.

```http
POST /api/v1/reports/exports
Authorization: Bearer <access token>
Idempotency-Key: <optional stable key for one export intent>
Content-Type: application/json

{"format":"xlsx","academicYear":"2025-2026","semester":"HK1"}
```

HTTP **202** với envelope hiện có:

```json
{"data":{"jobId":"...","statusUrl":"/api/v1/reports/exports/..."}}
```

Body kế thừa bộ lọc hiện có: `semester` (`HK1`, `HK2`, `SUMMER` theo DTO hiện tại), `academicYear`, `classId`, `facultyId`, `status`. `format` chỉ nhận `pdf`, `xlsx`, `docx`. Không nhận SQL, đường dẫn file hoặc template tùy ý từ client.

```http
GET /api/v1/reports/exports/:jobId
GET /api/v1/reports/exports/:jobId/download
```

Status là `pending`, `processing`, `completed`, `failed`; completed có fileName/bytes/expiresAt/downloadUrl. File chưa hoàn tất trả 409; owner khác hoặc job không tồn tại trả 404; role không phù hợp trả 403; job/file hết hạn trả 410. Lỗi queue trả 503. Không trả stacktrace hoặc SQL/SMTP errors qua status.

Cùng Idempotency-Key + owner + cùng intent trả lại jobId; đổi nội dung trả 409. Key thứ tự khác nhau trong JSON object không làm thay đổi intent. Dedupe chỉ còn hiệu lực trong thời gian job được giữ.

PDF có bundled Noto Sans để đọc tiếng Việt, kèm giấy phép OFL trong `assets/fonts/LICENSE`. XLSX/DOCX giữ Unicode. Báo cáo background hiện xuất bảng kết quả rèn luyện theo dữ liệu/bộ lọc trên DB; không thay thế nội dung các template biên bản họp lớp/khoa riêng.

GET export-pdf cũ chỉ render tối đa 500 dòng; lớn hơn trả 400 yêu cầu dùng async API. Biên bản template đồng bộ giới hạn 500 sinh viên. Các hàm `API_Admin.exportReportPdf/Excel/Docx` trong FE đã chuyển sang create job → poll → download, giữ kiểu trả Blob cho caller cũ. Có thêm `createReportExport/getReportExport/downloadReportExport` để màn hình quản lý job dùng trực tiếp; chưa thêm màn hình quản lý export mới. Compatibility polling tối đa khoảng 5 phút, job vẫn tiếp tục nếu người dùng đóng trang.

## Lưu file và scale

Output mặc định `.local/report-exports` so với working directory `projects`, file mode 0600, thư mục 0700 khi tạo mới. Ghi file tạm rồi rename, không publish thư mục tĩnh. TTL mặc định 24h, worker cleanup mỗi giờ; status/download từ chối ngay khi deadline đã qua. File name trên disk chỉ dựa trên jobId hợp lệ và format whitelist.

**Tất cả API và worker phải thấy cùng `REPORT_EXPORT_DIR`.** Compose đã mount named volume `report-exports` chung. Nhiều host phải dùng shared filesystem có quyền phù hợp, hoặc thay storage provider bằng object storage; hiện chưa tích hợp S3/Cloudinary hoặc signed URL. Không dùng local disk riêng trên mỗi replica rồi kỳ vọng download ở node khác hoạt động.

Worker report concurrency 1/process, lockDuration 120s. Worker process tách khỏi API nhưng report vẫn dùng RAM để query/render và dùng cùng event loop với email worker trong process đó. Chưa benchmark export rất lớn hoặc khẳng định giới hạn throughput/RAM; nếu CPU job dài hơn lock window cần sandboxed processor/worker thread hoặc tách report worker tiếp. Khi shutdown có kiểm soát, drain consumers trước khi đóng Prisma/queue. Compose cho worker 180s stop grace; kill cứng vẫn theo stalled/retry semantics của BullMQ.

## Chạy và cấu hình

Chạy Redis, PostgreSQL và API như hiện tại; mở terminal thứ hai:

```bash
cd /Users/nguyenson/APAG_BE/projects
pnpm worker:dev
# Bản compiled:
pnpm build
pnpm worker:start
```

Worker `/metrics` mặc định `127.0.0.1:5051`; API metrics vẫn 5050. Worker không mở auth/reports/business routes hay Socket.IO. Production Compose có service `worker` riêng với cùng env secrets/Redis/volume. Không tự chạy worker trên SMTP thật trong kiểm thử của phiên này; test chỉ dùng SMTP local giả lập.

Env bổ sung đã có trong `.env.example`:

| Env | Mặc định |
|---|---|
| `WORKER_HOST` | `127.0.0.1` (Compose: `0.0.0.0`) |
| `WORKER_METRICS_PORT` | `5051` |
| `EMAIL_WORKER_CONCURRENCY` | `3` |
| `QUEUE_BACKOFF_MS` | `1000` |
| `REPORT_RETENTION_SECONDS` | `86400` |
| `REPORT_EXPORT_DIR` | `.local/report-exports` |
| `QUEUE_ENCRYPTION_KEY` | Optional 64 hex chars; nếu trống dẫn xuất key riêng từ shared JWT_REFRESH_SECRET |

Dùng cùng Redis/prefix và encryption key giữa producer/worker. Channel/key namespace là `${REDIS_KEY_PREFIX}bull`. Thay key/refresh secret khi còn job chưa xử lý có thể khiến job cũ không giải mã được; cần drain/rotate theo kế hoạch. Không FLUSHDB hoặc dùng eviction cho Redis chứa cả queue và revocation.

## Metrics, dashboard và tracing

Prometheus config bổ sung target host port 5051 cùng job `apag-backend`; dùng cùng METRICS_TOKEN. Giữ OTEL_SERVICE_NAME cùng API theo Compose/default để dashboard hiện tại lọc được cả hai, dùng instance selector phân biệt API/worker.

- `queue_jobs_waiting{queue="email|report"}`: waiting + delayed, gồm job chờ retry.
- `queue_jobs_failed`: job đã terminal failed và còn được giữ.
- `queue_enabled`: snapshot Redis thành công/thất bại.
- `queue_job_duration{queue,status}`: histogram từng execution attempt trong worker; buckets tới 300s.

Các panel queue depth/failed/duration trong dashboard Phase 2 dùng metrics thật. Queue depth là cùng một Redis queue được scrape từ nhiều process: **không sum gauge qua các replica**. Duration chỉ được observe tại consumer; phải scrape worker để thấy mẫu.

Job carrier chỉ lưu requestId/correlationId/W3C trace context. `restoreJobContext` tạo consumer span, tiếp tục Prisma/SMTP child spans và log `queue.job`/`queue.job_failed` theo jobId, queue, attempt. Không đưa job payload/password/reset URL/SMTP credential vào log hoặc failedReason.

## Kiểm thử

```bash
pnpm test:queue
pnpm typecheck
pnpm test --runInBand
pnpm lint
pnpm build
```

Harness tạo DB test mới, Redis AOF riêng, hai Nest API process và worker process; SMTP giả lập chỉ nghe loopback, không gửi ra Internet. Kiểm tra DB commit + enqueue khi worker dừng, request không chờ SMTP, encryption, bounded retry/backoff, failed metrics, idempotency, owner/role checks, PDF/XLSX/DOCX qua node khác, worker restart và reset link bị thay thế. Không thay record của DB APAG.

Kết quả lượt kiểm chứng cuối: **45 integration checks**, **310 unit tests**, backend typecheck/lint/build đạt; Compose config hợp lệ. FE: **21 API tests**, **17 socket tests**, TypeScript/lint các file liên quan và production build đạt. Worker logs thực tế có requestId/correlationId; SMTP trong test là loopback giả lập. Chưa chạy container runtime/Grafana UI hoặc SMTP nhà cung cấp thật trong phiên này.

Nguồn kỹ thuật: [BullMQ connections](https://docs.bullmq.io/guide/connections), [retry/backoff](https://docs.bullmq.io/guide/retrying-failing-jobs), [retention](https://docs.bullmq.io/guide/queues/auto-removal-of-jobs), [Nodemailer timeouts](https://nodemailer.com/smtp).
