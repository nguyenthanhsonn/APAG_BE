# Synthetic performance baseline

Bộ dữ liệu và kịch bản này phục vụ benchmark nội bộ. **10.000 sinh viên synthetic không phải 10.000 user thật của APAG.** Không dùng kết quả làm claim CV hoặc capacity production.

## Chạy lại

Yêu cầu: Node và pnpm theo backend, PostgreSQL local có quyền tạo database, k6 CLI. Đã dùng k6 2.3.0 macOS ARM64 (archive chính thức có kiểm SHA256); không thêm k6 vào npm dependencies. Có thể chỉ định binary bằng `K6_BIN`. Tải từ [Grafana k6 releases](https://github.com/grafana/k6/releases) và kiểm checksum tương ứng.

Từ root repository:

```bash
pnpm --dir projects install --frozen-lockfile
node performance/seed.cjs
node performance/validate.cjs
K6_BIN=/path/to/k6 node performance/run.cjs
node performance/validate-results.cjs
node performance/report.cjs
```

Seed đọc credential local từ `projects/.env` nhưng **chỉ CREATE một database mới** có prefix `apag_benchmark_`; không reset/truncate/upsert dữ liệu APAG. Tên đã tồn tại khiến seed dừng. Không hỗ trợ DB host remote. Sau seed, URL/password synthetic và fixture nằm trong `performance/.local/`, file mode 0600 và Git ignore. Không đưa các file đó vào PR/artifact public.

Migrations được áp dụng bằng `prisma migrate deploy` vào DB mới, giữ cả partial/expression unique indexes của Phase 1. Sau seed chạy `ANALYZE` để planner có thống kê. Không thêm index, cache hoặc đổi query ứng dụng trong phase benchmark.

Runner build backend rồi khởi động **process riêng** từ `dist/main.js`, production mode, trên port loopback ngẫu nhiên với URL DB benchmark. JWT secrets riêng, SMTP tắt, tracing tắt vì collector chưa được xác minh; logging Pino info vẫn bật. Không dừng/reuse backend ở 5050. Các script k6 chỉ chấp nhận loopback và marker fixture synthetic; dùng runner để bảo đảm process/DB đúng.

Database được giữ lại để tái lập/điều tra. Không có cleanup tự động hoặc lệnh drop dùng wildcard. Muốn xóa, xác nhận đúng database `apag_benchmark_...` rồi dùng công cụ quản trị; thao tác này không thuộc runner.

## Kịch bản và cách đo

| CASE | VUs mặc định | Workload |
|---|---:|---|
| `login_50`, `login_100`, `login_200` (CASE nội bộ `login`) | 50/100/200 | Login thật, bcrypt rounds 10 + lưu refresh hash, một account synthetic/VU |
| `evaluations_semester` | 50 | List, xoay 3 kỳ và trang 1..5, limit 20 |
| `evaluations_class` | 50 | Semester + class, page 1 |
| `evaluations_faculty` | 50 | Semester + faculty |
| `evaluations_status` | 50 | Kỳ active, luân phiên submitted/finalized |
| `evaluations_keyword` | 50 | Semester + keyword, 50% hit và 50% miss có chủ đích |
| `evaluations_combined` | 50 | Semester + class + faculty + finalized + keyword |
| `write` | 50 | GET version rồi PATCH study-score; mỗi VU sở hữu một draft |
| `conflict` | 20 | GET version, batch hai PATCH cùng version, GET kiểm chứng |
| `reports_overview`, `reports_training_results`, `reports_by_class`, `reports_by_faculty` | 20 | Reports cho HK1 2026–2027, 10.000 forms, 400 classes |
| `export` | 5 | GET PDF theo lớp/học kỳ (~25 dòng), kiểm status/MIME/size |

Executor là **closed constant-vus**, nghỉ 100ms sau mỗi iteration; không phải arrival-rate cố định hoặc phép đo RPS tối đa. 30 giây đo sau warm-up 5 giây ở cùng tải; các case chạy tuần tự trên cùng backend/cache/DB buffers, có nghỉ giữa case. Không reset cache, restart backend hay reset database giữa case. Warm-up có file kết quả riêng và không dùng làm số baseline.

Read/report/write lấy access token bằng login thật trong `setup()`, không đo bcrypt lại trong mỗi iteration. Setup được loại khỏi `api_latency`/`unexpected_errors` và request counter benchmark; resource sampling bao quanh cả setup + execution nên peak CPU có thể chứa burst login setup. Login workload tự đo cả bcrypt. Tài khoản riêng/VU tránh tranh refresh hash giữa VU.

- `api_latency`: k6 request duration gồm send/wait/receive, ms; không bao gồm thời gian think hoặc setup. Write report dùng submetric `kind:write` cho PATCH, không trộn GET version vào percentile ghi.
- RPS: số request benchmark / cửa sổ request đầu đến request cuối (gồm graceful completion). Không dùng tổng wall-clock có build/warm-up/setup. Write RPS gồm GET+PATCH; conflict RPS gồm GET+2 PATCH+GET. Số request/operation cần phân biệt khi so sánh.
- Lỗi: cả HTTP status sai và response contract sai; threshold `unexpected_errors <1%`. Setup auth thất bại khiến run thất bại, không bị coi là request nghiệp vụ thành công.
- Conflict: mỗi cặp phải có đúng một 200 + một 409, version sau bằng trước+1 và response winner đúng version. 409 này có counter riêng; các 409 ở write bình thường vẫn là lỗi. Threshold concurrency invariant failure =0.
- Read API p95 <300ms; PATCH write p95 <500ms. Login/PDF được đo nhưng chưa gán latency SLO. Threshold không đạt vẫn lưu baseline và tiếp tục case kế tiếp, không tối ưu để làm đẹp số.
- CPU/RSS/event loop/pg pool lấy `/metrics` của chính backend mỗi giây. CPU đơn vị core, 1 = một core đầy tải; RAM là RSS bytes. DB total connections lấy `pg_stat_activity` của đúng DB, gồm một connection observer. Process Node và k6/DB cùng host nên có tranh CPU; đây không phải môi trường production biệt lập.

Ví dụ chạy subset/dài hơn:

```bash
K6_BIN=/path/to/k6 BENCH_CASES=login_50,login_100,login_200 DURATION_SECONDS=60 WARMUP_SECONDS=10 node performance/run.cjs
```

`report.cjs` chỉ thay baseline khi đủ ma trận 16 case, mỗi case >=30s; subset vẫn giữ artifacts riêng và không thay báo cáo chuẩn.

`BENCH_SKIP_BUILD=true` chỉ dùng khi chắc chắn dist khớp source. Mặc định luôn build. `BENCH_FIXTURE` cho support scripts có thể trỏ `performance/.local/<databaseName>.json` để dùng lại đúng DB/password của một seed trước; runner tự tạo lại file k6 riêng từ manifest đó.

## Artifacts và giới hạn

`performance/results/<database>/<run>/` chứa environment/source fingerprint, k6 summary từng case, kết quả tổng hợp và resource samples. Private logs (không debug HTTP) bị Git ignore; `.local/latest-result.json` chỉ đến run cuối để tạo report. Export được kiểm tra luồng download PDF; chưa benchmark PDF toàn kỳ/hàng chục nghìn dòng, Excel/Word hoặc upload/import.

Ma trận này chưa thay thế soak test, spike test, cold cache, nhiều replica, TLS/proxy, production hardware hoặc test student→review→finalize xuyên role (đã có regression Phase 1). Mỗi case mới một lần chạy: cần lặp và đo dài hơn trước khi quyết định capacity/SLO.

Tài liệu k6 chính thức: [thresholds](https://grafana.com/docs/k6/latest/using-k6/thresholds/), [batch requests](https://grafana.com/docs/k6/latest/javascript-api/k6-http/batch/), [API workload models](https://grafana.com/docs/k6/latest/testing-guides/api-load-testing/).

Sau Phase 4, backend benchmark cần Redis hoạt động. Runner dùng prefix benchmark riêng; revocation xuyên process được kiểm thử bằng `pnpm --dir projects test:redis`. Chưa chạy lại toàn ma trận để claim số đo sau Redis.

## Phase 7 — Database engineering

Bộ `performance/database/` clone dataset synthetic, capture SQL từ service thực, đo EXPLAIN ANALYZE/BUFFERS trước/sau, thử từng index trong transaction rollback và chạy hai API + worker. Có script `perf:db:*` trong backend. Xem [phương pháp, kết quả, lệnh chạy lại và giới hạn](../docs/database-performance.md). Source DB và số liệu Phase 3 được giữ nguyên; index tuning chỉ thực hiện trên clone.
