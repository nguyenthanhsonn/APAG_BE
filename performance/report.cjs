const { fs, path, root, writeJson } = require("./support.cjs");
const output =
  process.argv[2] ||
  JSON.parse(
    fs.readFileSync(path.join(__dirname, ".local/latest-result.json"), "utf8"),
  ).output;
const { metadata, results } = JSON.parse(
  fs.readFileSync(path.join(output, "results.json"), "utf8"),
);
if (
  !metadata.synthetic ||
  !metadata.complete ||
  metadata.settings.durationSeconds < 30
)
  throw Error(
    "A complete measured baseline (>=30s/case) is required; smoke results are not a baseline",
  );
if (
  results.length !== 16 ||
  !["login_50", "login_100", "login_200", "write", "conflict", "export"].every(
    (name) => results.some((r) => r.case === name),
  )
)
  throw Error(
    "Full 16-case matrix required to replace docs/performance-baseline.md; subset artifacts remain available",
  );
const format = (n, d = 1) => Number(n).toFixed(d);
const localDate = (s) =>
  new Date(s).toLocaleString("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    hour12: false,
  });
const link = path
  .relative(path.join(root, "docs"), output)
  .split(path.sep)
  .join("/");
const latencyTable = results
  .map(
    (r) =>
      `| ${r.case} | ${r.vus} | ${r.requests} | ${format(r.rps)} | ${format(r.p50Ms)} | ${format(r.p95Ms)} | ${format(r.p99Ms)} | ${format(r.errorRate * 100, 2)}% | ${r.thresholdsPassed ? "Đạt" : "Không đạt"} |`,
  )
  .join("\n");
const resourceTable = results
  .map(
    (r) =>
      `| ${r.case} | ${format(r.resources.cpuMeanCores, 2)} / ${format(r.resources.cpuMaxCores, 2)} | ${format(r.resources.rssMaxBytes / 1048576)} | ${r.resources.dbPoolTotalMax} / ${r.resources.dbPoolWaitingMax} | ${r.resources.dbConnectionsMax} | ${format(r.resources.eventLoopLagMaxSeconds * 1000, 2)} | ${r.resources.samples} |`,
  )
  .join("\n");
const reads = results.filter(
  (r) => r.case.startsWith("evaluations_") || r.case.startsWith("reports_"),
);
const write = results.find((r) => r.case === "write");
const race = results.find((r) => r.case === "conflict");
const logins = results.filter((r) => r.case.startsWith("login_"));
const failed = results.filter((r) => !r.thresholdsPassed);
const buildEvidence = JSON.parse(
  fs.readFileSync(path.join(output, "provenance.json"), "utf8"),
);
const text = `# Baseline hiệu năng trước tối ưu — Phase 3

Ngày đo **${localDate(metadata.startedAt)} → ${localDate(metadata.finishedAt)} (giờ Việt Nam)**. Run ID: \`${metadata.runId}\`. Đây là **synthetic benchmark data**, không phải quy mô user thật của APAG, không phải capacity production hoặc claim CV.

**Kết quả:** ${results.length} kịch bản đã chạy; ${failed.length ? failed.map((r) => r.case).join(", ") + " chưa đạt threshold" : "tất cả threshold được cấu hình đều đạt"}. ${reads.filter((r) => r.p95Ms < 300).length}/${reads.length} read/report case có p95 <300ms; PATCH score p95 ${format(write.p95Ms)}ms so với target <500ms. Error rate đo theo status + response contract, target <1%; 409 dự kiến trong bài race được tách riêng.

## 1. Dataset và môi trường

| Thuộc tính | Giá trị |
|---|---|
| Máy | ${metadata.platform}; ${metadata.cpu}; ${metadata.logicalCpus} logical CPU; ${format(metadata.memoryBytes / 1073741824)} GiB RAM |
| Backend | Node ${metadata.node}, production build từ dist/main.js, một process, Pino info JSON |
| Versions dependency đã xác minh | ${Object.entries(buildEvidence.dependencies)
  .map(([k, v]) => k + " " + v)
  .join("; ")} |
| Load generator | ${metadata.k6}; cùng máy với backend và PostgreSQL |
| Database | ${metadata.databaseName}, database local riêng; ${format(Number(metadata.postgres.bytes) / 1048576)} MiB sau seed; max_connections=${metadata.postgres.max_connections} |
| PostgreSQL | ${metadata.postgres.postgres} |
| Pool / libuv | pg mặc định max 10; UV_THREADPOOL_SIZE=${metadata.settings.uvThreadpoolSize} |
| Tracing / metrics | OTel tắt; metrics bật, scrape mỗi 1s bằng token riêng |
| Source | HEAD ${metadata.gitHead}; worktree có thay đổi chưa commit: ${metadata.dirtyWorktree}; SHA256 backend src/schema/package/lock: ${metadata.sourceSha256} |
| Background load đầu run | loadavg ${metadata.loadAverageAtStart.map((n) => format(n, 2)).join(" / ")}; không kiểm soát toàn bộ workload host |

| Dataset | Rows |
|---|---:|
| Students (role student) | 10.000 |
| Users gồm staff synthetic | ${metadata.dataset.users} |
| Faculties / majors / classes | ${metadata.dataset.faculties} / ${metadata.dataset.majors} / ${metadata.dataset.classes} |
| Semesters / forms | ${metadata.dataset.semesters} / ${metadata.dataset.evaluation_forms} |
| Criteria scores | ${metadata.dataset.form_criteria_scores} |
| Evidences / notifications | ${metadata.dataset.evidences} / ${metadata.dataset.notifications} |

Mỗi sinh viên có đúng một lớp và ba phiếu qua ba kỳ; hai kỳ cũ có 20.000 finalized forms. Kỳ active 10.000 forms trải qua toàn bộ trạng thái workflow. Có 400 class leader, 80 advisor, 10 faculty actor và admin/training; assignments dùng đúng role. Seed dùng UUID và tên/email benchmark.invalid giả; image URL không được tải từ mạng. Rubric benchmark có 5 mục, 10 tiêu chí con (300.000 scores), chưa phải toàn bộ rubric production. Mật khẩu synthetic ngẫu nhiên, bcrypt rounds 10, dùng chung hash để seed nhanh; HTTP login vẫn chạy bcrypt thật.

Seed tạo database mới và apply migrations hiện có, gồm constraints Phase 1, rồi ANALYZE. Validation xác nhận không trùng student/semester, không lệch enrollment, finalized score khớp tổng mục, một active semester và 200 draft fixture editable. Không reset hoặc ghi dữ liệu vào DB APAG. Không thay index/query/cache/pool để làm đẹp kết quả benchmark.

## 2. Phương pháp

- Closed model constant-vus, nghỉ 100ms/iteration. Mỗi case warm-up ${metadata.settings.warmupSeconds}s riêng rồi đo ${metadata.settings.durationSeconds}s; request đang chạy được hoàn tất trong graceful stop. Tải chạy tuần tự trên cùng process, cache và DB buffers đã ấm. Không suy ra RPS tối đa từ kết quả này.
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
${latencyTable}

## 4. CPU / RAM / connections

CPU đơn vị core (1 = một core đầy tải), RAM là peak RSS MiB của backend. Pool ghi total max / waiting max; không có nghĩa hai giá trị đạt cùng thời điểm. DB connections gồm observer, không phải toàn bộ connection server dùng cho APAG/ứng dụng khác. Event loop là **max của các mean-delay theo interval 1s**, không phải event loop worst stall.

| Case | CPU mean / peak core | RAM peak MiB | Pool total / waiting max | DB connections max | Loop lag ms | Samples |
|---|---:|---:|---:|---:|---:|---:|
${resourceTable}

## 5. Phân tích trước optimization

Login throughput ở 50/100/200 VUs lần lượt ${logins.map((r) => format(r.rps)).join(" / ")} RPS, p95 ${logins.map((r) => format(r.p95Ms)).join(" / ")}ms; CPU mean ${logins.map((r) => format(r.resources.cpuMeanCores, 2)).join(" / ")} cores và pool waiting max ${logins.map((r) => r.resources.dbPoolWaitingMax).join(" / ")}. Nếu throughput không tăng tương ứng VUs trong khi latency tăng, dữ liệu phù hợp với hàng đợi CPU/worker phục vụ bcrypt; cần CPU profiling hoặc benchmark libuv riêng để xác nhận. Chưa có bằng chứng nên tăng DB pool chỉ từ login test.

Read/report đạt target trong ${reads.filter((r) => r.p95Ms < 300).length}/${reads.length} case tại tải này. Điều đó chưa chứng minh peak đăng nhập/nộp phiếu thật sẽ đạt SLO: closed model có think time, warm cache, dataset rubric rút gọn và không có proxy/TLS. Pool waiting có thể xuất hiện do burst 50 VUs; cần đối chiếu p95 và checkout metrics trước khi đổi pool.

Bài conflict ghi nhận **${race.expectedConflicts} HTTP 409 dự kiến**, invariant failure rate **${format(race.concurrencyInvariantFailureRate * 100, 2)}%**. Kết quả hỗ trợ CAS không lost update trong workload đã chạy; không thay thế kiểm thử idempotency/state machine xuyên role.

RSS có thể phản ánh heap/GC và high-water mark tích lũy của những case trước vì process không restart. Không dùng peak RSS đơn lẻ để kết luận memory leak. Mọi kết luận CPU/DB là giả thuyết từ số đo local; chưa profile CPU hoặc EXPLAIN query tại phase này.

## 6. Artifacts và tái lập

- [Tổng hợp và cấu hình run](${link}/results.json), [environment/source fingerprint](${link}/environment.json), [resource samples](${link}/resources.json).
- [Build/load-script fingerprints và dependency versions](${link}/provenance.json) được chụp ${buildEvidence.timing === "before benchmark requests" ? "trước khi gửi tải" : "sau run, trước khi rebuild"}. Backend local dùng Node ${metadata.node}; Dockerfile Node 22 chưa được benchmark trong run này.
- K6 summary \`*-measured.json\` và warm-up \`*-warmup.json\` nằm cùng thư mục. Private logs và credentials không đưa vào Git.
- [Hướng dẫn chạy và từng kịch bản](../performance/README.md). Chạy seed → validate → run → report để có DB/process riêng và report mới.
- [Smoke baseline lịch sử 19/10/2026](performance-baseline-2026-10-19.md) được giữ nguyên để tham chiếu; không so trực tiếp health smoke với API nghiệp vụ.

## 7. Giới hạn và bước đo tiếp theo

Mỗi case mới một run 30s, chưa có repeatability interval hoặc soak. Load generator, backend, PostgreSQL cùng host; không cô lập CPU/IO và traffic nền. Resource sampling 1s có thể bỏ lỡ spike ngắn. Không measure distributed deployment, cold cache, deep pagination, PDF toàn kỳ, Excel/Word hoặc hỗn hợp role dưới tải.

Trước optimization tiếp theo: giữ dataset/source/config và lặp workload dài hơn, chụp CPU profile cho login, thu pool checkout + query spans cho case chậm, chọn SLO theo route và thiết kế arrival-rate test nếu cần kiểm soát RPS đầu vào. Sau thay đổi đo lại cùng điều kiện, không so số VUs như số người dùng thật.
`;
const target = path.join(root, "docs/performance-baseline.md");
const history = path.join(root, "docs/performance-baseline-2026-10-19.md");
if (!fs.existsSync(history)) fs.copyFileSync(target, history);
fs.writeFileSync(target, text);
writeJson(path.join(output, "acceptance.json"), {
  synthetic: true,
  beforeOptimization: true,
  cases: results.length,
  failedThresholds: failed.map((r) => r.case),
  readP95Pass: reads.filter((r) => r.p95Ms < 300).length,
  readCases: reads.length,
  writeP95Ms: write.p95Ms,
  expectedConflicts: race.expectedConflicts,
  concurrencyInvariantFailureRate: race.concurrencyInvariantFailureRate,
});
console.log(
  JSON.stringify({
    event: "benchmark.report_written",
    path: target,
    cases: results.length,
  }),
);
