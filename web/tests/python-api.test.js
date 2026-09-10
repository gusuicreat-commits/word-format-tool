const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

// Execute the real route handlers and Python processes, without a model request.
const modules = new Map();
function load(file) {
  file = path.resolve(__dirname, "..", file);
  if (modules.has(file)) return modules.get(file).exports;
  const module = { exports: {} };
  modules.set(file, module);
  const compiled = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { esModuleInterop: true, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const localRequire = (id) => id.startsWith(".")
    ? load(path.resolve(path.dirname(file), `${id}.ts`)) : require(id);
  new Function("require", "module", "exports", compiled)(localRequire, module, module.exports);
  return module.exports;
}

async function main() {
  process.chdir(path.resolve(__dirname, ".."));
  process.env.ENABLE_KIMI_MOCK = "false";
  delete process.env.PYTHON_TIMEOUT_MS;
  const python = load("lib/python.ts");
  const baseUrl = process.env.TEST_API_BASE_URL;
  const dispatch = async (request) => fetch(new URL(new URL(request.url).pathname, baseUrl), {
    method: request.method, headers: request.headers,
    body: request.method === "GET" ? undefined : await request.arrayBuffer(),
  });
  const cookie = 'word_session=' + require('node:crypto').randomBytes(32).toString('hex');
  const wrap = (handler) => async (request, ...args) => {
    request.headers.set('cookie', cookie);
    // Rate limiting has separate task/security coverage; isolate API behavior tests.
    if (!baseUrl && globalThis.wordLimit) globalThis.wordLimit.buckets.clear();
    return handler(request, ...args);
  };
  const format = { POST: wrap(baseUrl ? dispatch : load("app/api/format/route.ts").POST) };
  const parse = { POST: wrap(baseUrl ? dispatch : load("app/api/parse-requirements/route.ts").POST) };
  const download = { GET: wrap(baseUrl ? dispatch : load("app/api/download/[jobId]/route.ts").GET) };
  const command = python.getPythonCommand();
  const run = (args) => python.runPythonWithFallback(command, args);
  fs.mkdirSync("tmp", { recursive: true });
  const scratch = fs.mkdtempSync(path.resolve("tmp", "python-api-test-"));
  const fixture = path.join(scratch, "input.docx");
  const setup = await run(["-c", "from docx import Document; import sys; d=Document(); d.add_paragraph('Test paper'); d.add_paragraph('Body content 123.'); d.save(sys.argv[1])", fixture]);
  assert.equal(setup.code, 0, setup.stderr);

  const parseRequest = (text) => new Request("http://localhost/api/parse-requirements", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ requirementsText: text, template: "default", forceMode: "local" }),
  });
  const separated = "正文宋体\n一级标题黑体";
  const firstParse = await parse.POST(parseRequest(separated));
  assert.equal(firstParse.status, 200);
  const repeatParse = await parse.POST(parseRequest(separated));
  assert.equal((await repeatParse.json()).cached, true);
  const joinedParse = await parse.POST(parseRequest(separated.replace("\n", " ")));
  assert.equal((await joinedParse.json()).cached, false);
  const coverageParse = await parse.POST(parseRequest("正文宋体12磅，段前6磅，固定值20磅行距。"));
  const coverageBody = await coverageParse.json();
  assert.equal(coverageParse.status, 200, JSON.stringify(coverageBody));
  assert.equal(coverageBody.normalizedOverride.styles.body.size_pt, 12);
  assert.equal(coverageBody.normalizedOverride.styles.body.space_before_pt, 6);
  assert.ok(coverageBody.warnings.some(item => item.includes("固定值20磅")));
  const formatRequest = (override, bytes = fs.readFileSync(fixture)) => {
    const form = new FormData();
    form.set("file", new File([bytes], "paper.docx"));
    form.set("template", "default");
    if (override !== undefined) form.set("overrideText", override);
    return new Request("http://localhost/api/format", { method: "POST", body: form });
  };

  for (const override of [undefined, "parsed"]) {
    let rules;
    if (override) {
      const response = await parse.POST(parseRequest("正文宋体五号，2倍行距，首行缩进2字符。"));
      assert.equal(response.status, 200);
      const parsed = await response.json();
      assert.equal(parsed.mode, "local");
      assert.equal(parsed.normalizedOverride.styles.body.size_pt, 10.5);
      rules = JSON.stringify(parsed.normalizedOverride);
    }
    const response = await format.POST(formatRequest(rules));
    const body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body));
    assert.equal(body.report.override.enabled, Boolean(override));
    assert.equal(body.report.verification.layout, "not_performed");
    if (!baseUrl) {
      const { validFormatReport } = load("lib/report-validation.ts");
      const raw = JSON.parse(fs.readFileSync(path.join("tmp", "jobs", body.jobId, "report.json"), "utf8"));
      assert.equal(validFormatReport(raw), true);
      for (const field of ["warnings", "stats", "module_status", "verification", "paragraphs", "tables"]) {
        const invalid = structuredClone(raw);
        delete invalid[field];
        assert.equal(validFormatReport(invalid), false, field);
      }
      assert.equal(validFormatReport({}), false);
      assert.equal(validFormatReport({ ...raw, report_schema_version: 99 }), false);
      assert.equal(validFormatReport({ ...raw, stats: { body: -1 } }), false);
    }
    assert.ok(body.report.warnings.some(item => item.paragraph_index === null && item.message.includes("一级章节标题")));
    const downloaded = await download.GET(new Request(`http://localhost${body.downloadUrl}`), {
      params: Promise.resolve({ jobId: body.jobId }),
    });
    assert.equal(downloaded.status, 200);
    const output = path.join(scratch, "download.docx");
    fs.writeFileSync(output, Buffer.from(await downloaded.arrayBuffer()));
    const check = await run(["-c", "from docx import Document; import sys; d=Document(sys.argv[1]); assert [p.text for p in d.paragraphs] == ['Test paper', 'Body content 123.']; p=d.paragraphs[1]; assert p.runs[0].font.size.pt == float(sys.argv[2]); assert p.paragraph_format.line_spacing == float(sys.argv[3])", output, override ? "10.5" : "12", override ? "2" : "1.5"]);
    assert.equal(check.code, 0, check.stderr);
  }

  const reviewRequest = (action, plan, override) => {
    const form = new FormData();
    form.set("file", new File([fs.readFileSync(fixture)], "paper.docx"));
    form.set("template", "default");
    if (action) form.set("action", action);
    if (plan) form.set("reviewPlan", JSON.stringify(plan));
    if (override) form.set("overrideText", JSON.stringify(override));
    return new Request("http://localhost/api/format", { method: "POST", body: form });
  };
  const analyzed = await format.POST(reviewRequest("analyze"));
  const analysis = await analyzed.json();
  assert.equal(analyzed.status, 200, JSON.stringify(analysis));
  assert.equal(analysis.review.items.length, 2);
  assert.equal(analysis.downloadUrl, undefined);
  analysis.review.items[1].type = "heading_3";
  const reviewed = await format.POST(reviewRequest(null, analysis.review));
  const reviewedBody = await reviewed.json();
  assert.equal(reviewed.status, 200, JSON.stringify(reviewedBody));
  assert.equal(reviewedBody.report.stats.heading_3, 1);
  const stale = await format.POST(reviewRequest(null, analysis.review, { styles: { body: { size_pt: 14 } } }));
  assert.equal(stale.status, 400);
  assert.equal((await stale.json()).errorCode, "review_invalid");

  let response = await format.POST(formatRequest("{"));
  assert.equal(response.status, 400);
  assert.equal((await response.json()).errorCode, "invalid_override_json");
  response = await format.POST(formatRequest(undefined, Buffer.from("not a docx")));
  assert.equal(response.status, 500);
  assert.equal((await response.json()).errorCode, "format_docx_failed");
  response = await download.GET(new Request("http://localhost/api/download/missing"), { params: Promise.resolve({ jobId: "missing-test-job" }) });
  assert.equal(response.status, 404);

  if (baseUrl) {
    console.log("HTTP integration passed: parse, default/override formatting, download, document contents/styles, failure responses.");
    return;
  }

  const missing = await python.runPython(path.join(scratch, "missing-python"), []);
  assert.equal(python.classifyPythonFailure(missing), "python_not_found");
  const missingDependency = await python.runPython(setup.command, ["-S", "-c", "import docx"]);
  assert.equal(python.classifyPythonFailure(missingDependency), "python_missing_dependency");
  const ordinaryFailure = await python.runPython(setup.command, ["-c", "raise ValueError('python-docx invalid input')"]);
  assert.equal(python.classifyPythonFailure(ordinaryFailure), "format_docx_failed");
  const fallback = await python.runPythonWithFallback(path.join(scratch, "missing-python"), ["-c", "print('fallback')"]);
  if (fallback.code === 0) {
    process.env.PYTHON_CMD = path.join(scratch, "missing-python");
    response = await parse.POST(parseRequest("正文宋体小四，2倍行距。"));
    assert.equal(response.status, 200, await response.text());
    response = await format.POST(formatRequest());
    assert.equal(response.status, 200, await response.text());
    process.env.PYTHON_CMD = command;
  } else {
    assert.equal(python.classifyPythonFailure(fallback), "python_not_found");
    console.log("Bundled Python unavailable: fallback integration skipped.");
  }

  const originalProfile = process.env.USERPROFILE;
  const originalHome = process.env.HOME;
  process.env.USERPROFILE = scratch;
  process.env.HOME = scratch;
  process.env.PYTHON_CMD = path.join(scratch, "missing-python");
  try {
    response = await parse.POST(parseRequest("正文宋体小四，单倍行距。"));
    assert.equal(response.status, 500);
    assert.equal((await response.json()).errorCode, "python_not_found");
    response = await format.POST(formatRequest());
    assert.equal(response.status, 500);
    assert.equal((await response.json()).errorCode, "python_not_found");
  } finally {
    if (originalProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = originalProfile;
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    process.env.PYTHON_CMD = command;
  }

  const timeout = await python.runPython(setup.command, ["-c", "import os,time; print(os.getpid(), flush=True); time.sleep(30)"], 1000);
  assert.equal(python.classifyPythonFailure(timeout), "python_timeout");
  const pid = Number(timeout.stdout.trim());
  assert.ok(pid > 0);
  assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });

  process.env.PYTHON_TIMEOUT_MS = "1";
  response = await parse.POST(parseRequest("正文宋体五号，1.5倍行距。"));
  assert.equal(response.status, 504);
  assert.equal((await response.json()).errorCode, "python_timeout");
  response = await format.POST(formatRequest());
  assert.equal(response.status, 504);
  assert.equal((await response.json()).errorCode, "python_timeout");
  delete process.env.PYTHON_TIMEOUT_MS;
  response = await format.POST(formatRequest());
  assert.equal(response.status, 200, await response.text());
  console.log("Python runtime and API integration tests passed (default/override/download/content/format/failures/timeout/recovery).");
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
