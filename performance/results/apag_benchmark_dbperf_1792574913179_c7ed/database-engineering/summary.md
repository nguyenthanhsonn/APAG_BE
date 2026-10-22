# Phase 7 — measured database results

Synthetic database: `apag_benchmark_dbperf_1792574913179_c7ed`. Source: `apag_benchmark_20261021_69a289`. PostgreSQL 17.9, local single host. No APAG records changed.

Each phase warms each service 3 times, measures 15 service calls, then executes EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) 15 times per captured SQL statement. SQL median and service wall time are different measurements; count and listing may run concurrently. p95 from 15 repetitions is diagnostic only.

| Case | Service median before → after ms | Service p95 before → after ms | Main SQL median before → after ms | SQL statements | Total/results |
|---|---:|---:|---:|---:|---:|
| evaluations_semester | 21.873 → 1.432 | 25.509 → 1.521 | 21.832 → 0.450 | 2 | 10000 |
| evaluations_deep_page | 35.020 → 15.313 | 42.056 → 20.543 | 35.509 → 16.004 | 2 | 10000 |
| evaluations_status | 6.580 → 1.204 | 7.020 → 1.540 | 5.592 → 0.308 | 2 | 1960 |
| evaluations_class_status | 0.374 → 0.388 | 0.441 → 0.511 | 0.040 → 0.042 | 2 | 2 |
| evaluations_faculty | 2.670 → 0.823 | 2.923 → 0.946 | 2.431 → 0.290 | 2 | 1000 |
| evaluations_keyword_hit | 2.906 → 2.866 | 3.614 → 2.933 | 2.624 → 2.454 | 2 | 11 |
| evaluations_keyword_miss | 4.113 → 3.622 | 4.536 → 4.166 | 2.973 → 2.485 | 2 | 0 |
| admin_approval | 6.848 → 1.285 | 13.317 → 2.449 | 4.506 → 0.305 | 2 | 1470 |
| admin_approval_search | 3.190 → 3.208 | 3.595 → 3.533 | 2.439 → 2.845 | 2 | 0 |
| admin_staff_listing | 6.851 → 2.932 | 7.504 → 3.301 | 6.356 → 0.305 | 2 | 492 |
| students_listing | 91.777 → 1.148 | 94.067 → 1.379 | 94.238 → 0.189 | 2 | 10000 |
| students_deep_page | 99.465 → 72.149 | 119.194 → 74.746 | 109.260 → 75.053 | 2 | 10000 |
| student_search_hit | 7.130 → 7.071 | 7.446 → 7.868 | 5.275 → 5.970 | 2 | 11 |
| student_search_miss | 6.656 → 6.745 | 6.835 → 7.379 | 5.074 → 5.651 | 2 | 0 |
| reports_overview | 0.724 → 0.661 | 1.031 → 0.815 | 0.485 → 0.479 | 2 | aggregate |
| reports_training_results | 0.302 → 0.523 | 0.396 → 0.691 | 0.131 → 0.126 | 2 | aggregate |
| reports_by_class | 2.453 → 2.284 | 5.085 → 11.858 | 0.251 → 0.252 | 3 | 400 |
| reports_by_faculty | 2.594 → 2.671 | 2.927 → 4.201 | 0.238 → 0.266 | 3 | 10 |
| reports_export_all | 316.374 → 306.908 | 386.365 → 345.718 | 97.403 → 108.447 | 1 | 30000 |
| notifications_listing | 0.544 → 0.487 | 0.896 → 1.156 | 0.003 → 0.003 | 2 | 1 |
| notifications_unread | 0.107 → 0.114 | 0.113 → 0.124 | 0.002 → 0.002 | 1 | aggregate |

## Pool experiment

Two real NestJS API instances (max 10 each) and one BullMQ report worker (max 3); 30s idle timeout, 2s acquisition/connection timeout. 2000 reads at 99.991 RPS, p95 28.171 ms, 0 errors. 80-request burst p95 87.807 ms, 0 errors. Three complete XLSX exports of all 30,000 forms.

Observed peak application connections: 21/23; all-server connections: 27/100. Steady-state sampled waiting: 0; brief burst peak sampled waiting: 10, then drained. After 31.5 idle seconds every pool returned to zero. Forced pool saturation at max=1 timed out in 101.972 ms against an explicit test timeout of 100ms, then recovered.

## Remaining measured work

- Student page 400 still performs joins for skipped rows (OFFSET 7,980). Its plan explains the residual cost; cursor pagination / limiting the parent relation before JSON joins is the next candidate if deep-page traffic becomes important.
- Substring search scans ~10k users plus enrollment matches; ~5–6 ms per statement, no measured need for pg_trgm/GIN yet.
- All-form export reads and serializes 30k rows (~100 ms SQL; ~300 ms service wall time), then XLSX rendering runs in the separate worker. Listing indexes cannot remove full-export work.
- Notification data has one notification per student. The existing user_id index already resolves it in ~0.003 ms; this does not establish performance for an account with thousands of notices.
- Warm-cache, synthetic data, one host, OTel off. No production capacity claim; test representative staging traffic and replica budgets before rollout.

See before.json / after.json for complete SQL, parameters and plans; index-experiments.json for six independently rolled-back candidates; pool-cluster.json for HTTP/resource samples; migration-validation.json for the tested migration deployment.
