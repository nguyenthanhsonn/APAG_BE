# Báo cáo Phase 2 — Observability

Ngày 20/10/2026. Phạm vi: backend NestJS và cấu hình monitoring local. Hướng dẫn vận hành chi tiết: [Observability và runbook](observability.md).

## Kết quả

| Hạng mục | Kết quả |
|---|---|
| Structured logging | Pino JSON thay Nest output; request/correlation ID, method, route template, status, duration, actor sau xác thực; log DB chậm cùng trace/request ID |
| An toàn log/trace | Không export body/header/JWT/SQL/parameters/raw driver error; redaction secret theo key và giá trị env; canary tests |
| Metrics | `/metrics` OpenMetrics, bearer riêng; HTTP, CPU, RSS, event loop, pg pool/query, Socket.IO và hook queue |
| Grafana | Dashboard JSON 20 panel và datasource Prometheus/Tempo được provision; Compose config kiểm tra hợp lệ |
| OpenTelemetry | Đã xác nhận cây span HTTP → NestJS → Prisma → PostgreSQL và HTTP/SMTP dependency; carrier cho job |
| Vận hành end-to-end | **Chưa xác nhận**: Docker daemon chưa hoạt động, quyền Docker UI không được cấp; chưa chạy container/scrape/ingestion/dashboard live |

Code tập trung trong `projects/src/observability/`; các điểm nối chính là `main.ts`, `PrismaService`, `NotificationsGateway`, mail service và exception filter. Không thêm repository abstraction, queue business engine, migration hoặc thay dữ liệu nghiệp vụ.

## Bằng chứng kiểm thử

- Build production, TypeScript và ESLint đạt; lint đã bao gồm module observability mới.
- 22 unit suites, **290 tests đạt**.
- 2 HTTP observability integration tests đạt: context isolation, response IDs cho success/403/404/malformed JSON, raw metrics và label privacy.
- Probe riêng process thu **46 span**, có 4 PostgreSQL query span; xác nhận quan hệ parent của DB/job, HTTP correlation/W3C headers, SMTP sink loopback, metrics exemplar và không export các canary SQL/secret.
- 29 PostgreSQL concurrency/workflow tests và 12 DB invariant tests đạt sau thay đổi driver instrumentation/dependencies. Test dùng schema tạm theo harness hiện có.
- Smoke test bản `dist/main.js` trên port loopback riêng: health 200, `/auth/me` không token 401, `/metrics` thiếu bearer 403 và có bearer 200; Pino JSON/request headers đúng, không chứa secret canary. Không dừng backend hiện có.
- Compose qua `config --quiet`; dashboard JSON hợp lệ, 20 ID panel duy nhất và có query cho mọi nhóm metric yêu cầu. Chưa xác minh PromQL bằng Prometheus runtime.

Smoke probe dùng SELECT trên DB local và dependency giả lập loopback; không gửi email ra ngoài. Đây không phải load benchmark. Không kết luận hệ thống đã nhanh hơn hoặc đã đủ capacity từ những số này.

## Cách dùng khi API chậm

Đối chiếu route p95/p99 và error rate → request ID/log → trace exemplar. Pool waiting/checkout chỉ ra chờ connection; PG span chỉ ra roundtrip DB; CPU và event loop hỗ trợ nhận diện application CPU; HTTP/SMTP child span chỉ ra dependency. Khoảng trống trong Nest span cần thêm span nghiệp vụ cụ thể. CPU đang đo Node process, nên nguyên nhân bên trong PostgreSQL còn cần DB diagnostics.

Queue chưa tồn tại: `queue="none"`, `queue_enabled=0` là trạng thái đúng. Tracing mặc định tắt; bật env và collector theo runbook. Production phải cấp `METRICS_TOKEN` riêng hoặc tắt metrics trước khi khởi động bản mới.

## Phần còn lại để đạt DoD vận hành

Chạy Docker stack theo runbook, xác nhận Prometheus target `up=1`, Tempo nhận trace, Grafana hiển thị traffic và exemplar mở đúng trace. Sau đó thu traffic đại diện để đặt SLO/alert và cập nhật baseline. Phần code/instrumentation đã được kiểm thử; chưa tuyên bố toàn bộ Phase 2 vận hành hoàn tất trước bước này.
