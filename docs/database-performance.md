> **Cập nhật 23/10/2026:** infrastructure Redis/BullMQ đã rollback. Pool/index/query optimizations vẫn giữ; số liệu hai API + worker bên dưới là lịch sử trước rollback, không phải xác nhận runtime hiện tại hỗ trợ nhiều instance. Xem [runtime hiện tại](infrastructure-rollback.md).

# Phase 7 — Database performance engineering

Đo ngày **21/10/2026**, trên PostgreSQL 17.9 local, cùng máy với Node/APIs/worker. Đã có cấu hình pool, 21 bộ truy vấn trước/sau, 6 thử nghiệm index độc lập và bài chạy hai API thật cùng một BullMQ worker. Migration mới chỉ áp dụng vào các DB synthetic; **chưa deploy hai index vào DB APAG**.

Dữ liệu là **synthetic benchmark**, không phải số user thật hoặc capacity production: 10.000 sinh viên, 10.492 users, 400 lớp, 10 khoa, 20 ngành, 30.000 phiếu, 300.000 scores và 10.000 notifications. Nguồn là baseline Phase 3; bản sao đo riêng: `apag_benchmark_dbperf_1792574913179_c7ed`. Không sửa dữ liệu nghiệp vụ APAG hoặc baseline Phase 3.

## Kết quả chính

Service median là wall time của service, gồm Prisma/mapping và các SQL chạy song song. SQL median là thời gian thực thi do PostgreSQL báo trong `EXPLAIN ANALYZE`, chưa tính network/giải mã/mapping. Không cộng hai số này với nhau.

| Luồng | Service median trước → sau, ms | SQL danh sách trước → sau, ms |
|---|---:|---:|
| Phiếu theo học kỳ, trang 1 | 21,873 → 1,432 | 21,832 → 0,450 |
| Phiếu theo học kỳ + submitted | 6,580 → 1,204 | 5,592 → 0,308 |
| Phiếu theo khoa | 2,670 → 0,823 | 2,431 → 0,290 |
| Admin approval | 6,848 → 1,285 | 4,506 → 0,305 |
| Admin staff | 6,851 → 2,932 | 6,356 → 0,305 |
| Admin students, trang 1 | 91,777 → 1,148 | 94,238 → 0,189 |
| Admin students, trang 400 | 99,465 → 72,149 | 109,260 → 75,053 |
| Export toàn bộ 30.000 phiếu | 316,374 → 306,908 | 97,403 → 108,447 |

Số hàng trả về/total và số SQL của từng case giữ nguyên. Chênh lệch nhỏ ở query vốn nhanh hoặc export không được coi là cải thiện/thoái hóa có ý nghĩa từ 15 lần đo. Export vẫn phải đọc, truyền và map toàn bộ 30.000 rows; index phân trang không loại bỏ công việc đó.

Toàn bộ 21 case, p95, SQL/params và kế hoạch nằm trong [summary](../performance/results/apag_benchmark_dbperf_1792574913179_c7ed/database-engineering/summary.md), [before.json](../performance/results/apag_benchmark_dbperf_1792574913179_c7ed/database-engineering/before.json), [after.json](../performance/results/apag_benchmark_dbperf_1792574913179_c7ed/database-engineering/after.json).

## 1. Pool và ngân sách connection

`PrismaService` truyền các option sau cho `pg.Pool`. Cùng provider được dùng trong API và worker, nên mỗi process có pool riêng.

| Env | Mặc định | Validation / ý nghĩa |
|---|---:|---|
| `DB_POOL_MAX` | 10 | Số nguyên 1–1000, tối đa mỗi process; giới hạn hợp lệ này không thay thế việc tính ngân sách PostgreSQL |
| `DB_POOL_IDLE_TIMEOUT` | 30000 | Số nguyên 1–600000, milliseconds; đóng connection nhàn rỗi |
| `DB_POOL_CONNECTION_TIMEOUT` | 2000 | Số nguyên 100–60000, milliseconds; giới hạn thời gian tạo/chờ lấy connection |
| `WORKER_DB_POOL_MAX` | 3 | Override của Compose, được truyền vào worker thành `DB_POOL_MAX`; chạy worker native thì đặt trực tiếp `DB_POOL_MAX=3` |

Env sai làm startup fail, không in giá trị credential. Thay env cần tái tạo process/container. `DB_POOL_IDLE_TIMEOUT` không phải query/statement timeout; query đã có connection vẫn có thể chạy lâu.

Ngân sách cần tính cả quá trình rolling deployment:

```text
API replicas × API DB_POOL_MAX
+ worker replicas × worker DB_POOL_MAX
+ connection của các client/job khác
+ pool của replica cũ/mới cùng tồn tại khi rollout
+ khoảng dự phòng vận hành
<= max_connections - superuser_reserved_connections - reserved_connections
```

DB local đo được `max_connections=100`, superuser reserved=3, role reserved=0. Hai API max=10 và một worker max=3 có trần ứng dụng 23. Ví dụ giữ thêm 6 connection khác, 10 cho một API overlap và 20 dự phòng thì tổng ngân sách 59 ≤97. Đây là ví dụ theo topology đã đo, không phải cấu hình chung cho mọi deployment. Replica count hoặc worker count đổi thì phải tính lại; tăng pool có thể tăng CPU/lock contention thay vì tăng throughput. Không có distributed global pool cap trong ứng dụng.

Metrics đã có và tiếp tục đọc từ pool thực:

- `db_pool_total`, `db_pool_idle`, `db_pool_waiting`, theo `pool` và target `instance`.
- `db_pool_acquire_duration_seconds`: thời gian checkout; dùng p95 để phân biệt thiếu connection với query chậm.
- `db_query_duration_seconds`, `db_slow_queries_total`: chi phí query; log chậm chỉ có operation/timing/context, không có SQL/params.

Dashboard có panel connection theo instance; checkout p95 đã tách theo instance để không che một pool bị nghẽn khi chọn nhiều target. Ví dụ PromQL để điều tra từng process:

```promql
max by (instance, pool) (db_pool_waiting{service="apag-backend"})

db_pool_total{service="apag-backend"} - db_pool_idle{service="apag-backend"}

histogram_quantile(0.95,
  sum by (instance, le) (
    rate(db_pool_acquire_duration_seconds_bucket{service="apag-backend"}[5m])
  )
)
```

Waiting tăng ngắn trong burst có thể là backpressure bình thường. Waiting duy trì, checkout tiến gần timeout hoặc request lỗi cần đối chiếu số connection toàn server, query/lock đang chạy và CPU. Theo dõi PostgreSQL bằng tài khoản giám sát:

```sql
SHOW max_connections;
SHOW superuser_reserved_connections;
SHOW reserved_connections;
SELECT datname, application_name, state, wait_event_type, count(*)
FROM pg_stat_activity
GROUP BY datname, application_name, state, wait_event_type;
```

## 2. Đo SQL thật bằng EXPLAIN

Harness gọi service thực: `EvaluationQueryService`, `AdminStudentsService`, `AdminUsersService`, `ReportsService`, `NotificationsService`; capture SQL từ driver riêng của benchmark. Không bật ghi SQL/params trong log production. Artifact chỉ chứa SQL/param synthetic.

Case `reports_export_all` gọi `getExportRows({}, 50000)` trên fixture 30.000 phiếu; cap không cắt rows. Worker runtime không truyền cap này; bài cluster bên dưới chạy worker/export thật.

Các nhóm đã đo:

- Evaluation listing: semester, status, class+status, faculty, keyword hit/miss, trang đầu và trang 400.
- Admin approval, approval search theo mã sinh viên, staff listing và student listing.
- Student search có/không kết quả, gồm điều kiện OR username/email/fullName/phone/studentCode.
- Reports overview, training results, by class, by faculty và export tất cả 30.000 phiếu.
- Notification list + count và unread count. Reminder tự sinh được bỏ qua để bài đo giữ semantics chỉ đọc; không dùng nó để đo thời gian tạo reminder.

Mỗi phase: 3 lần warm-up/service, 15 lần đo wall time/service, sau đó 15 lần `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)`/SQL đã capture. Bao gồm `count`, batch quan hệ và aggregate. Pool của harness SQL cố định max=5 ở cả hai phase; bài multi-instance bên dưới dùng cấu hình runtime thật. Lookup học kỳ đã warm cache. Mỗi candidate index được tạo trong transaction, EXPLAIN bằng **cùng connection**, rồi ROLLBACK trước candidate tiếp theo.

Đây là warm-cache microbenchmark, không đo cold disk, không chứng minh p99/SLO từ 15 sample. Không sửa `enable_seqscan`, `work_mem` hoặc thống kê để ép planner chọn index; `work_mem` vẫn 4MB. Thống kê kế thừa từ DB synthetic đã ANALYZE; cả hai phase dùng cùng dữ liệu. Query dịch vụ không đổi giữa trước/sau.

## 3. Hai index được chọn từ số đo

### `evaluation_forms_semester_listing_idx`

```sql
CREATE INDEX CONCURRENTLY evaluation_forms_semester_listing_idx
ON evaluation_forms (semester_id, submitted_at DESC, created_at DESC);
```

Trước: đọc 10.000 phiếu, join user 10.000 lần và dựng JSON quan hệ rồi sort/lấy 20 dòng. Sau: index scan đúng timeline, chỉ đọc/join 20 phiếu ở trang đầu. Shared hit blocks của plan mẫu giảm **32.851 →164**. Index khoảng **232 KiB** trên dataset này. Giữ index `(semester_id,status)` hiện có để phục vụ count/aggregate; không thêm `(semester_id,status,class_id)` vì case class+status vốn khoảng 0,040 ms, còn index này không giải quyết sort/join toàn học kỳ.

### `users_created_at_id_idx`

```sql
CREATE INDEX CONCURRENTLY users_created_at_id_idx
ON users (created_at DESC, id DESC);
```

Thứ tự khớp phân trang user đang dùng. Trước: dựng quan hệ lớp/ngành/khoa cho 10.000 sinh viên; sau: 20 sinh viên. Shared hit blocks giảm **80.282 →182**, index khoảng **432 KiB**. Hai candidate bắt đầu bằng `role,deleted_at` hoặc `deleted_at` không bỏ được outer sort trong SQL thực tế ở bài đo; không chọn dù nhìn cấu trúc có vẻ hợp lý.

Tổng hai index mới khoảng **664 KiB** trong fixture. Dữ liệu synthetic có nhiều timestamp trùng; dung lượng này không phải dự báo storage production. Thêm index tốn storage và chi phí maintain khi insert/update/delete, nhất là cập nhật `submitted_at`; chưa đo throughput ghi trước/sau trong Phase 7. Không suy rộng cải thiện read thành cải thiện write.

Chi tiết 6 candidate và plan: [index-experiments.json](../performance/results/apag_benchmark_dbperf_1792574913179_c7ed/database-engineering/index-experiments.json).

## 4. Vì sao chưa thêm pg_trgm hoặc index notification

Substring search hiện có query khoảng 5–6 ms trên ~10.000 users/enrollments; bài HTTP hỗn hợp vẫn đạt p95 28,2 ms ở 100 RPS. Chưa chứng minh ILIKE là bottleneck cần đánh đổi storage/write cost của GIN. Không bật extension hoặc thêm Elasticsearch.

Nếu search trở thành bottleneck trên dữ liệu/tải đại diện, capture và đo lại **cả OR nhiều field và quan hệ studentCode**, thử `pg_trgm`/GIN từng cột liên quan rồi giữ phương án có lợi cho workload. Keyword quá ngắn có ít trigram hữu ích; chỉ thêm index một field không đảm bảo toàn bộ OR query được cải thiện.

Notification fixture có một bản ghi/sinh viên. Index `user_id` hiện tại cho list/unread query khoảng **0,003/0,002 ms**; thử `(user_id,is_read)` không tạo cải thiện có ý nghĩa. Không thêm index. Cần thêm cohort có lịch sử notification dài và phân bố read/unread đại diện trước khi quyết định cho workload đó.

## 5. Kiểm chứng hai API + một worker

Chạy production build, port loopback ngẫu nhiên, DB clone, JWT/key queue ngẫu nhiên dùng chung giữa các instance, Redis namespace riêng, SMTP tắt, shared export directory tạm. Có warm-up trước tải; OTel tắt, metrics bật, log warn. Không dừng hoặc tái dùng API đang chạy tại 5050.

| Bài đo | Kết quả |
|---|---|
| 20s, open arrival ~100 read RPS | 2.000 requests; 99,99 RPS; median 7,81 ms; p95 28,17 ms; 0 lỗi |
| Burst đồng thời 40 request/API | 80 requests; p95 87,81 ms; 0 lỗi |
| Worker chạy song song | 3 XLSX export, mỗi file từ 30.000 phiếu, đều completed |
| Peak connection ứng dụng quan sát | 21, không vượt trần tổng 23 |
| Peak connection toàn PostgreSQL quan sát | 27/100; còn headroom so với 97 connection thông thường |
| Waiting quan sát ở steady | 0; burst có đỉnh mẫu 10, sau đó về 0 |
| Idle recovery | Sau 31,5s không có traffic DB, cả ba pool total/idle/waiting về 0 |
| Cố ý chiếm hết pool riêng max=1 | Timeout thử nghiệm 100ms xảy ra sau 101,97ms; nhả connection rồi checkout lại thành công |

Scrape/quan sát khoảng 100ms, nên peak là **peak quan sát**, không bảo đảm bắt mọi spike. HTTP test dùng admin synthetic đã ký JWT, vẫn qua guard/Redis revocation/DB authorization; không đo bcrypt/login throughput. Không có sustained connection pressure ở tải/topology này. Không thể kết luận mọi số lượng replica hoặc tải production đều an toàn.

[Pool/HTTP/resource artifacts](../performance/results/apag_benchmark_dbperf_1792574913179_c7ed/database-engineering/pool-cluster.json), [migration validation](../performance/results/apag_benchmark_dbperf_1792574913179_c7ed/database-engineering/migration-validation.json).

## 6. Phần còn lại đã giải thích được

- **Trang sâu:** trang 400 với limit=20 phải bỏ qua 7.980 dòng. Plan sau tối ưu vẫn join 8.000 sinh viên, SQL khoảng 75 ms; index không làm OFFSET thành O(1). Nếu deep-page traffic quan trọng, bước tiếp theo là cursor pagination hoặc giới hạn parent rows trước lateral JSON join, kèm kiểm tra contract/thứ tự. Hiện case này vẫn dưới target read 300ms ở microbenchmark; chưa load-test riêng trang sâu.
- **Export toàn bộ:** SQL khoảng 100ms, service ~300ms, sau đó render XLSX tốn CPU/RAM ở worker. Đây là chi phí đọc/serialize 30.000 rows đã thấy trong span/plan, không phải chờ pool. Export lớn vẫn qua queue Phase 6.
- **Search:** scan có giới hạn dữ liệu ~10k và đã đo; cần đo lại nếu dataset/keyword/tần suất đổi. Search hiện chưa dùng index substring.
- **Notifications:** dữ liệu lịch sử ngắn là giới hạn của fixture; chưa tuyên bố cho tài khoản có hàng nghìn thông báo.

## 7. Chạy lại và rollout

Từ `/Users/nguyenson/APAG_BE/projects`:

```bash
# Cần một fixture synthetic từ Phase 3 (nếu chưa có: pnpm perf:seed).
# Không có session đang dùng DB nguồn khi PostgreSQL clone template.
pnpm perf:db:prepare
pnpm perf:db:before
pnpm perf:db:indexes
pnpm perf:db:apply
pnpm perf:db:after
pnpm build
# Redis local cần đang chạy.
pnpm perf:db:pool
pnpm perf:db:report
pnpm perf:db:verify
```

Prepare chỉ clone database có marker/prefix synthetic và host local. Nếu nguồn đã có hai index mới, script bỏ đúng hai index và record migration tương ứng **chỉ trong clone mới**, tạo lại mốc before có thể replay. Không thay DB nguồn. Đã thử clone từ nguồn đã tối ưu và replay cả hai migration thành công: [baseline reset validation](../performance/results/apag_benchmark_dbperf_1792574913179_c7ed/database-engineering/baseline-reset-validation.json).

Private fixture nằm trong `performance/.local/dbperf-fixture.json`, có URL/password, mode 0600 và Git ignore; `DBPERF_FIXTURE` có thể chỉ định manifest riêng. Public artifacts không chứa credential. Script before/indexes từ chối DB đã có index tối ưu để tránh ghi nhầm baseline. Pool runner dừng các child do chính nó tạo, dọn đúng Redis namespace/export directory của bài test; giữ DB synthetic và JSON để điều tra.

Khi rollout DB đích, dùng `pnpm db:deploy` trong cấu hình môi trường đích đã chọn. Hai migration riêng, mỗi file một `CREATE INDEX CONCURRENTLY`, đã được kiểm tra bằng Prisma migrate deploy. Không bọc chúng trong transaction và không gộp hai statement concurrent vào cùng migration. Concurrent build giảm chặn writes nhưng vẫn tiêu thụ CPU/IO và có thể chờ transaction cũ. Nếu build lỗi, kiểm tra `pg_index.indisvalid`/migration state trước khi retry, không đánh dấu success hoặc dùng IF NOT EXISTS để che index invalid.

Phase này chưa deploy migration vào APAG, chưa chạy staging/production hoặc test failover. Kết quả xác nhận đúng code/DDL và tải local đã đo; trước rollout nhiều replica, đối chiếu connection budget với số process thực tế và đo lại traffic đại diện.

## Validation

Đã qua `pnpm typecheck`, `pnpm lint`, `pnpm build`, 317 unit tests/26 suites, 45 integration checks Redis/realtime/BullMQ, verifier của 21 before/after cases và JSON dashboard. Hai migration concurrent đã deploy/replay thành công trên clone. [Tóm tắt kiểm chứng](../performance/results/apag_benchmark_dbperf_1792574913179_c7ed/database-engineering/verification.json).

## Nguồn kỹ thuật

- [node-postgres Pool API](https://node-postgres.com/apis/pool): max, idle timeout và acquisition timeout.
- [node-postgres pool sizing](https://node-postgres.com/guides/pool-sizing): ngân sách qua nhiều instance.
- [PostgreSQL EXPLAIN](https://www.postgresql.org/docs/17/using-explain.html) và [EXPLAIN options](https://www.postgresql.org/docs/17/sql-explain.html): ANALYZE/BUFFERS và chi phí đo.
- [PostgreSQL CREATE INDEX](https://www.postgresql.org/docs/17/sql-createindex.html): concurrent build, transaction và invalid index.
- [PostgreSQL pg_trgm](https://www.postgresql.org/docs/17/pgtrgm.html): ILIKE/GIN và giới hạn pattern.
