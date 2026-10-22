# Baseline hiệu năng trước tối ưu

Ngày khảo sát: **19/10/2026**. Snapshot trước đợt chuẩn hóa env/log. Source HEAD: `4876b15aa63e8b79945aae626bd6fc3b0be53d5b`. Mẫu bắt đầu lúc **23:04:33 +07:00** (`2026-10-19T16:04:33.484Z`).

**Kết luận hiện tại:** kết nối PostgreSQL và HTTP health local hoạt động. Dataset hiện quá nhỏ để kết luận khả năng chịu tải, bottleneck nghiệp vụ hoặc số người dùng đồng thời. Chưa có baseline tải cho các API nghiệp vụ. Các mốc latency dưới đây là smoke measurement, không phải SLO hay throughput tối đa.

## 1. Môi trường đã đo

| Thuộc tính | Giá trị quan sát |
|---|---|
| Máy đo | macOS/darwin, arm64, Apple M4, 10 logical CPU, RAM 16 GiB |
| Node chạy probe | v24.20.0 |
| Package đang cài | Nest core 11.2.7; Prisma client/adapter-pg 7.10.1; pg 8.23.1; TypeScript 5.9.3 |
| PostgreSQL | 17.9, database `apag`, kết nối `localhost:5432` |
| Kích thước database | 9.238.195 bytes, khoảng 8,81 MiB theo `pg_database_size` |
| `max_connections` của DB | 100; đây không phải số slot còn trống cho ứng dụng |
| HTTP được đo | `http://127.0.0.1:5050/api/v1/health`, tiến trình đã chạy sẵn |
| Chế độ/backend build thực sự đang phục vụ | Chưa xác minh; Node probe không chứng minh Node của tiến trình phục vụ |
| Tải nền/CPU/RSS tiến trình backend | Chưa đo |

Dockerfile dùng Node 22, khác runtime của probe. Chưa tái lập trong container, qua TLS/proxy hoặc trên hạ tầng production. Source HEAD được ghi nhận để tham chiếu; chưa xác minh tiến trình đang nghe cổng 5050 được khởi động từ đúng HEAD này.

## 2. Quy mô dữ liệu quan sát

COUNT toàn bảng, gồm cả bản ghi xóa mềm nếu có; chỉ lấy các bảng chọn lọc. Các count được đọc cùng transaction `REPEATABLE READ READ ONLY`, không phải toàn bộ thống kê dữ liệu hệ thống.

| Bảng | Số record |
|---|---:|
| users | 6 |
| faculties | 3 |
| majors | 7 |
| classes | 26 |
| class_students | 1 |
| semesters | 2 |
| evaluation_forms | 1 |
| form_criteria_scores | 0 |
| evidences | 10 |
| notifications | 0 |

Phiếu hiện có: **1 draft**; không có phiếu submitted/approved/finalized trong snapshot. Dataset này không đại diện cho report, review, batch finalize hoặc đợt nộp phiếu tập trung. Không chạy seed, import, gửi email hoặc cập nhật trạng thái trong lần đo này.

## 3. Số đo đã thực hiện

| Phép đo | Mẫu | Min | Median | p95 | Max | Mean | Lỗi |
|---|---:|---:|---:|---:|---:|---:|---|
| `SELECT 1`, kết nối pg tái sử dụng | 30 | 0,075 ms | 0,083 ms | 0,105 ms | 0,111 ms | 0,085 ms | 0 |
| HTTP health local, đọc hết body | 20 | 1,475 ms | 1,935 ms | 2,411 ms | 2,455 ms | 1,938 ms | 0/20, đều HTTP 200 |

Thời gian tạo **một** kết nối pg mới: **23,133 ms**; chưa có phân phối cold connect. Không gộp số này với latency truy vấn tái sử dụng kết nối.

Phương pháp:

- Đo từ Node bằng `performance.now()`. Query PostgreSQL trực tiếp qua `pg.Client`, không qua HTTP, Prisma hoặc pool backend.
- Query `SELECT 1` được warm-up 5 lần, sau đó lấy 30 mẫu tuần tự trên cùng connection/transaction chỉ đọc. Có statement timeout 5 giây ở probe; đây không phải cấu hình timeout backend.
- Health warm-up 1 request, sau đó 20 request tuần tự, concurrency 1, dùng `fetch`, đọc hết response body; không kiểm soát chính sách tái sử dụng connection của client.
- p95 theo nearest rank: sort tăng dần, lấy vị trí `ceil(0.95 × n)`. 20/30 mẫu là rất ít; không suy rộng tail latency production.
- Không có load generator song song. Không tính RPS cực đại từ các mẫu tuần tự này. Không đo startup/cold cache của backend.

`health()` trả trạng thái tĩnh, nên p95 health không thể đại diện cho API có DB/auth/bcrypt. Số đo `SELECT 1` cũng không đại diện cho query join, aggregate hoặc transaction nghiệp vụ.

## 4. Mốc cấu hình từ source

| Hạng mục | Hiện trạng cần giữ khi so sánh |
|---|---|
| Pool ứng dụng | `new Pool({ connectionString })`; package hiện cài mặc định max 10, idle timeout 10.000 ms; code chưa đặt connection timeout |
| Danh sách phiếu | Page 1, limit 20, max 100; offset pagination; query list và count chạy song song |
| Metadata/profile | TTL tương ứng 5 phút / 30 giây; cache trong từng tiến trình |
| Batch finalize | 500 ID tối đa ở bulk; finalize-by-filter có thể vượt 500 khi xác nhận |
| Import sinh viên | Preview TTL 10 phút; transaction timeout 60 giây; bcrypt rounds 10; email nhóm 10, nghỉ 1 giây giữa nhóm |
| Export | PDF nạp toàn bộ query result trước khi render; biên bản Excel/Word tạo Buffer |
| Startup tại thời điểm snapshot | Có `DEBUG_STARTUP=true`; sau chuẩn hóa đã bỏ timer này và dùng `LOG_LEVEL` (xem environment.md) |
| Metrics hiện có | Log timing riêng cho import; chưa thấy metrics/tracing HTTP/DB/pool/event loop toàn cục |

Không có cơ sở từ snapshot này để chọn tăng pool, thêm index, thêm Redis hoặc tách service chỉ vì giả định dữ liệu sẽ lớn.

## 5. Cách đo lại tối thiểu

Chạy từ `projects/`, với backend đã chạy. Script này dùng `.env` cùng biến môi trường hiện tại, không in credential, không chạy migration. Đo health và `SELECT 1`; không phải load test nghiệp vụ.

```bash
cd /Users/nguyenson/APAG_BE/projects
node <<'JS'
const fs = require('node:fs');
const { performance } = require('node:perf_hooks');
const { Client } = require('pg');
const env = { ...require('dotenv').parse(fs.readFileSync('.env')), ...process.env };
const url = env.DATABASE_URL || env.DIRECT_URL;
const client = new Client({
  ...(url ? { connectionString: url } : {
    host: env.DB_HOST, port: Number(env.DB_PORT || 5432),
    database: env.DB_NAME, user: env.DB_USER || 'postgres', password: env.DB_PASS,
  }),
  connectionTimeoutMillis: 5000, statement_timeout: 5000,
});
function stats(values) {
  const a = [...values].sort((x, y) => x - y);
  return { n: a.length, minMs: a[0], medianMs: a[Math.ceil(a.length / 2) - 1],
    p95Ms: a[Math.ceil(a.length * .95) - 1], maxMs: a.at(-1),
    meanMs: a.reduce((x, y) => x + y, 0) / a.length };
}
async function sample(fn, warmup, count) {
  for (let i = 0; i < warmup; i++) await fn();
  const times = [];
  for (let i = 0; i < count; i++) {
    const start = performance.now(); await fn(); times.push(performance.now() - start);
  }
  return stats(times);
}
(async () => {
  console.log('sampledAt', new Date().toISOString());
  try {
    const start = performance.now(); await client.connect();
    console.log('connectMs', performance.now() - start);
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    console.log('select1', await sample(() => client.query('SELECT 1'), 5, 30));
    await client.query('ROLLBACK');
    const url = `http://127.0.0.1:${env.BACKEND_PORT || 5050}/api/v1/health`;
    console.log('health', await sample(async () => {
      const response = await fetch(url, { signal: AbortSignal.timeout(3000) });
      await response.text();
      if (response.status !== 200) throw new Error(`HTTP_${response.status}`);
    }, 1, 20));
  } catch (error) {
    console.error('probe_failed', error.code || error.message);
    process.exitCode = 1;
  } finally { await client.end().catch(() => {}); }
})();
JS
```

Đếm quy mô dataset bằng kết nối DBeaver tới cùng DB; ví dụ:

```sql
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT current_database(), current_setting('server_version'),
       current_setting('max_connections'), pg_database_size(current_database());
SELECT count(*) FROM users;
SELECT count(*) FROM class_students;
SELECT status, count(*) FROM evaluation_forms GROUP BY status;
ROLLBACK;
```

## 6. Những chỉ số còn thiếu

| Chỉ số | Trạng thái | Cách bổ sung |
|---|---|---|
| API login/list/detail/submit/review/report p50/p95/p99 | Chưa đo | Ghi latency theo route template và mã lỗi trên môi trường test |
| RPS ổn định, concurrency cực đại, saturation | Chưa đo | Test nhiều bậc tải với cùng dataset và app build |
| SQL theo request, slow query, query plan | Chưa đo | Trace Prisma/pg; đối chiếu `EXPLAIN (ANALYZE, BUFFERS)` cho SELECT trên DB thử nghiệm |
| Pool busy/idle/waiting, checkout wait | Chưa đo | Instrument pool; tách wait time khỏi SQL execution |
| CPU, RSS/heap, event-loop lag, GC | Chưa đo | Theo dõi tiến trình/container cùng cửa sổ test |
| Export rows/bytes, TTFB, peak RSS | Chưa đo | Dataset và kích thước payload cố định, ghi tổng thời gian |
| Import parse/hash/DB/SMTP, error split | Có code log, chưa có mẫu đo | Thu `admin-students-import.timing`; SMTP giả lập |
| Độ trễ notification và mất sự kiện | Chưa đo | Correlation từ DB commit tới client; test reconnect/restart |
| Startup, deploy/restore và failover | Chưa đo | Đo riêng cold start, DB outage và restore rehearsal |

## 7. Kế hoạch baseline nghiệp vụ tiếp theo

Đây là **kịch bản đề xuất**, chưa thực hiện và chưa phải dự báo nhu cầu thực tế.

1. Tạo DB thử nghiệm tách biệt, dữ liệu tổng hợp có phân bố role/lớp/khoa và trạng thái phiếu. Mốc đầu: 1.000 sinh viên × 2 học kỳ; mốc sau 10.000 × 4 học kỳ. Ghi số tiêu chí, minh chứng, notification và phân bố trạng thái; không dùng seed hiện có như phép chứng minh tải.
2. Build cùng runtime production, ghi commit, image/version, CPU/RAM, DB topology, pool config và dataset ID. Warm-up 2 phút, chạy mỗi bậc 5 phút, lặp 3 lần: 1 → 10 → 25 → 50 virtual user. Đây là mức khởi đầu; điều chỉnh theo tải thực tế quan sát.
3. Workload đọc đề xuất: 50% list, 30% detail/summary, 20% báo cáo. Tách login/bcrypt thành scenario riêng; tách write workflow, import và export để quy được nguyên nhân. Mỗi virtual user có tài khoản riêng; write dùng phiếu riêng và reset fixture giữa các run.
4. Đo thêm import 100/500/1.000 dòng với SMTP thử nghiệm; PDF 100/1.000/10.000 rows; bulk finalize 50/250/500 phiếu. Đo một phiên độc lập rồi đo khi chạy cùng workload đọc.
5. Thu p50/p95/p99, throughput, error rate, CPU/RSS, event-loop lag, pool wait, transaction duration và slow query. Dừng tăng tải khi error >1% hoặc p95 gấp đôi bậc trước trong 60 giây; đây là điều kiện bảo vệ test đề xuất, chưa phải SLO production.
6. Lưu raw samples, lỗi, cấu hình, dataset ID và thống kê vào artifact của lần chạy. Chỉ so before/after với cùng scenario; ghi rõ thay đổi cache warm/cold và tác dụng phụ của fixture.

Baseline nghiệp vụ được coi là đầy đủ khi có ít nhất ba lần chạy tái lập cho các luồng trong [api-critical-flows.md](api-critical-flows.md), cùng raw data và kết quả kiểm tra tính đúng. Đề xuất SLO chỉ được chốt sau khi có tải mục tiêu thực tế.

## Nguồn

[PrismaService](../projects/src/database/prisma.service.ts), [health controller](../projects/src/app.controller.ts), [schema](../projects/prisma/schema/schema.prisma), [import service](../projects/src/modules/admin-classes/admin-classes.service.ts), [admin evaluation service](../projects/src/modules/training-evaluations/application/evaluation-finalize.service.ts), [package manifest](../projects/package.json), [Dockerfile](../projects/Dockerfile). Các số đo trong mục 1–3 được thu trực tiếp trên máy local; không lấy từ README hoặc giả định từ source.

Cập nhật 20/10/2026 sau baseline: JWT hiện đọc principal DB mỗi request bảo vệ; evaluation detail còn kiểm tra assignment lớp/khoa. Số đo cũ chưa bao gồm các query authorization mới này; cần đo lại trước khi so sánh tối ưu tiếp.

## Cập nhật observability — 20/10/2026

Đã thêm metric request latency/RPS/error, CPU/RSS/event loop, DB pool/query, Socket.IO và hook queue. Probe readonly xác nhận trace liên kết và phân biệt query trễ/dependency; chưa đo lại tải đại diện hoặc production. Các số baseline phía trên giữ nguyên, không dùng smoke probe làm kết quả tối ưu. Xem [Observability và runbook](observability.md).
