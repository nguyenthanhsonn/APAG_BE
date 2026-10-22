# Baseline hiệu năng trước tối ưu — Phase 3

Ngày đo **09:59:24 21/10/2026 → 10:09:59 21/10/2026 (giờ Việt Nam)**. Run ID: `2026-10-21T025924566Z`. Đây là **synthetic benchmark data**, không phải quy mô user thật của APAG, không phải capacity production hoặc claim CV.

**Kết quả:** 16 kịch bản đã chạy; tất cả threshold được cấu hình đều đạt. 10/10 read/report case có p95 <300ms; PATCH score p95 21.3ms so với target <500ms. Error rate đo theo status + response contract, target <1%; 409 dự kiến trong bài race được tách riêng.

## 1. Dataset và môi trường

| Thuộc tính | Giá trị |
|---|---|
| Máy | darwin 25.6.0 arm64; Apple M4; 10 logical CPU; 16.0 GiB RAM |
| Backend | Node v24.20.0, production build từ dist/main.js, một process, Pino info JSON |
| Versions dependency đã xác minh | @nestjs/core 11.1.27; @prisma/client 7.10.1; @prisma/adapter-pg 7.10.1; pg 8.22.0; bcrypt 6.0.0; pino 10.4.0; @prometheus-io/client 0.16.1 |
| Load generator | k6 v2.3.0 (commit/e088784614, go1.26.8, darwin/arm64); cùng máy với backend và PostgreSQL |
| Database | apag_benchmark_20261021_69a289, database local riêng; 93.3 MiB sau seed; max_connections=100 |
| PostgreSQL | PostgreSQL 17.9 on x86_64-apple-darwin24.6.0, compiled by Apple clang version 17.0.0 (clang-1700.6.3.2), 64-bit |
| Pool / libuv | pg mặc định max 10; UV_THREADPOOL_SIZE=default 4 |
| Tracing / metrics | OTel tắt; metrics bật, scrape mỗi 1s bằng token riêng |
| Source | HEAD 4876b15aa63e8b79945aae626bd6fc3b0be53d5b; worktree có thay đổi chưa commit: true; SHA256 backend src/schema/package/lock: 2f0b2025b45455b0f5d956b657e8e0851b7651d8fe7440927b23b84a82fa314e |
| Background load đầu run | loadavg 2.71 / 2.35 / 2.85; không kiểm soát toàn bộ workload host |

| Dataset | Rows |
|---|---:|
| Students (role student) | 10.000 |
| Users gồm staff synthetic | 10492 |
| Faculties / majors / classes | 10 / 20 / 400 |
| Semesters / forms | 3 / 30000 |
| Criteria scores | 300000 |
| Evidences / notifications | 10002 / 10000 |

Mỗi sinh viên có đúng một lớp và ba phiếu qua ba kỳ; hai kỳ cũ có 20.000 finalized forms. Kỳ active 10.000 forms trải qua toàn bộ trạng thái workflow. Có 400 class leader, 80 advisor, 10 faculty actor và admin/training; assignments dùng đúng role. Seed dùng UUID và tên/email benchmark.invalid giả; image URL không được tải từ mạng. Rubric benchmark có 5 mục, 10 tiêu chí con (300.000 scores), chưa phải toàn bộ rubric production. Mật khẩu synthetic ngẫu nhiên, bcrypt rounds 10, dùng chung hash để seed nhanh; HTTP login vẫn chạy bcrypt thật.

Seed tạo database mới và apply migrations hiện có, gồm constraints Phase 1, rồi ANALYZE. Validation xác nhận không trùng student/semester, không lệch enrollment, finalized score khớp tổng mục, một active semester và 200 draft fixture editable. Không reset hoặc ghi dữ liệu vào DB APAG. Không thay index/query/cache/pool để làm đẹp kết quả benchmark.

## 2. Phương pháp

- Closed model constant-vus, nghỉ 100ms/iteration. Mỗi case warm-up 5s riêng rồi đo 30s; request đang chạy được hoàn tất trong graceful stop. Tải chạy tuần tự trên cùng process, cache và DB buffers đã ấm. Không suy ra RPS tối đa từ kết quả này.
- Login đo 50/100/200 VUs, gồm bcrypt và ghi refresh-token hash. Các API khác login trong setup để lấy token thật; setup không tính vào latency/request count nghiệp vụ.
- List có semester/class/faculty/status/keyword và kết hợp; limit 20, offset trang 1..5. Keyword có 50% hit /50% miss; chưa đo deep offset. Reports tính HK1 2026–2027 (10.000 forms). Export là PDF theo lớp ~25 dòng, chưa phải toàn kỳ/Excel/Word.
- Write: mỗi VU có một student draft riêng, GET version rồi PATCH study-score; bảng latency của write **chỉ lấy PATCH**. RPS write gồm cả GET+PATCH, không phải số mutation/giây.
- Conflict: hai PATCH đồng thời cùng version, bắt buộc một 200 + một 409, version sau đúng trước+1. RPS gồm GET+2 PATCH+GET. 409 này không gộp vào unexpected errors.
- p50/p95/p99 là percentile k6 trên request send/wait/receive; không gồm think time/setup. RPS = request count / cửa sổ request đầu đến cuối (gồm phần completion), không lấy wall-clock build/warm-up/setup.
- Error rate đếm sai HTTP status hoặc response contract. Target nội bộ: read p95 <300ms, PATCH p95 <500ms, unexpected error <1%. Login và export chưa gán latency SLO; “Đạt” của hai nhóm này chỉ xác nhận error/check thresholds.
- CPU/RSS/pool lấy trực tiếp metrics process; connections đếm pg_stat_activity đúng DB, gồm 1 observer. Resource sampling bao quanh setup + execution nên CPU peak của API read/write có thể chứa burst auth setup; không quy tất cả CPU đó cho query endpoint.

## 3. Kết quả latency / throughput

Đơn vị latency: ms. RPS là HTTP requests/s trong workload này.

| Case | VUs | Requests | RPS | p50 | p95 | p99 | Unexpected errors | Threshold |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| login_50 | 50 | 2232 | 73.0 | 579.7 | 608.3 | 612.0 | 0.00% | Đạt |
| login_100 | 100 | 2273 | 72.7 | 1262.3 | 1306.3 | 1361.3 | 0.00% | Đạt |
| login_200 | 200 | 2385 | 72.9 | 2627.5 | 2664.0 | 2676.6 | 0.00% | Đạt |
| evaluations_semester | 50 | 13451 | 448.0 | 1.9 | 34.1 | 59.4 | 0.00% | Đạt |
| evaluations_class | 50 | 14526 | 484.2 | 2.5 | 5.0 | 17.5 | 0.00% | Đạt |
| evaluations_faculty | 50 | 13887 | 463.1 | 4.8 | 19.8 | 45.7 | 0.00% | Đạt |
| evaluations_status | 50 | 11156 | 371.6 | 33.4 | 51.2 | 72.3 | 0.00% | Đạt |
| evaluations_keyword | 50 | 14179 | 473.4 | 2.2 | 16.2 | 38.7 | 0.00% | Đạt |
| evaluations_combined | 50 | 14142 | 472.0 | 4.5 | 10.8 | 43.4 | 0.00% | Đạt |
| write | 50 | 26960 | 898.6 | 3.6 | 21.3 | 58.9 | 0.00% | Đạt |
| conflict | 20 | 21320 | 710.6 | 3.4 | 7.9 | 19.0 | 0.00% | Đạt |
| reports_overview | 20 | 5690 | 189.5 | 4.8 | 10.0 | 17.8 | 0.00% | Đạt |
| reports_training_results | 20 | 5682 | 189.9 | 5.0 | 9.6 | 15.8 | 0.00% | Đạt |
| reports_by_class | 20 | 5547 | 185.1 | 6.8 | 10.6 | 19.6 | 0.00% | Đạt |
| reports_by_faculty | 20 | 5495 | 183.2 | 7.9 | 13.7 | 44.0 | 0.00% | Đạt |
| export | 5 | 1329 | 44.3 | 11.3 | 15.8 | 34.3 | 0.00% | Đạt |

## 4. CPU / RAM / connections

CPU đơn vị core (1 = một core đầy tải), RAM là peak RSS MiB của backend. Pool ghi total max / waiting max; không có nghĩa hai giá trị đạt cùng thời điểm. DB connections gồm observer, không phải toàn bộ connection server dùng cho APAG/ứng dụng khác. Event loop là **max của các mean-delay theo interval 1s**, không phải event loop worst stall.

| Case | CPU mean / peak core | RAM peak MiB | Pool total / waiting max | DB connections max | Loop lag ms | Samples |
|---|---:|---:|---:|---:|---:|---:|
| login_50 | 4.13 / 4.23 | 293.1 | 10 / 0 | 11 | 20.78 | 30 |
| login_100 | 4.05 / 4.25 | 286.9 | 10 / 0 | 11 | 21.03 | 31 |
| login_200 | 4.11 / 4.23 | 286.0 | 10 / 0 | 11 | 20.96 | 32 |
| evaluations_semester | 0.44 / 0.64 | 403.4 | 10 / 27 | 11 | 20.81 | 30 |
| evaluations_class | 0.44 / 0.51 | 407.0 | 10 / 0 | 11 | 21.47 | 30 |
| evaluations_faculty | 0.47 / 0.57 | 389.1 | 10 / 22 | 11 | 23.55 | 30 |
| evaluations_status | 0.48 / 0.53 | 501.5 | 10 / 7 | 11 | 20.35 | 30 |
| evaluations_keyword | 0.47 / 0.54 | 463.0 | 10 / 22 | 11 | 20.88 | 30 |
| evaluations_combined | 0.50 / 0.65 | 466.5 | 10 / 0 | 11 | 20.98 | 30 |
| write | 0.83 / 3.21 | 505.1 | 10 / 10 | 11 | 21.25 | 31 |
| conflict | 0.60 / 1.13 | 500.6 | 10 / 3 | 11 | 20.78 | 30 |
| reports_overview | 0.30 / 0.38 | 362.5 | 10 / 0 | 11 | 21.70 | 30 |
| reports_training_results | 0.29 / 0.37 | 313.8 | 10 / 0 | 11 | 21.05 | 30 |
| reports_by_class | 0.55 / 0.65 | 544.2 | 10 / 0 | 11 | 20.88 | 31 |
| reports_by_faculty | 0.58 / 0.68 | 561.4 | 10 / 0 | 11 | 21.04 | 30 |
| export | 0.36 / 0.41 | 598.2 | 7 / 0 | 8 | 22.98 | 30 |

## 5. Phân tích trước optimization

Login throughput ở 50/100/200 VUs lần lượt 73.0 / 72.7 / 72.9 RPS, p95 608.3 / 1306.3 / 2664.0ms; CPU mean 4.13 / 4.05 / 4.11 cores và pool waiting max 0 / 0 / 0. Nếu throughput không tăng tương ứng VUs trong khi latency tăng, dữ liệu phù hợp với hàng đợi CPU/worker phục vụ bcrypt; cần CPU profiling hoặc benchmark libuv riêng để xác nhận. Chưa có bằng chứng nên tăng DB pool chỉ từ login test.

Read/report đạt target trong 10/10 case tại tải này. Điều đó chưa chứng minh peak đăng nhập/nộp phiếu thật sẽ đạt SLO: closed model có think time, warm cache, dataset rubric rút gọn và không có proxy/TLS. Pool waiting có thể xuất hiện do burst 50 VUs; cần đối chiếu p95 và checkout metrics trước khi đổi pool.

Bài conflict ghi nhận **5330 HTTP 409 dự kiến**, invariant failure rate **0.00%**. Kết quả hỗ trợ CAS không lost update trong workload đã chạy; không thay thế kiểm thử idempotency/state machine xuyên role.

RSS có thể phản ánh heap/GC và high-water mark tích lũy của những case trước vì process không restart. Không dùng peak RSS đơn lẻ để kết luận memory leak. Mọi kết luận CPU/DB là giả thuyết từ số đo local; chưa profile CPU hoặc EXPLAIN query tại phase này.

## 6. Artifacts và tái lập

- [Tổng hợp và cấu hình run](../performance/results/apag_benchmark_20261021_69a289/2026-10-21T025924566Z/results.json), [environment/source fingerprint](../performance/results/apag_benchmark_20261021_69a289/2026-10-21T025924566Z/environment.json), [resource samples](../performance/results/apag_benchmark_20261021_69a289/2026-10-21T025924566Z/resources.json).
- [Build/load-script fingerprints và dependency versions](../performance/results/apag_benchmark_20261021_69a289/2026-10-21T025924566Z/provenance.json) được chụp sau run, trước khi rebuild. Backend local dùng Node v24.20.0; Dockerfile Node 22 chưa được benchmark trong run này.
- K6 summary `*-measured.json` và warm-up `*-warmup.json` nằm cùng thư mục. Private logs và credentials không đưa vào Git.
- [Hướng dẫn chạy và từng kịch bản](../performance/README.md). Chạy seed → validate → run → report để có DB/process riêng và report mới.
- [Smoke baseline lịch sử 19/10/2026](performance-baseline-2026-10-19.md) được giữ nguyên để tham chiếu; không so trực tiếp health smoke với API nghiệp vụ.

## 7. Giới hạn và bước đo tiếp theo

Mỗi case mới một run 30s, chưa có repeatability interval hoặc soak. Load generator, backend, PostgreSQL cùng host; không cô lập CPU/IO và traffic nền. Resource sampling 1s có thể bỏ lỡ spike ngắn. Không measure distributed deployment, cold cache, deep pagination, PDF toàn kỳ, Excel/Word hoặc hỗn hợp role dưới tải.

Trước optimization tiếp theo: giữ dataset/source/config và lặp workload dài hơn, chụp CPU profile cho login, thu pool checkout + query spans cho case chậm, chọn SLO theo route và thiết kế arrival-rate test nếu cần kiểm soát RPS đầu vào. Sau thay đổi đo lại cùng điều kiện, không so số VUs như số người dùng thật.

## Kết quả tối ưu tiếp theo — Phase 7

Giữ nguyên baseline Phase 3 và DB nguồn ở trên. Phase 7 đo SQL thật trên clone riêng, chọn hai index timeline bằng EXPLAIN ANALYZE/BUFFERS và kiểm tra pool với hai API + một worker. Đây là bài đo tiếp theo, không thay thế số liệu trước tối ưu. Xem [database performance report](database-performance.md).
