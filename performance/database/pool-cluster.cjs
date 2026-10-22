// Starts two real HTTP APIs + a BullMQ report worker against the guarded synthetic clone.
const { spawn } = require('node:child_process');
const { randomBytes, randomUUID } = require('node:crypto');
const { performance } = require('node:perf_hooks');
const net = require('node:net');
const os = require('node:os');
const assert = require('node:assert/strict');
const { fs, path, project, dependency, writeJson } = require('../support.cjs');
const { data, output, percentiles } = require('./measure.cjs');
const { Client } = dependency('pg');
const jwt = dependency('jsonwebtoken');
const { createClient } = dependency('redis');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function port() {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  const result = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return result;
}
function metric(text, name) {
  return text.split('\n').filter(line => line.startsWith(`${name} `) || line.startsWith(`${name}{`)).reduce((sum,line) => sum + Number(line.slice(line.lastIndexOf(' ') + 1)),0);
}
async function main() {
  const accessSecret = randomBytes(32).toString('hex'), refreshSecret = randomBytes(32).toString('hex'), metricsToken = randomBytes(32).toString('hex');
  const queueKey = randomBytes(32).toString('hex');
  const prefix = `dbperf:${randomBytes(8).toString('hex')}:`;
  const reportDirectory = fs.mkdtempSync(path.join(os.tmpdir(),'apag-dbperf-exports-'));
  const client = new Client({ connectionString: data.databaseUrl, connectionTimeoutMillis: 2000, application_name: 'apag-dbperf-cluster-observer' });
  const redisUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
  assert(['localhost','127.0.0.1','[::1]'].includes(new URL(redisUrl).hostname),'local Redis for reproducible benchmark');
  const redis = createClient({url:redisUrl,socket:{connectTimeout:2000,reconnectStrategy:false}});
  redis.on('error',()=>{});
  const processes = [];
  const samples = [], requests = [], exports = [], failures = [];
  let phase = 'startup', token, observing = false, observation;
  const started = performance.now();
  try {
    await redis.connect(); await redis.ping(); await client.connect();
    const admin = (await client.query('SELECT id,username,email,role FROM users WHERE username=$1',[data.admin.username])).rows[0];
    token = jwt.sign({sub:admin.id,username:admin.username,email:admin.email,role:admin.role,jti:randomUUID()},accessSecret,{expiresIn:'1h'});
    for (const name of ['api1','api2','worker']) {
      const assignedPort = await port();
      const log = fs.openSync(path.join(__dirname,`../.local/dbperf-${name}.log`),'w',0o600);
      const child = spawn(process.execPath,[name==='worker'?'dist/workers/main.js':'dist/main.js'],{
        cwd:project,
        env:{...process.env,NODE_ENV:'production',DATABASE_URL:data.databaseUrl,DIRECT_URL:data.databaseUrl,
          DB_POOL_MAX:name==='worker'?'3':'10',DB_POOL_IDLE_TIMEOUT:'30000',DB_POOL_CONNECTION_TIMEOUT:'2000',
          BACKEND_HOST:'127.0.0.1',BACKEND_PORT:String(assignedPort),WORKER_HOST:'127.0.0.1',WORKER_METRICS_PORT:String(assignedPort),
          REDIS_KEY_PREFIX:prefix,REPORT_EXPORT_DIR:reportDirectory,JWT_ACCESS_SECRET:accessSecret,JWT_REFRESH_SECRET:refreshSecret,
          QUEUE_ENCRYPTION_KEY:queueKey,METRICS_ENABLED:'true',METRICS_TOKEN:metricsToken,OTEL_ENABLED:'false',SWAGGER_ENABLED:'false',
          SMTP_HOST:'',SMTP_FROM:'',SMTP_USER:'',SMTP_PASS:'',LOG_LEVEL:'warn'},
        stdio:['ignore',log,log],
      });
      fs.closeSync(log);
      processes.push({name,child,port:assignedPort,base:`http://127.0.0.1:${assignedPort}`});
    }
    for (const instance of processes) {
      let ready = false;
      for (let attempt = 0; attempt < 200; attempt++) {
        if (instance.child.exitCode !== null) throw Error(`${instance.name} exited; inspect private benchmark log`);
        try {
          const response = await fetch(`${instance.base}/metrics`,{headers:{authorization:`Bearer ${metricsToken}`},signal:AbortSignal.timeout(1000)});
          if (response.ok) { await response.text(); ready = true; break; }
        } catch {}
        await pause(100);
      }
      assert(ready,`${instance.name} ready`);
    }
    async function metrics(instance) {
      const response = await fetch(`${instance.base}/metrics`,{headers:{authorization:`Bearer ${metricsToken}`},signal:AbortSignal.timeout(3000)});
      assert.equal(response.status,200,'metrics status');
      const text = await response.text();
      return { name:instance.name,total:metric(text,'db_pool_total'),idle:metric(text,'db_pool_idle'),waiting:metric(text,'db_pool_waiting'),acquireCount:metric(text,'db_pool_acquire_duration_seconds_count'),acquireSeconds:metric(text,'db_pool_acquire_duration_seconds_sum'),rssBytes:metric(text,'process_memory_usage'),acquireBuckets:text.split('\n').filter(line=>line.startsWith('db_pool_acquire_duration_seconds_bucket')) };
    }
    async function observe() {
      while (observing) {
        const pools = await Promise.all(processes.map(metrics));
        const connections = (await client.query("SELECT count(*)::int AS total,count(*) FILTER(WHERE datname=$1)::int AS benchmark, count(*) FILTER(WHERE wait_event_type='Lock')::int AS lock_waiting FROM pg_stat_activity",[data.databaseName])).rows[0];
        samples.push({ elapsedMs:performance.now()-started,phase,pools,connections });
        await pause(100);
      }
    }
    const settings = (await client.query("SELECT current_setting('max_connections')::int AS max,current_setting('superuser_reserved_connections')::int AS reserved,current_setting('reserved_connections')::int AS role_reserved")).rows[0];
    observing = true;
    observation = observe();
    let observationFailure;
    observation.catch(error => {observationFailure=error; observing=false;});
    const term='semester=HK1&academicYear=2026-2027';
    const endpoints = [
      `/training-evaluations?${term}&limit=20`,
      `/training-evaluations?${term}&status=submitted&limit=20`,
      '/admin/students?limit=20',
      '/admin/students?keyword=0001&limit=20',
      '/admin/users?limit=20',
      `/reports/overview?${term}`,
      `/reports/by-class?${term}`,
      '/notifications?limit=20',
    ];
    async function request(instance, route, init={}) {
      const start = performance.now();
      const response = await fetch(`${instance.base}/api/v1${route}`,{...init,headers:{authorization:`Bearer ${token}`,...init.headers},signal:AbortSignal.timeout(12000)});
      const body = await response.json();
      requests.push({phase,instance:instance.name,route:route.split('?')[0],status:response.status,ms:performance.now()-start});
      assert(response.ok,`Unexpected HTTP ${response.status} for ${route}`);
      return body.data;
    }
    phase='warmup';
    for (const instance of processes.slice(0,2)) for (const endpoint of endpoints) await request(instance,endpoint);
    phase='steady';
    const steadyStart=performance.now();
    const outstanding = new Set();
    const exportsTask=(async()=>{
      for(let i=0;i<3;i++){
        const result=await request(processes[0],'/reports/exports',{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':`pool-export-${randomUUID()}`},body:JSON.stringify({format:'xlsx'})});
        assert(result.jobId,'export accepted'); exports.push({jobId:result.jobId});
        await pause(3000);
      }
    })().catch(error=>{failures.push(error);});
    let sequence=0;
    // Open arrival model: 100 read requests/s across two independent API processes.
    while(performance.now()-steadyStart<20000){
      for(const instance of processes.slice(0,2)){
        const promise=request(instance,endpoints[sequence++%endpoints.length]);
        outstanding.add(promise);promise.then(()=>outstanding.delete(promise),error=>{failures.push(error);outstanding.delete(promise);});
      }
      await pause(Math.max(0,steadyStart+sequence/2*20-performance.now()));
    }
    await Promise.all([...outstanding, exportsTask]);
    assert.equal(failures.length,0,failures[0]?.message || 'no HTTP failures');
    const steadyDurationMs=performance.now()-steadyStart;
    phase='burst';
    await Promise.all(processes.slice(0,2).flatMap(instance=>Array.from({length:40},(_,i)=>request(instance,endpoints[i%endpoints.length]))));
    phase='export_completion';
    for(const job of exports){
      for(let attempt=0;attempt<120;attempt++){
        const status=await request(processes[1],`/reports/exports/${job.jobId}`);
        if(status.status==='completed'){job.completed=true;job.bytes=status.bytes;break;}
        assert.notEqual(status.status,'failed','background export');await pause(500);
      }
      assert(job.completed,'export completed within deadline');
    }
    phase='idle_recovery';
    // Keep default 30s idle timeout; scraping metrics must not create a DB connection.
    await pause(31500);
    const drained=await Promise.all(processes.map(metrics));
    assert(drained.every(p=>p.total===0&&p.waiting===0),'idle pools drained');
    observing=false;await observation;
    if(observationFailure) throw observationFailure;
    for(const sample of samples){
      assert(sample.pools.every(p=>p.total<=(p.name==='worker'?3:10)),'configured per-process limits');
      assert(sample.pools.reduce((n,p)=>n+p.total,0)<=23,'aggregate pool budget');
      assert(sample.connections.total<settings.max-settings.reserved-settings.role_reserved,'server has ordinary-client connection headroom');
    }
    // Verify the actual PrismaService passes a finite acquisition timeout to pg, not just env parsing.
    const { ConfigService }=dependency('@nestjs/config');
    const { PrismaService }=require('../../projects/src/database/prisma.service.ts');
    const prisma=new PrismaService(new ConfigService({app:{databaseUrl:data.databaseUrl,connectOnInit:false,databasePool:{max:1,idleTimeoutMillis:1000,connectionTimeoutMillis:100}}}));
    let timeout;
    try{
      const held=await prisma.pool.connect();
      const start=performance.now();
      try{await assert.rejects(prisma.pool.connect(),/timeout/i);timeout={configuredMs:100,elapsedMs:performance.now()-start,recovered:false};}finally{held.release();}
      const recovered=await prisma.pool.connect();recovered.release();timeout.recovered=true;
    }finally{await prisma.onModuleDestroy();require('../../projects/src/observability/metrics.ts').getMetrics().destroy();}
    const groups=Object.fromEntries(['steady','burst'].map(name=>{const selected=requests.filter(r=>r.phase===name&&!r.route.includes('/exports'));return [name,{requests:selected.length,errors:selected.filter(r=>r.status>=400).length,durationMs:percentiles(selected.map(r=>r.ms)),...(name==='steady'?{achievedRps:selected.length/(steadyDurationMs/1000)}:{})}]}));
    const summary={synthetic:true,databaseName:data.databaseName,measuredAt:new Date().toISOString(),topology:'2 actual NestJS APIs + 1 actual BullMQ report worker; loopback, single host',poolConfig:{apiMax:10,workerMax:3,idleTimeoutMs:30000,connectionTimeoutMs:2000,budget:23},postgres:settings,steadySeconds:20,targetReadRps:100,groups,completedExports:exports.map(({completed,bytes})=>({completed,bytes})),peakConnections:Math.max(...samples.map(s=>s.connections.total)),peakApplicationPoolTotal:Math.max(...samples.map(s=>s.pools.reduce((n,p)=>n+p.total,0))),peakPoolWaiting:Math.max(...samples.flatMap(s=>s.pools.map(p=>p.waiting))),drained,timeout,samples,requests};
    writeJson(path.join(output,'pool-cluster.json'),summary);
    console.log(JSON.stringify({event:'pool.cluster_passed',groups,peakConnections:summary.peakConnections,peakApplicationPoolTotal:summary.peakApplicationPoolTotal,peakPoolWaiting:summary.peakPoolWaiting,exports:exports.length,timeout,idleDrained:drained.every(p=>p.total===0)}));
  }finally{
    observing=false;
    if(observation)await observation.catch(()=>{});
    await Promise.all(processes.map(async instance=>{
      if(instance.child.exitCode===null){instance.child.kill('SIGTERM');await Promise.race([new Promise(resolve=>instance.child.once('exit',resolve)),pause(10000)]);if(instance.child.exitCode===null)instance.child.kill('SIGKILL');}
    }));
    if(redis.isReady){
      let cursor='0';do{const [next,keys]=await redis.sendCommand(['SCAN',cursor,'MATCH',`${prefix}*`,'COUNT','200']);cursor=next;if(keys.length)await redis.sendCommand(['UNLINK',...keys]);}while(cursor!=='0');
    }
    if(redis.isOpen)redis.destroy();await client.end().catch(()=>{});
    fs.rmSync(reportDirectory,{recursive:true,force:true});
  }
}
main().catch(error=>{console.error(`Pool cluster test failed (${error.code||error.name}): ${error.message}`);process.exitCode=1;});
