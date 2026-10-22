// Audit actual measurement artifacts and contracts rather than hard-code a synthetic timing result.
const assert = require('node:assert/strict');
const { data, output } = require('./measure.cjs');
const { path } = require('../support.cjs');
const before = require(path.join(output,'before.json')), after = require(path.join(output,'after.json'));
const cluster = require(path.join(output,'pool-cluster.json'));
const experiments = require(path.join(output,'index-experiments.json'));
const migrations = require(path.join(output,'migration-validation.json'));
const chosen=['evaluation_forms_semester_listing_idx','users_created_at_id_idx'];
for(const artifact of [before,after,cluster,migrations,experiments]){assert.equal(artifact.databaseName,data.databaseName);assert.equal(artifact.synthetic,true);}
assert.equal(before.phase,'before');assert.equal(after.phase,'after');
assert.equal(before.cases.length,21);assert.equal(after.cases.length,21);
for(const name of chosen){assert(!before.indexes.some(i=>i.indexname===name));assert(after.indexes.some(i=>i.indexname===name));}
for(const prior of before.cases){
  const current=after.cases.find(c=>c.name===prior.name);assert(current,prior.name);
  assert.equal(prior.resultCount,current.resultCount,`${prior.name}: result count`);
  assert.equal(prior.queryCount,current.queryCount,`${prior.name}: query count`);
  assert.deepEqual(prior.statements.map(s=>s.sql).sort(),current.statements.map(s=>s.sql).sort(),`${prior.name}: captured SQL unchanged`);
  for(const phase of [prior,current])for(const s of phase.statements){
    assert(/^\s*SELECT\b/i.test(s.sql));assert(Number.isFinite(s.executionMs.median));assert(s.plan.Plan['Actual Loops']>=1);assert('Shared Hit Blocks' in s.plan.Plan);
  }
  if(!prior.name.includes('export'))assert(current.serviceMs.p95<300,`${prior.name}: internal read latency target`);
}
for(const name of ['evaluations_semester','students_listing']){
  const a=before.cases.find(c=>c.name===name),b=after.cases.find(c=>c.name===name);
  assert(b.statements[0].executionMs.median<a.statements[0].executionMs.median*.8,`${name}: measured improvement`);
}
assert.equal(experiments.results.length,6);assert.equal(migrations.successful,true);
assert.equal(cluster.groups.steady.errors,0);assert.equal(cluster.groups.burst.errors,0);
assert(cluster.groups.steady.requests>=1800);assert(cluster.groups.steady.achievedRps>=90);assert(cluster.groups.steady.durationMs.p95<300);
assert.equal(cluster.completedExports.length,3);assert(cluster.completedExports.every(j=>j.completed&&j.bytes>0));
assert(cluster.peakApplicationPoolTotal<=23);assert(cluster.peakConnections<cluster.postgres.max-cluster.postgres.reserved-cluster.postgres.role_reserved);
assert(cluster.drained.every(p=>p.total===0&&p.waiting===0));assert(cluster.timeout.recovered);assert(cluster.timeout.elapsedMs>=75&&cluster.timeout.elapsedMs<1000);
assert(cluster.samples.filter(s=>s.phase==='steady').every(s=>s.pools.every(p=>p.waiting===0)));
console.log(`Verified ${before.cases.length} before/after cases, six index experiments, concurrent migrations, two APIs + worker, exports, idle recovery and timeout`);
