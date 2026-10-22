# SMASTE Backend

Backend API cho hệ thống quản lý sinh viên và đánh giá rèn luyện, xây bằng NestJS, Prisma và PostgreSQL.

## Cấu trúc thư mục

```text
.
├── src/
│   ├── main.ts
│   ├── app.module.ts
│   ├── common/
│   ├── config/
│   ├── database/
│   └── modules/
├── prisma/
│   ├── schema/
│   ├── migrations/
│   └── seeds/
├── test/
├── nest-cli.json
├── package.json
├── prisma.config.ts
├── tsconfig.json
└── tsconfig.build.json
```

## Chạy dự án

```bash
pnpm install
pnpm db:generate
pnpm dev
```

Health check:

```text
GET http://127.0.0.1:5050/api/v1/health
```

## Database

Tạo migration:

```bash
pnpm db:migrate --name init
```

Deploy migration:

```bash
pnpm db:deploy
```

Mở Prisma Studio:

```bash
pnpm db:studio
```

## Scripts

- `pnpm dev`: chạy backend ở môi trường dev.
- `pnpm build`: build NestJS app.
- `pnpm start:prod`: chạy bản build trong `dist`.
- `pnpm lint`: kiểm tra lint.
- `pnpm typecheck`: kiểm tra TypeScript.
- `pnpm test`: chạy unit test.

## Cấu hình và vận hành

- [Biến môi trường](../docs/environment.md): cách nạp `.env`, defaults, database URL và mức log.
- [Kiến trúc hiện tại](../docs/architecture.md).
- [Deployment hiện tại](../docs/deployment.md): local, Docker Compose và các phần hạ tầng chưa xác minh.
- [Luồng API quan trọng](../docs/api-critical-flows.md), [baseline](../docs/performance-baseline.md), [roadmap](../docs/scaling-roadmap.md).

Business invariants, kết quả audit và migration đang chờ xử lý dữ liệu: [database-business-invariants.md](../docs/database-business-invariants.md). Test DB riêng: `pnpm test:invariants`.

### Observability (Phase 2)

Pino JSON, request/correlation ID, `GET /metrics` và OpenTelemetry được triển khai trong `src/observability/`.
Chạy `pnpm test:observability` để kiểm tra HTTP + trace/DB/dependency probe (cần DB local).
Cấu hình tools ở `infra/observability/`; xem [runbook](../docs/observability.md) và [báo cáo kiểm chứng](../docs/phase-2-observability-report.md).
Production cần `METRICS_TOKEN` hoặc `METRICS_ENABLED=false`.

### Performance baseline (Phase 3)

Synthetic seed và k6 scenarios nằm ở [performance/](../performance/README.md).
Seed tạo database local mới có prefix `apag_benchmark_`, giữ nguyên dữ liệu APAG.
Xem [baseline trước optimization](../docs/performance-baseline.md) để đọc workload, latency, RPS, CPU/RAM và pool connections.

### Redis và shared API state (Phase 4)

Backend cần Redis (`REDIS_URL`, mặc định loopback 6379), không fallback auth state về RAM.
Token revocation, profile cache và import preview đã dùng shared Redis.
Xem [kiến trúc, cấu hình và rollout](../docs/redis-stateless-api.md). Chạy `pnpm test:redis` để kiểm tra hai API process.

## Realtime nhiều instance — Phase 5

Socket.IO xác thực access JWT ở handshake, tự join room của user và dùng Redis Pub/Sub adapter để broadcast xuyên API. FE gửi `auth.token`, dùng websocket-only. Polling client cần sticky session tại load balancer. Xem [contract, kiểm thử và vận hành](../docs/realtime-multi-instance.md).

## Async workers — Phase 6

Email và export lớn dùng BullMQ. Chạy process riêng bằng `pnpm worker:dev` (compiled: `pnpm worker:start`). Worker metrics ở 5051; API metrics ở 5050. Các API và worker phải chia sẻ `REPORT_EXPORT_DIR`. Compose đã có worker service và shared volume. Xem [flow, API contract, retry và kiểm thử](../docs/async-processing.md).
