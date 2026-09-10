const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const ts = require('typescript');
const cache = new Map();
function load(file) {
  file = path.resolve(__dirname, '..', file);
  if (cache.has(file)) return cache.get(file).exports;
  const mod = { exports: {} }; cache.set(file, mod);
  const compiled = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  new Function('require', 'module', 'exports', compiled)(id => id.startsWith('.') ? load(path.resolve(path.dirname(file), id + '.ts')) : require(id), mod, mod.exports);
  return mod.exports;
}
(async () => {
  const cwd = process.cwd();
  fs.mkdirSync(path.resolve(__dirname, '../tmp'), { recursive: true });
  const temp = fs.mkdtempSync(path.resolve(__dirname, '../tmp/security-'));
  process.chdir(temp);
  try {
    const security = load('lib/session.ts'); const tasks = load('lib/tasks.ts'); const { limited } = load('lib/request-limit.ts');
    const req = new Request('http://localhost/api/tasks', { headers: { cookie: 'word_session=' + 'a'.repeat(64) } });
    assert.equal(security.owner(new Request('http://localhost')), null);
    assert.equal(security.sameOrigin(new Request('http://localhost', { headers: { origin: 'https://evil.invalid' } })), false);
    for (let i = 0; i < 12; i++) assert.equal((await limited(req, async () => new Response('ok'))).status, 200);
    assert.equal((await limited(req, async () => new Response('bad'))).status, 429);
    const id = crypto.randomUUID(); const job = crypto.randomUUID();
    const taskDir = path.join(temp, 'tmp/tasks', id); const jobDir = path.join(temp, 'tmp/jobs', job);
    fs.mkdirSync(taskDir, { recursive: true }); fs.mkdirSync(jobDir, { recursive: true });
    const meta = { id, owner: security.owner(req), createdAt: Date.now(), expiresAt: Date.now() - 1, status: 'done' };
    fs.writeFileSync(path.join(taskDir, 'task.json'), JSON.stringify(meta));
    fs.writeFileSync(path.join(jobDir, 'access.json'), JSON.stringify(meta));
    assert.equal(await security.ownOutput(req, job), false);
    await assert.rejects(() => tasks.getTask(req, id));
    await tasks.cleanup();
    assert.equal(fs.existsSync(taskDir), false); assert.equal(fs.existsSync(jobDir), false);
    const interrupted = crypto.randomUUID(); const dir = path.join(temp, 'tmp/tasks', interrupted);
    fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, 'task.json'), JSON.stringify({ ...meta, id: interrupted, status: 'formatting', expiresAt: Date.now() + 60000 }));
    await tasks.initialize();
    assert.equal((await tasks.getTask(req, interrupted)).status, 'failed');
    const activeId = crypto.randomUUID(); const activeDir = path.join(temp, 'tmp/tasks', activeId);
    fs.mkdirSync(activeDir, { recursive: true });
    fs.writeFileSync(path.join(activeDir, 'task.json'), JSON.stringify({ ...meta, id: activeId, status: 'queued', expiresAt: Date.now() + 60000 }));
    const reused = await tasks.createTask(req, new File(['test'], 'test.docx'), '');
    assert.equal(reused.id, activeId, 'Repeated submission must reuse active task');
    for (let i = 0; i < 7; i++) {
      const queueId = crypto.randomUUID(); const queueDir = path.join(temp, 'tmp/tasks', queueId);
      fs.mkdirSync(queueDir, { recursive: true });
      fs.writeFileSync(path.join(queueDir, 'task.json'), JSON.stringify({ ...meta, id: queueId, owner: 'other-' + i, status: 'queued', expiresAt: Date.now() + 60000 }));
    }
    const other = new Request('http://localhost', { headers: { cookie: 'word_session=' + 'b'.repeat(64) } });
    await assert.rejects(() => tasks.createTask(other, new File(['test'], 'test.docx'), ''), /任务较多/);
    console.log('Session, origin, rate limit, expiry cleanup and restart recovery passed.');
  } finally { process.chdir(cwd); fs.rmSync(temp, { recursive: true, force: true }); }
})().catch(e => { console.error(e); process.exitCode = 1; });
