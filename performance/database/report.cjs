const { data, output } = require('./measure.cjs');
const { fs, path, writeJson } = require('../support.cjs');
const { provenance } = require('../provenance.cjs');
const before = require(path.join(output,'before.json')), after = require(path.join(output,'after.json'));
const cluster = require(path.join(output,'pool-cluster.json'));
const rows = before.cases.map(prior => {
  const current = after.cases.find(c=>c.name===prior.name);
  return {name:prior.name,beforeServiceMs:prior.serviceMs.median,afterServiceMs:current.serviceMs.median,beforeP95Ms:prior.serviceMs.p95,afterP95Ms:current.serviceMs.p95,beforeMainSqlMs:prior.statements[0].executionMs.median,afterMainSqlMs:current.statements[0].executionMs.median,resultCount:current.resultCount,sqlCount:current.queryCount};
});
const n=value=>Number(value).toFixed(3);
const document=[
  '# Phase 7 — measured database results',
  '',
  `Synthetic database: \`${data.databaseName}\`. Source: \`${data.sourceDatabase}\`. PostgreSQL 17.9, local single host. No APAG records changed.`,
  '',
  'Each phase warms each service 3 times, measures 15 service calls, then executes EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) 15 times per captured SQL statement. SQL median and service wall time are different measurements; count and listing may run concurrently. p95 from 15 repetitions is diagnostic only.',
  '',
  '| Case | Service median before → after ms | Service p95 before → after ms | Main SQL median before → after ms | SQL statements | Total/results |',
  '|---|---:|---:|---:|---:|---:|',
  ...rows.map(r=>`| ${r.name} | ${n(r.beforeServiceMs)} → ${n(r.afterServiceMs)} | ${n(r.beforeP95Ms)} → ${n(r.afterP95Ms)} | ${n(r.beforeMainSqlMs)} → ${n(r.afterMainSqlMs)} | ${r.sqlCount} | ${r.resultCount??'aggregate'} |`),
  '',
  '## Pool experiment',
  '',
  `Two real NestJS API instances (max 10 each) and one BullMQ report worker (max 3); 30s idle timeout, 2s acquisition/connection timeout. ${cluster.groups.steady.requests} reads at ${n(cluster.groups.steady.achievedRps)} RPS, p95 ${n(cluster.groups.steady.durationMs.p95)} ms, ${cluster.groups.steady.errors} errors. 80-request burst p95 ${n(cluster.groups.burst.durationMs.p95)} ms, ${cluster.groups.burst.errors} errors. Three complete XLSX exports of all 30,000 forms.`,
  '',
  `Observed peak application connections: ${cluster.peakApplicationPoolTotal}/23; all-server connections: ${cluster.peakConnections}/100. Steady-state sampled waiting: 0; brief burst peak sampled waiting: ${cluster.peakPoolWaiting}, then drained. After 31.5 idle seconds every pool returned to zero. Forced pool saturation at max=1 timed out in ${n(cluster.timeout.elapsedMs)} ms against an explicit test timeout of 100ms, then recovered.`,
  '',
  '## Remaining measured work',
  '',
  '- Student page 400 still performs joins for skipped rows (OFFSET 7,980). Its plan explains the residual cost; cursor pagination / limiting the parent relation before JSON joins is the next candidate if deep-page traffic becomes important.',
  '- Substring search scans ~10k users plus enrollment matches; ~5–6 ms per statement, no measured need for pg_trgm/GIN yet.',
  '- All-form export reads and serializes 30k rows (~100 ms SQL; ~300 ms service wall time), then XLSX rendering runs in the separate worker. Listing indexes cannot remove full-export work.',
  '- Notification data has one notification per student. The existing user_id index already resolves it in ~0.003 ms; this does not establish performance for an account with thousands of notices.',
  '- Warm-cache, synthetic data, one host, OTel off. No production capacity claim; test representative staging traffic and replica budgets before rollout.',
  '',
  'See before.json / after.json for complete SQL, parameters and plans; index-experiments.json for six independently rolled-back candidates; pool-cluster.json for HTTP/resource samples; migration-validation.json for the tested migration deployment.',
  '',
];
fs.writeFileSync(path.join(output,'summary.md'),document.join('\n'));
writeJson(path.join(output,'summary.json'),{synthetic:true,databaseName:data.databaseName,rows,pool:{groups:cluster.groups,peakApplicationPoolTotal:cluster.peakApplicationPoolTotal,peakConnections:cluster.peakConnections,timeout:cluster.timeout}});
writeJson(path.join(output,'provenance.json'),{...provenance(),timing:'after measurements; records the compiled backend used by pool experiment',fixtureCountsAtClone:data.counts,benchmarkScripts:fs.readdirSync(__dirname).filter(name=>name.endsWith('.cjs'))});
console.log('Database performance summary and provenance written');
