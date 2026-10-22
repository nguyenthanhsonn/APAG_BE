// Executes only SELECTs through actual application services, then explains their captured SQL.
const { performance } = require('node:perf_hooks');
const { AsyncLocalStorage } = require('node:async_hooks');
const { fs, path, dependency, project, writeJson, benchmarkDatabase } = require('../support.cjs');
dependency('tsconfig-paths').register({ baseUrl: project, paths: { 'src/*': ['src/*'] } });
const { Pool, Client } = dependency('pg');
const { PrismaPg } = dependency('@prisma/adapter-pg');
const { PrismaClient } = require('../../projects/src/generated/prisma/client.ts');
const { EvaluationQueryService } = require('../../projects/src/modules/training-evaluations/application/evaluation-query.service.ts');
const { AdminStudentsService } = require('../../projects/src/modules/admin-students/admin-students.service.ts');
const { AdminUsersService } = require('../../projects/src/modules/admin-users/admin-users.service.ts');
const { ReportsService } = require('../../projects/src/modules/reports/reports.service.ts');
const { NotificationsService } = require('../../projects/src/modules/notifications/notifications.service.ts');
const { clearSemesterCache } = require('../../projects/src/modules/training-evaluations/helpers/semester.helper.ts');
const data = JSON.parse(fs.readFileSync(process.env.DBPERF_FIXTURE || path.join(__dirname, '../.local/dbperf-fixture.json')));
const identity = benchmarkDatabase(data.databaseUrl);
if (data.synthetic !== true || identity.pathname.slice(1) !== data.databaseName || !data.databaseName.startsWith('apag_benchmark_dbperf_')) throw Error('A marked database-performance clone is required');
const output = path.join(__dirname, '../results', data.databaseName, 'database-engineering');
const percentiles = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return { min: sorted[0], median: sorted[Math.floor(sorted.length / 2)], p95: sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * .95) - 1)], max: sorted.at(-1) };
};
async function open() {
  const capture = new AsyncLocalStorage();
  const pool = new Pool({ connectionString: data.databaseUrl, max: 5, connectionTimeoutMillis: 2000, application_name: 'apag-dbperf-measure' });
  pool.on('connect', client => {
    const original = client.query;
    client.query = function(...args) {
      const store = capture.getStore(), config = args[0];
      const sql = typeof config === 'string' ? config : config?.text;
      if (store && /^\s*SELECT\b/i.test(sql || '')) {
        const values = typeof config === 'object' ? config.values || [] : Array.isArray(args[1]) ? args[1] : [];
        store.push({ sql, values });
      }
      return Reflect.apply(original, this, args);
    };
  });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  await prisma.$connect();
  const admin = await prisma.user.findUniqueOrThrow({ where: { username: data.admin.username } });
  const student = await prisma.user.findUniqueOrThrow({ where: { username: data.students[0].username } });
  const evals = new EvaluationQueryService(prisma), students = new AdminStudentsService(prisma, null, null, null), staff = new AdminUsersService(prisma, null, null, null);
  const reports = new ReportsService(prisma), notices = new NotificationsService(prisma, null);
  const actor = { ...admin, role: 'admin' };
  const term = { semester: 'HK1', academicYear: '2026-2027' };
  const list = { ...term, page: 1, limit: 20 };
  const cases = {
    evaluations_semester: () => evals.findAll(actor, list),
    evaluations_deep_page: () => evals.findAll(actor, { ...list, page: 400 }),
    evaluations_status: () => evals.findAll(actor, { ...list, status: 'submitted' }),
    evaluations_class_status: () => evals.findAll(actor, { ...list, classId: data.classes[0].id, status: 'finalized' }),
    evaluations_faculty: () => evals.findAll(actor, { ...list, facultyId: data.classes[0].facultyId }),
    evaluations_keyword_hit: () => evals.findAll(actor, { ...list, keyword: '0001' }),
    evaluations_keyword_miss: () => evals.findAll(actor, { ...list, keyword: 'no_such_student' }),
    admin_approval: () => evals.findAdminApprovalList(actor, list),
    admin_approval_search: () => evals.findAdminApprovalList(actor, { ...list, search: 'BENCH0001' }),
    admin_staff_listing: () => staff.findAll({ page: 1, limit: 20 }),
    students_listing: () => students.findAll({ page: 1, limit: 20 }),
    students_deep_page: () => students.findAll({ page: 400, limit: 20 }),
    student_search_hit: () => students.findAll({ page: 1, limit: 20, keyword: '0001' }),
    student_search_miss: () => students.findAll({ page: 1, limit: 20, keyword: 'no_such_student' }),
    reports_overview: () => reports.getOverview(term),
    reports_training_results: () => reports.getTrainingResults(term),
    reports_by_class: () => reports.getByClass(term),
    reports_by_faculty: () => reports.getByFaculty(term),
    // Bound manual SQL replay above the 30k-row fixture; runtime worker exports without this cap.
    reports_export_all: () => reports.getExportRows({}, 50000),
    notifications_listing: () => notices.findMine(student.id, 'admin', { page: 1, limit: 20 }),
    notifications_unread: () => notices.countUnread(student.id, 'admin'),
  };
  return { prisma, pool, capture, cases, close: async () => { await prisma.$disconnect(); await pool.end(); } };
}
async function measure(phase) {
  if (!['before','after'].includes(phase)) throw Error('Phase must be before or after');
  const repetitions = Number(process.env.DBPERF_REPETITIONS || 15);
  if (!Number.isInteger(repetitions) || repetitions < 5 || repetitions > 200) throw Error('DBPERF_REPETITIONS must be 5..200');
  const db = await open();
  const explain = new Client({ connectionString: data.databaseUrl, connectionTimeoutMillis: 2000, statement_timeout: 15000, application_name: 'apag-dbperf-explain' });
  await explain.connect();
  try {
    clearSemesterCache();
    const settings = (await explain.query("SELECT version(),current_setting('max_connections') AS max_connections,current_setting('work_mem') AS work_mem")).rows[0];
    const indexes = (await explain.query("SELECT tablename,indexname,indexdef,pg_relation_size(indexname::regclass) AS bytes FROM pg_indexes WHERE schemaname='public' ORDER BY tablename,indexname")).rows;
    const tuned = ['evaluation_forms_semester_listing_idx','users_created_at_id_idx'];
    if (phase === 'before' && indexes.some(i => tuned.includes(i.indexname))) throw Error('Create a fresh clone before measuring before');
    if (phase === 'after' && !tuned.every(name => indexes.some(i => i.indexname === name))) throw Error('Measured index migrations are missing');
    const results = [];
    for (const [name, work] of Object.entries(db.cases)) {
      for (let i = 0; i < 3; i++) await work();
      const sql = []; await db.capture.run(sql, work);
      const unique = [...new Map(sql.map(query => [JSON.stringify(query), query])).values()];
      const serviceMs = [];
      let result;
      for (let i = 0; i < repetitions; i++) { const start = performance.now(); result = await work(); serviceMs.push(performance.now() - start); }
      const plans = [];
      for (let i = 0; i < unique.length; i++) {
        const query = unique[i]; const samples = []; let document;
        for (let run = 0; run < repetitions; run++) {
          const response = await explain.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${query.sql}`, query.values);
          document = response.rows[0]['QUERY PLAN'][0]; samples.push(document['Execution Time']);
        }
        plans.push({ query: i + 1, sql: query.sql, values: query.values, executionMs: percentiles(samples), samplesMs: samples, plan: document });
      }
      results.push({ name, serviceMs: percentiles(serviceMs), serviceSamplesMs: serviceMs, resultCount: Array.isArray(result) ? result.length : result?.total ?? null, queryCount: sql.length, statements: plans });
      console.log(JSON.stringify({ case: name, serviceMedianMs: results.at(-1).serviceMs.median, slowestQueryMs: Math.max(...plans.map(p => p.executionMs.median)) }));
    }
    const artifact = { synthetic: true, databaseName: data.databaseName, sourceDatabase: data.sourceDatabase, phase, measuredAt: new Date().toISOString(), repetitions, settings, indexes, cases: results };
    writeJson(path.join(output, `${phase}.json`), artifact);
  } finally { await explain.end(); await db.close(); }
}
if (require.main === module) measure(process.argv[2] || 'before').catch(error => { console.error(`Database measurement failed (${error.code || error.name}): ${error.message}`); process.exitCode = 1; });
module.exports = { data, output, percentiles, open, measure };
