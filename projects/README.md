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

### Runtime một instance — rollback Redis (23/10/2026)

Backend không còn cần Redis, BullMQ hoặc worker process riêng. Compose chỉ chạy PostgreSQL và backend.
JWT socket/role checks vẫn giữ; notification dùng adapter Socket.IO local. Profile đọc DB trực tiếp;
revocation và import preview nằm trong RAM của một API instance. Email gửi SMTP trực tiếp sau commit.
Export vẫn có POST/status/download nhưng render trong request; metadata export/idempotency lưu RAM.
Không scale nhiều API replica với cấu hình này. Sau restart, preview/export metadata/revocation local mất.

Chạy `pnpm test:local-infrastructure` để kiểm tra API, auth/socket, SMTP giả và export với Redis không khả dụng.
Xem [phạm vi rollback và vận hành](../docs/infrastructure-rollback.md).
