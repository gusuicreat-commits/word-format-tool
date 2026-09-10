import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { POST as parse } from "../app/api/parse-requirements/route";
import { POST as format } from "../app/api/format/route";
import { dataRoot, owner, ttl } from "./session";

type Task = {
  id: string; owner: string; createdAt: number; expiresAt: number;
  status: "queued" | "parsing" | "analyzing" | "review" | "formatting" | "done" | "failed";
  filename: string; requirements: string; phase: "analyze" | "format";
  review?: any; rules?: any; summary?: any[]; warnings?: string[]; result?: any; message?: string;
};
const globalState = globalThis as typeof globalThis & { wordTasks?: { running: Set<string>; busy: boolean; initialized: boolean; initialization?: Promise<void>; mutation?: Promise<unknown>; timer?: ReturnType<typeof setInterval> } };
const state = globalState.wordTasks ||= { running: new Set(), busy: false, initialized: false };
const root = () => path.join(dataRoot(), "tasks");
function directory(id: string) {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error("任务不存在或已过期。");
  return path.join(root(), id);
}
async function write(task: Task) {
  const dest = path.join(directory(task.id), "task.json");
  const temp = `${dest}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(temp, JSON.stringify(task));
  await fs.rename(temp, dest);
}
async function read(id: string): Promise<Task> { return JSON.parse(await fs.readFile(path.join(directory(id), "task.json"), "utf8")); }
async function list(): Promise<Task[]> {
  await fs.mkdir(root(), { recursive: true });
  const tasks: Task[] = [];
  for (const id of await fs.readdir(root())) { try { tasks.push(await read(id)); } catch {} }
  return tasks;
}
export async function initialize() {
  if (state.initialization) return state.initialization;
  state.initialization = initializeOnce();
  return state.initialization;
}
async function initializeOnce() {
  state.initialized = true;
  for (const task of await list()) {
    if (["queued", "parsing", "analyzing", "formatting"].includes(task.status) && !state.running.has(task.id)) {
      task.status = "failed"; task.message = "服务重启中断了任务，请重试。"; await write(task);
    }
  }
  await cleanup();
  state.timer = setInterval(() => { void cleanup().catch(() => {}); }, 60000);
  state.timer.unref();
}
export async function cleanup() {
  for (const task of await list()) if (task.expiresAt <= Date.now() && !state.running.has(task.id)) {
    await fs.rm(directory(task.id), { recursive: true, force: true });
  }
  // Confine deletion to UUID job directories, including legacy abandoned jobs.
  const jobs = path.join(dataRoot(), "jobs");
  for (const id of await fs.readdir(jobs).catch(() => [])) {
    if (!/^[a-f0-9-]{36}$/.test(id)) continue;
    const dir = path.join(jobs, id);
    let expiry = (await fs.stat(dir)).mtimeMs + ttl;
    try { expiry = JSON.parse(await fs.readFile(path.join(dir, "access.json"), "utf8")).expiresAt; } catch {}
    if (Number.isFinite(expiry) && expiry <= Date.now()) await fs.rm(dir, { recursive: true, force: true });
  }
}
export async function getTask(request: Request, id: string) {
  const task = await read(id);
  if (task.owner !== owner(request) || task.expiresAt <= Date.now()) throw new Error("任务不存在或已过期。");
  return task;
}
export function publicTask(task: Task) {
  const { owner: _owner, rules: _rules, ...safe } = task;
  return safe;
}
export async function currentTask(request: Request) {
  await initialize();
  return (await list()).filter(t => t.owner === owner(request) && t.expiresAt > Date.now()).sort((a, b) => b.createdAt - a.createdAt)[0];
}
export async function createTask(request: Request, file: File, requirements: string) {
  return mutate(() => createUnlocked(request, file, requirements));
}
async function createUnlocked(request: Request, file: File, requirements: string) {
  await initialize();
  const all = await list();
  const active = all.filter(t => t.expiresAt > Date.now() && ["queued", "parsing", "analyzing", "formatting"].includes(t.status));
  const existing = active.find(t => t.owner === owner(request));
  if (existing) return existing;
  if (active.length >= 8 || all.filter(t => t.owner === owner(request) && t.createdAt > Date.now() - 3600000).length >= 10) throw new Error("任务较多，请稍后再试。");
  const task: Task = { id: crypto.randomUUID(), owner: owner(request)!, createdAt: Date.now(), expiresAt: Date.now() + ttl,
    status: "queued", filename: file.name, requirements, phase: "analyze" };
  await fs.mkdir(directory(task.id), { recursive: true });
  await fs.writeFile(path.join(directory(task.id), "input.docx"), Buffer.from(await file.arrayBuffer()));
  await write(task);
  enqueue(task, request);
  return task;
}
export async function confirmTask(request: Request, id: string, review: unknown) {
  return mutate(() => confirmUnlocked(request, id, review));
}
async function confirmUnlocked(request: Request, id: string, review: unknown) {
  const task = await getTask(request, id);
  if (["queued", "formatting", "done"].includes(task.status)) return task;
  if (task.status !== "review") throw new Error("请先完成分析。");
  await checkCapacity(task);
  // Formatter validates the file/rule fingerprints and every submitted decision.
  task.review = review; task.phase = "format"; task.status = "queued";
  await write(task); enqueue(task, request); return task;
}
export async function retryTask(request: Request, id: string) {
  return mutate(() => retryUnlocked(request, id));
}
async function retryUnlocked(request: Request, id: string) {
  const task = await getTask(request, id);
  if (task.status !== "failed") return task;
  await checkCapacity(task);
  task.phase = "analyze"; task.status = "queued"; task.message = undefined;
  await write(task); enqueue(task, request); return task;
}
export async function deleteTask(request: Request, id: string) {
  return mutate(() => deleteUnlocked(request, id));
}
async function deleteUnlocked(request: Request, id: string) {
  const task = await getTask(request, id);
  if (state.running.has(id)) throw new Error("任务正在处理，请结束后删除。");
  const outputs = path.join(dataRoot(), "jobs");
  for (const jobId of await fs.readdir(outputs).catch(() => [])) {
    if (!/^[a-f0-9-]{36}$/.test(jobId)) continue;
    const dir = path.join(outputs, jobId);
    let access;
    try { access = JSON.parse(await fs.readFile(path.join(dir, "access.json"), "utf8")); }
    catch { continue; }
    if (access.owner === task.owner && access.taskId === id) await fs.rm(dir, { recursive: true, force: true });
  }
  await fs.rm(directory(id), { recursive: true, force: true });
}
async function checkCapacity(task: Task) {
  const active = (await list()).filter(t => t.expiresAt > Date.now() && ["queued", "parsing", "analyzing", "formatting"].includes(t.status));
  if (active.length >= 8 || active.some(t => t.owner === task.owner && t.id !== task.id)) throw new Error("任务较多，请稍后再试。");
}
export async function editTask(request: Request, id: string, requirements: unknown) {
  return mutate(async () => {
    const task = await getTask(request, id);
    if (state.running.has(id) || typeof requirements !== "string" || requirements.length > 5000) throw new Error("无法修改要求。");
    await checkCapacity(task);
    task.requirements = requirements; task.rules = undefined; task.result = undefined;
    task.summary = undefined; task.warnings = undefined; task.review = undefined;
    task.phase = "analyze"; task.status = "queued";
    await write(task); enqueue(task, request); return task;
  });
}
function mutate<T>(action: () => Promise<T>): Promise<T> {
  const next = (state.mutation || Promise.resolve()).then(action, action);
  state.mutation = next.catch(() => {});
  return next;
}
function enqueue(task: Task, request: Request) {
  if (state.running.has(task.id)) return;
  state.running.add(task.id);
  const cookie = request.headers.get("cookie") || "";
  void (async () => {
    try {
      while (state.busy) await new Promise(resolve => setTimeout(resolve, 300));
      state.busy = true;
      const headers = { cookie, "x-word-task": task.id };
      if (task.phase === "analyze" && task.requirements.trim()) {
        task.status = "parsing"; await write(task);
        const response = await parse(new Request("http://internal/api/parse-requirements", { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ requirementsText: task.requirements, template: "default" }) }));
        const data = await response.json();
        if (!response.ok || !data.success) throw new Error(data.message || "要求解析失败。");
        task.rules = data.normalizedOverride || data.override;
        task.summary = data.summary; task.warnings = data.warnings;
      }
      task.status = task.phase === "analyze" ? "analyzing" : "formatting"; await write(task);
      const form = new FormData();
      form.set("file", new File([await fs.readFile(path.join(directory(task.id), "input.docx"))], task.filename));
      form.set("template", "default");
      if (task.rules) form.set("overrideText", JSON.stringify(task.rules));
      if (task.phase === "analyze") form.set("action", "analyze");
      else form.set("reviewPlan", JSON.stringify(task.review));
      const response = await format(new Request("http://internal/api/format", { method: "POST", headers, body: form }));
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.message || "文档处理失败。");
      if (task.phase === "analyze") { task.review = data.review; task.status = "review"; }
      else { task.result = data; task.status = "done"; }
      task.expiresAt = Date.now() + ttl;
      if (task.result?.jobId) {
        await fs.writeFile(path.join(dataRoot(), "jobs", task.result.jobId, "access.json"), JSON.stringify({ owner: task.owner, expiresAt: task.expiresAt, taskId: task.id }));
      }
      await write(task);
    } catch (error) {
      task.status = "failed"; task.message = error instanceof Error ? error.message : "处理失败，请重试。";
      await write(task).catch(() => {});
    } finally { state.busy = false; state.running.delete(task.id); }
  })();
}
