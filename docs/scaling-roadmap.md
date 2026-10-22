# Lộ trình tối ưu và mở rộng

Ngày lập: **19/10/2026**. Cơ sở: [kiến trúc](architecture.md), [luồng API](api-critical-flows.md), [baseline](performance-baseline.md), source `4876b15aa63e8b79945aae626bd6fc3b0be53d5b`.

**Hướng đi đề xuất:** giữ modular monolith, hoàn thiện khả năng đo và tính đúng, tối ưu điểm nghẽn đã được chứng minh, sau đó mới tăng replica hoặc tách worker. Chưa có dữ liệu để cam kết số người dùng đồng thời hoặc nhu cầu microservice. Snapshot local có 1 phiếu đánh giá, không đại diện production.

Roadmap là kế hoạch; sau đợt khảo sát đã chuẩn hóa env, bind host, CORS và mức log (xem environment.md và deployment.md). State machine, optimistic concurrency id + version và idempotency cho evaluation command có key đã triển khai; notification chống trùng theo business event, có test PostgreSQL trong schema tạm. Telemetry, readiness và các hạng mục mở rộng khác vẫn chưa triển khai. P0/P1/P2 là thứ tự ưu tiên đề xuất, không phải deadline hay ước lượng nhân lực đã thống nhất.

## Giai đoạn 0 — Có số đo và quy trình đúng (P0)

| Việc làm | Lý do từ source | Điều kiện hoàn tất |
|---|---|---|
| Chuẩn hóa runtime và cấu hình DB | Node local/probe 24, Docker 22; runtime/CLI ưu tiên URL khác nhau | Ghi runtime mục tiêu; xác minh app/CLI trỏ đúng DB; không log credential |
| Instrument request/query/pool | Chưa có telemetry toàn cục | Latency/error theo route template, query/transaction time, pool wait/busy/idle, CPU/RSS/event loop; có request ID |
| Health/readiness riêng | Health hiện trả tĩnh | Liveness không phụ thuộc DB; readiness có kiểm tra DB với timeout; thử DB outage |
| Baseline trên dataset đại diện | Local mới có smoke measurement | Thực hiện ma trận và lưu raw samples như baseline mục 7; xác định tải mục tiêu/SLO |
| Kiểm chứng ghi đồng thời | Đã áp dụng CAS id + version, stale write trả 409 | Đã có test cạnh tranh score/finalize và rollback batch; tiếp tục đo workload hỗn hợp và tải lớn |
| Retry command | Receipt idempotency và unique notification đã có | Client giữ cùng Idempotency-Key khi retry/double-click; theo dõi kích thước bảng receipt, chưa tự xóa TTL |
| Thống nhất finalize đơn và batch | Batch khác nhánh đơn ở khóa và điểm null | Quy tắc được xác nhận; test khóa, null score, duplicate ID, retry; kết quả consistent |
| Kiểm chứng phạm vi dữ liệu và gateway | Evaluation list/detail đã có access policy theo assignment và test; JWT đọc role hiện tại từ DB. Gateway join room còn nhận userId từ client | Đo lại chi phí query principal/scope; tiếp tục bảo vệ gateway, không cho join user khác |

Không tối ưu bằng cách bỏ kiểm tra quyền, bỏ transaction hoặc cache trạng thái mutable trước khi kiểm chứng tính đúng. Bổ sung integration/concurrency test cho những thay đổi hành vi tương ứng.

## Giai đoạn 1 — Tối ưu một instance theo bằng chứng (P1)

| Khi đo thấy | Thay đổi có thể chọn | Kiểm chứng/giới hạn |
|---|---|---|
| Query lọc học kỳ/lớp/khoa chậm | Thu plan; thử index ghép phù hợp where/order; kiểm tra index trùng | So p95, buffers, thời gian ghi và dung lượng index; migration có phương án quay lui |
| Trang sâu/count tốn nhiều chi phí | Cân nhắc cursor pagination hoặc count tùy chọn | Giữ tương thích client và thứ tự ổn định; chưa thay offset nếu chưa thấy vấn đề |
| Detail join phình payload | Thu gọn select, so join/query trên cùng dataset | Đo SQL count, bytes và tổng latency; không đánh đổi thành N+1 |
| Chờ pool cao | Đặt pool max, acquire/connect/query timeout rõ ràng; giảm thời gian giữ connection | Chọn giá trị theo ngân sách DB, không tăng max theo cảm tính |
| Transaction chuyển cấp/finalize tăng theo số phiếu | Conditional update, xử lý tập hợp/chia batch có giới hạn | Giữ tính đúng điểm/rank/audit, thiết kế partial failure và retry rõ ràng |
| Metadata cũ hoặc cache miss đồng thời | Invalidation tại điểm ghi, giới hạn cache, single-flight loader | Đo cache hit và staleness; xác định TTL chấp nhận được |
| Login/import hash làm CPU/worker pool bận | Giới hạn concurrency hash/import, bảo vệ endpoint theo tải | Giữ bcrypt policy; đo p95 login khi import chạy cùng lúc |
| Export dùng nhiều RAM | Hạn chế rows/payload, đọc theo batch, stream nơi phù hợp | PDF hiện stream output nhưng vẫn nạp toàn bộ input; đo peak RSS và thời gian hoàn tất |

Gate: so sánh ít nhất ba lần before/after cùng dataset/runtime, đúng nghiệp vụ và tải mục tiêu đã chốt. Nếu thay đổi không đem lại cải thiện ổn định hoặc làm xấu write latency, quay lại cấu hình/code trước và lưu kết quả.

## Giai đoạn 2 — Đưa công việc dài sang worker khi cần (P1/P2)

Trigger: đo thấy import/email/export kéo dài request, gây timeout hoặc làm xấu latency API tương tác. Source hiện chờ SMTP trong confirm import và render báo cáo trong request.

Thiết kế đề xuất:

1. API xác thực, validate và lưu job bền vững; trả job ID. Worker nhận việc có giới hạn concurrency. Chưa chọn queue vendor trước khi biết vận hành phù hợp.
2. Tách rõ commit tài khoản/enrollment và trạng thái gửi email. Email lỗi có retry/backoff và dead-letter; không chạy lại toàn bộ import chỉ để gửi lại email.
3. Dùng idempotency key/constraint theo nghiệp vụ, theo dõi progress và lỗi từng phần; retry không tạo trùng user, enrollment hoặc notification.
4. Nếu phát sự kiện phụ thuộc DB commit, dùng transactional outbox hoặc cơ chế bền vững tương đương; không giả định queue/Socket.IO bảo đảm exactly once.
5. Export lớn tạo artifact có TTL trong storage và trả đường tải được phân quyền; ghi rõ thời điểm snapshot dữ liệu. Preview import cần state dùng chung và hạn dùng trước khi mở nhiều API replica.

Gate: test worker dừng sau commit/trước ack, SMTP lỗi, retry trùng, job hết hạn và quyền tải file. Queue depth, age của job lâu nhất, retry/failure rate có metrics. Rollback bằng cách ngừng nhận job mới, drain/đối soát job cũ rồi đổi luồng; không bỏ mất job đã nhận.

## Giai đoạn 3 — Chạy nhiều instance (P2, có điều kiện)

Trigger: một instance vẫn bão hòa CPU/event loop hoặc không đáp ứng availability sau tối ưu, trong khi DB còn ngân sách. Không tăng replica chỉ dựa vào health p95.

| Điều kiện trước rollout | Công việc |
|---|---|
| Token revocation dùng chung | Chuyển state thu hồi sang kho bền vững/dùng chung, TTL đúng hạn token; test logout/revoke giữa hai instance và restart |
| Import preview dùng chung | Lưu kế hoạch và quyền sở hữu bên ngoài RAM; confirm có consume nguyên tử; test retry và confirm đồng thời |
| Cache có quy tắc nhất quán | Quyết định TTL/invalidation giữa instance; chấp nhận độ cũ bằng yêu cầu rõ ràng |
| Realtime nhiều node | Auth gateway; adapter pub/sub phù hợp; cấu hình load balancer/sticky session theo transport được hỗ trợ; reconnect đọc bù notification |
| Ngân sách connection | Tính cả API, worker, migration, công cụ quản trị và slot dự phòng |
| Deploy an toàn | Migration chạy một bước có điều phối trước rollout; schema tương thích phiên bản cũ/mới; readiness, drain connection và shutdown hooks được kiểm chứng |
| Hạ tầng vận hành | Load balancer/TLS, logs/metrics tập trung, cảnh báo, backup và thử restore |

Ngân sách cần thỏa:

```text
(API replicas × pool max mỗi replica)
+ (worker replicas × pool max mỗi worker)
+ migration/admin/other clients
+ reserved headroom
≤ connection budget có thể cấp của PostgreSQL
```

DB local hiện `max_connections=100`; không coi cả 100 là ngân sách ứng dụng. Pool mặc định 10 chỉ là hiện trạng package, không phải sizing recommendation. Pooler bên ngoài chỉ được thêm sau khi xác minh tương thích Prisma/pg, transaction và migration.

Gate: chạy ít nhất hai instance, test thu hồi token, preview/confirm qua instance khác, realtime/reconnect, rolling restart và mất một node dưới tải mục tiêu. Canary từng bước; rollback bằng giảm traffic replica mới sau khi drain, giữ shared state tương thích.

## Giai đoạn 4 — Mở rộng database và miền nghiệp vụ (P2, chỉ khi có số đo)

- Tăng tài nguyên DB khi metrics chỉ ra CPU/I/O/memory bão hòa sau tối ưu query; xác minh vacuum, bloat và index trước.
- Cân nhắc materialized view/tổng hợp riêng cho báo cáo nếu aggregate lặp lại chiếm phần lớn tải; xác định độ trễ dữ liệu, lịch refresh và cách đối soát.
- Read replica chỉ phục vụ luồng chấp nhận replication lag. Submit/confirm/finalize và kiểm tra trạng thái sau ghi phải có read-after-write phù hợp.
- Partition hoặc archive theo học kỳ chỉ khi dung lượng, plan hoặc bảo trì chứng minh lợi ích; unique constraint, foreign key và query phải được kiểm tra lại.
- Chỉ tách service khi có nhu cầu triển khai độc lập, ranh giới dữ liệu và ownership rõ ràng. Worker import/export có thể đáp ứng nhu cầu cách ly trước khi cần tách microservice.

Gate: thử nghiệm trên bản sao dữ liệu đại diện, đo latency/throughput/cost và kiểm chứng khôi phục. Không chạy migration phá hủy hay load test ghi trên DB đang dùng để lấy baseline.

## Thứ tự thực hiện gần nhất

- [ ] Xác nhận môi trường triển khai thực, tải giờ cao điểm và SLO với người vận hành.
- [ ] Thêm telemetry và readiness; ghi lại baseline nghiệp vụ trên dataset tổng hợp.
- [ ] Xử lý/test concurrency, quyền detail/gateway, quy tắc batch finalize.
- [ ] Chọn tối đa một bottleneck có bằng chứng, tối ưu và đo lại.
- [ ] Quyết định worker hoặc nhiều replica dựa trên kết quả; hoàn tất điều kiện state/connection trước rollout.

Các tài liệu hiện đã mô tả điểm xuất phát; những checkbox trong roadmap là công việc tương lai, không phải phần đã triển khai.

## Cập nhật observability — 20/10/2026

Instrumentation Phase 2 đã có trong code và qua smoke probe. Trước khi dùng để ra quyết định scale cần chạy stack, xác nhận scrape/ingestion/dashboard, thu traffic đại diện và đặt SLO theo route. Queue hiện chưa tồn tại; metrics queue=none không phải worker đang hoạt động. Xem [Observability và runbook](observability.md).

## Baseline Phase 3 — 21/10/2026

Đã chạy 16 kịch bản k6 với 10.000 sinh viên synthetic / 30.000 phiếu / 300.000 scores trong database riêng. Read/report đạt p95 <300ms ở tải đã đo; PATCH score p95 21,3ms. Login throughput giữ khoảng 73 RPS khi tăng từ 50 lên 200 VUs, trong khi p95 tăng đến 2,66s: ưu tiên profile CPU/bcrypt/libuv trước khi chọn tối ưu. Đây là baseline local 30s/case, chưa phải capacity production. Xem [kết quả và phương pháp](performance-baseline.md).

## Phase 7 — 21/10/2026

Đã có pool env/timeout và ngân sách API + worker, 21 bộ SQL trước/sau, 6 candidate index và hai migration concurrent được kiểm thử trên synthetic clone. Hai API + worker đạt ~100 read RPS, p95 28,2ms, không lỗi và không có sampled waiting ở steady state; burst được drain và idle pool thu hồi hết. Chưa deploy vào APAG hoặc xác nhận capacity production. Trang sâu OFFSET và export full-data là chi phí đã giải thích; ưu tiên đo cursor/parent pagination nếu traffic thực cho thấy cần. Xem [Phase 7](database-performance.md).
