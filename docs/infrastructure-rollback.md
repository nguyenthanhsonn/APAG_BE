# Rollback infrastructure phụ thuộc Redis — 23/10/2026

Runtime hiện chạy **một NestJS API + PostgreSQL**, không cần Redis, BullMQ hoặc worker riêng. Rollback chỉ sửa các adapter/infrastructure phụ thuộc Redis và wiring/caller tương ứng. Không rollback cả commit chứa nhiều phase.

## Thay đổi

| Phần | Sau rollback |
|---|---|
| Token revocation | Map local, expiry theo lifetime JWT; giữ monotonic revocation stamp |
| Profile | Đọc DB trực tiếp; update/lock/delete không cần invalidation cache |
| Import preview | Map local mã hóa, TTL 10 phút; claim một lần trước await; tối đa 100 preview |
| Socket.IO | Adapter mặc định local; giữ JWT handshake, kiểm tra DB role/lock/delete, expiry/revocation và room do server xác định |
| Email | Gửi SMTP trực tiếp sau DB commit; accountEmailSent/emailSentCount phản ánh kết quả SMTP; queued fields trả false/0 |
| Export | Giữ POST/status/download cho FE; query/render/save xử lý ngay trong POST, không còn background worker |
| Deployment | Compose bỏ Redis/worker/dependencies; Prometheus scrape API:5050 |
| Dependencies | Gỡ redis, bullmq và @socket.io/redis-adapter khỏi package/lockfile |

FE chỉ đổi bốn thông báo email/import đang phụ thuộc queued sang kết quả SMTP sent; không đổi API layer/socket/business flow của FE. Không đưa CAPTCHA trở lại. Native Redis/volume/dữ liệu Redis cũ không bị xóa hoặc tự dừng; app không còn kết nối tới chúng.

## Phần giữ nguyên

- Training evaluations application/domain/presentation, state machine, deadline/access policies.
- Optimistic concurrency/version, 409 Conflict, idempotency và notification dedupe ở PostgreSQL.
- Evidence explicit form, uniqueness/business constraints và toàn bộ schema/migration.
- Pino, request/correlation ID, Prometheus metrics, OpenTelemetry và SMTP instrumentation.
- DB_POOL_MAX / DB_POOL_IDLE_TIMEOUT / DB_POOL_CONNECTION_TIMEOUT, hai index và benchmark SQL Phase 7.
- JWT verification cho HTTP và WebSocket, room authorization, current DB principal checks.

## Giới hạn vận hành

Đây là mô hình một API instance. Revocation/import preview/export registry nằm trong RAM, không chia sẻ giữa replica và mất khi process restart. Role/lock/delete và refresh-token hash vẫn nằm trong DB. Revocation của JWT còn hạn không bền qua restart; JWT hợp lệ trước đó có thể được chấp nhận lại nếu account trong DB vẫn active. Không dùng các benchmark multi-instance cũ làm cam kết cho runtime này.

Email không có BullMQ retry/backoff/durable queue. Request gửi mail chờ SMTP; lỗi mail không rollback account đã commit. Password reset vẫn vô hiệu hóa reset token nếu gửi thất bại.

Export POST vẫn trả jobId/statusUrl với HTTP 202 để FE tiếp tục dùng, nhưng chỉ trả sau khi render xong hoặc thất bại. FE poll thường thấy completed/failed ngay. Metadata/idempotency key theo owner lưu trong RAM tới TTL, không bền qua restart. Chỉ render một file tại một thời điểm; yêu cầu khác trả 503 để không tạo queue RAM vô hạn. Registry tối đa 256 bản ghi chưa hết hạn. File vẫn private trên local filesystem, download kiểm tra TTL; cleanup file hết hạn chạy khi có export tiếp theo; owner checks và download expiry giữ nguyên. Render lớn có thể tăng latency/CPU của API; không còn đặc tính tách tải sang worker của Phase 6.

## Chạy và kiểm tra

Từ `/Users/nguyenson/APAG_BE/projects`:

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm test --runInBand
pnpm build
pnpm test:local-infrastructure
pnpm test:observability
```

Test local tạo một database PostgreSQL mới với tên ngẫu nhiên, chỉ gửi mail vào SMTP giả loopback; API được khởi động với REDIS_URL trỏ tới port không có Redis. Kiểm tra login/profile, refresh/logout revocation, JWT socket/room/notification local, direct SMTP, PDF/XLSX/DOCX export/download/idempotency và queue metrics disabled. Test dọn đúng DB test/process của nó, không thay dữ liệu APAG.

Các tài liệu Redis/shared state, multi-instance realtime, async worker và JSON benchmark trước đây giữ làm lịch sử, có nhãn rollback. Script multi-instance Redis cũ không còn là lệnh chạy hiện tại; thay bằng test:local-infrastructure.
