# Biến môi trường

Chuẩn hóa ngày 19/10/2026. Mẫu cấu hình: [projects/.env.example](../projects/.env.example). Sao chép thành `projects/.env` và điền credential; không ghi đè `.env` đang dùng bằng file mẫu.

Backend đọc `.env` cạnh thư mục `src/` hoặc `dist/`, tức `projects/.env`; không còn phụ thuộc working directory. Biến môi trường do process/container truyền vào được ưu tiên hơn file. Prisma CLI và các seed cũng nạp `projects/.env`. Các service backend đọc cấu hình qua `ConfigService`/namespace `app`; `app.config.ts` là nơi chuyển env thành cấu hình runtime.

## Quy ước

- Boolean chỉ nhận `true` hoặc `false`, viết thường. Port là số nguyên 1–65535.
- Giá trị có khoảng trắng, dấu `#` hoặc ký tự đặc biệt nên đặt trong dấu nháy. Password là chuỗi nguyên bản, không trim khoảng trắng đầu/cuối.
- `JWT_*_EXPIRES_IN` là số nguyên dương kèm đơn vị, ví dụ `15m`, `7d`; không dùng chuỗi số thiếu đơn vị.
- Không log URL kết nối, password, JWT hoặc import token. File mẫu chỉ chứa placeholder; credential thật được cấp qua `.env` ngoài Git hoặc secret của môi trường triển khai.

## Ứng dụng và trình duyệt

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `NODE_ENV` | `development` | `development`, `test`, `production` |
| `BACKEND_HOST` | `0.0.0.0` | Địa chỉ bind thực tế; đặt `127.0.0.1` nếu chỉ phục vụ local |
| `BACKEND_PORT` | `5050` | Port app khi chạy trực tiếp; khi dùng Compose là port công bố trên host, bên trong container cố định 5050 |
| `LOG_LEVEL` | `info` | `error`, `warn`, `info`, `debug`, `verbose`; mỗi mức gồm các mức nghiêm trọng hơn |
| `SWAGGER_ENABLED` | `true` | Bật `/api/docs` và `/api/docs-json`; production có thể đặt `false` |
| `PRISMA_CONNECT_ON_INIT` | `true` | Kiểm tra kết nối DB khi khởi động; `false` chỉ bỏ kiểm tra ban đầu |
| `FRONTEND_URL` | `http://localhost:3000` | Danh sách origin cách nhau bằng dấu phẩy, không kèm path; dùng chung cho REST và Socket.IO |
| `STUDENT_PORTAL_URL` | Chưa đặt | URL đăng nhập trong email; khi thiếu dùng origin đầu tiên của `FRONTEND_URL` với path `/login` |
| `PASSWORD_RESET_URL` | Chưa đặt | URL trang đặt lại mật khẩu; nên khai báo rõ khi có nhiều frontend |

Nếu không đặt `PASSWORD_RESET_URL`, code chọn frontend đầu tiên không chứa `localhost`, rồi frontend đầu tiên, rồi portal; đổi path thành `/reset-password`. Không còn ưu tiên địa chỉ ZeroTier cố định trong code.

`DEBUG_STARTUP` đã được bỏ cùng các timer startup. Timing import còn giữ dưới Nest Logger ở mức debug; bật bằng `LOG_LEVEL=debug`. Log lỗi vận hành vẫn được giữ. Log startup được buffer đến khi áp dụng mức log.

## Database

Chọn **một** cách cấu hình cho môi trường trực tiếp:

1. `DATABASE_URL`: URL PostgreSQL đầy đủ; percent-encode username/password nếu có ký tự đặc biệt.
2. Các biến rời `DB_HOST`, `DB_PORT` (5432), `DB_NAME`, `DB_USER` (`postgres`), `DB_PASS`, `DB_SCHEMA` (`public`); code tự encode credential để ghép URL.

| Đường chạy | Thứ tự ưu tiên |
|---|---|
| Backend và seed | `DATABASE_URL` → `DIRECT_URL` → `DB_*` |
| Prisma CLI | `DIRECT_URL` → `DATABASE_URL` → `DB_*` |

`DIRECT_URL` là tùy chọn để migration dùng kết nối trực tiếp khi runtime dùng pooler. Nếu có nhiều nguồn cấu hình, chỉ sửa `DB_PASS` sẽ không đổi credential trong URL đã khai báo. Kiểm tra host/port/database/user với DBeaver; không in password để so sánh.

Compose hiện cấp các biến rời cho backend với `DB_HOST=db`, `DB_PORT=5432`; hai URL được để trống có chủ đích trong container. `DB_PASS` là bắt buộc và cũng dùng để khởi tạo PostgreSQL. `DB_PUBLISHED_PORT` mặc định 15432 là cổng DB trên host; không thay cổng nội bộ container.

Thay `DB_PASS` không tự đổi password của user PostgreSQL trong volume đã khởi tạo. Phải đồng bộ credential với DB hiện hữu bằng quy trình quản trị phù hợp; không xóa volume để sửa lỗi đăng nhập.

## DB pool — Phase 7

| Biến | Mặc định | Ý nghĩa |
|---|---:|---|
| `DB_POOL_MAX` | 10 | Tối đa connection/process, số nguyên 1–1000; phải tính tổng API/worker/rollout theo PostgreSQL thực tế |
| `DB_POOL_IDLE_TIMEOUT` | 30000 | Milliseconds, 1–600000; thu hồi connection nhàn rỗi |
| `DB_POOL_CONNECTION_TIMEOUT` | 2000 | Milliseconds, 100–60000; timeout tạo/checkout connection |

API dùng PrismaService với pool riêng; không còn worker process. Pool timeout không giới hạn thời gian thực thi SQL. Công thức ngân sách connection, số đo hai API + worker và rollout index: [Database performance](database-performance.md).

## JWT

| Biến | Giá trị |
|---|---|
| `JWT_ACCESS_SECRET` | Bắt buộc, secret riêng cho access token |
| `JWT_REFRESH_SECRET` | Bắt buộc, khác access secret |
| `JWT_ACCESS_EXPIRES_IN` | `15m` |
| `JWT_REFRESH_EXPIRES_IN` | `7d` |
| `DUMMY_PASSWORD_HASH` | Tùy chọn, bcrypt hash hợp lệ; bỏ trống dùng hash so sánh giả có sẵn trong code |

Ví dụ sinh secret riêng từng lần: `openssl rand -hex 32`. Không đưa kết quả thật vào tài liệu, log hoặc Git.

## SMTP và seed

SMTP tắt nếu `SMTP_HOST` và `SMTP_FROM` đều trống; muốn bật phải cấu hình cả hai.

| Biến | Mặc định / ý nghĩa |
|---|---|
| `SMTP_HOST`, `SMTP_FROM` | Host gửi và địa chỉ người gửi |
| `SMTP_PORT` | 587 |
| `SMTP_SECURE` | `false`; đặt `true` cho kết nối TLS ngay từ đầu |
| `SMTP_STARTTLS` | `true`; nâng TLS trên kết nối thường nếu server hỗ trợ |
| `SMTP_USER`, `SMTP_PASS` | Credential SMTP nếu server yêu cầu |
| `SMTP_FROM_NAME` | `CSMTS` |
| `SMTP_CLIENT_NAME` | `localhost`, tên dùng trong EHLO |
| `SEED_ACCOUNT_PASSWORD` | Chỉ dùng trong seed tài khoản K25, không phải cấu hình đăng nhập DB hay runtime |

Sau khi sửa env, khởi động lại process/container. Với Compose dùng `docker compose up -d --build` để tái tạo container theo cấu hình mới; `restart` đơn thuần không cập nhật environment của container đã tạo.

Nguồn: [validation](../projects/src/config/env.validation.ts), [app config](../projects/src/config/app.config.ts), [database resolver](../projects/src/config/database-url.helper.ts), [Compose](../projects/docker-compose.yml).

## Cập nhật observability — 20/10/2026

Các biến mới: `METRICS_ENABLED`, `METRICS_TOKEN`, `OTEL_ENABLED`, `OTEL_SERVICE_NAME`, `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`, `OTEL_TRACES_SAMPLER_ARG`, `DB_SLOW_QUERY_MS`. Production phải cấp metrics token riêng hoặc tắt endpoint. Xem bảng mặc định/validation và cách chạy trong runbook. Xem [Observability và runbook](observability.md).

## Runtime sau rollback — 23/10/2026

Không còn yêu cầu `REDIS_*`, `QUEUE_*`, `EMAIL_WORKER_*` hoặc `WORKER_*`. Các biến cũ không kích hoạt Redis/worker.
Email đọc `app.smtp` và gửi trực tiếp; export local dùng `REPORT_EXPORT_DIR` (mặc định `.local/report-exports`) và `REPORT_RETENTION_SECONDS` (mặc định 86400, số nguyên 60–86400).
Pino/metrics/OTel, JWT và ba env DB pool giữ nguyên. Xem [runbook rollback](infrastructure-rollback.md).
