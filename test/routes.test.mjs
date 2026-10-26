import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import { registerRoutes } from "../src/host/routes.js";

function makeRequest({ method = "GET", url = "/", headers = {}, body } = {}) {
  const chunks = body === undefined ? [] : [Buffer.from(JSON.stringify(body))];
  const req = Readable.from(chunks);
  req.method = method;
  req.url = url;
  req.headers = headers;
  return req;
}

function makeResponse() {
  const res = {
    statusCode: 200,
    headers: {},
    body: Buffer.alloc(0),
    ended: false,
    setHeader(name, value) {
      res.headers[name.toLowerCase()] = value;
    },
    end(chunk) {
      if (chunk !== undefined && chunk !== null) {
        res.body = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      }
      res.ended = true;
    }
  };
  return res;
}

/** Register the routes with a controllable trust fence. */
function register(overrides = {}) {
  const routes = new Map();
  const scope = {
    connection: { requestRejection: () => undefined },
    webServer: {
      register(route) {
        routes.set(route.path, route);
        return () => {};
      }
    },
    effect(fn) {
      return fn();
    },
    ...overrides
  };
  registerRoutes(scope);
  return { routes, scope };
}

async function call(routes, path, options = {}) {
  const route = routes.get(path.split("?")[0]);
  assert.ok(route, `route ${path} is registered`);
  const req = makeRequest({ url: path, ...options });
  const res = makeResponse();
  await route.handler(req, res);
  const text = res.body.toString("utf8");
  let json;
  try {
    json = text === "" ? undefined : JSON.parse(text);
  } catch {
    json = undefined;
  }
  return { status: res.statusCode, headers: res.headers, text, json, res };
}

const JSON_HEADERS = { "content-type": "application/json" };

test("the liveness probe answers without a body", async () => {
  const { routes } = register();
  const result = await call(routes, "/dsh-right/ping");
  assert.equal(result.status, 200);
  assert.equal(result.json.service, "dsh-right");
  assert.equal(result.json.version, 2);
  assert.ok(result.json.capabilities.includes("exclusive-save"));
});

test("stat, read, and save-as validate absolute paths and operate on real files", async () => {
  const root = await mkdtemp(join(tmpdir(), "dsh-right-routes-"));
  try {
    const file = join(root, "a.md");
    await writeFile(file, "hello");
    const { routes } = register();

    const stat = await call(routes, "/dsh-right/stat", {
      method: "POST",
      headers: JSON_HEADERS,
      body: { path: file }
    });
    assert.equal(stat.status, 200);
    assert.equal(stat.json.exists, true);
    assert.equal(stat.json.kind, "file");

    const read = await call(routes, "/dsh-right/read", {
      method: "POST",
      headers: JSON_HEADERS,
      body: { path: file }
    });
    assert.equal(read.status, 200);
    assert.equal(read.json.text, "hello");

    const target = join(root, "copy", "b.md");
    const saved = await call(routes, "/dsh-right/save-as", {
      method: "POST",
      headers: JSON_HEADERS,
      body: { from: file, to: target }
    });
    assert.equal(saved.status, 200);
    assert.equal(await readFile(target, "utf8"), "hello");

    const raw = await call(routes, `/dsh-right/raw?path=${encodeURIComponent(file)}`);
    assert.equal(raw.status, 200);
    assert.equal(raw.text, "hello");
    assert.equal(raw.headers["content-type"], "application/octet-stream");
    assert.match(raw.headers["content-disposition"], /^attachment;/);
    assert.equal(raw.headers["x-content-type-options"], "nosniff");
    assert.match(raw.headers["content-security-policy"], /sandbox/);

    const relative = await call(routes, "/dsh-right/stat", {
      method: "POST",
      headers: JSON_HEADERS,
      body: { path: "relative/a.md" }
    });
    assert.equal(relative.status, 400);
    assert.equal(relative.json.code, "bad-request");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("save-as protects existing files, supports rename and explicit replacement", async () => {
  const root = await mkdtemp(join(tmpdir(), "dsh-right-conflict-"));
  try {
    const source = join(root, "source.txt"), target = join(root, "target.txt");
    await writeFile(source, "new"); await writeFile(target, "old");
    const { routes } = register();
    const save = conflict => call(routes, "/dsh-right/save-as", { method: "POST", headers: JSON_HEADERS, body: { from: source, to: target, ...(conflict ? { conflict } : {}) } });
    assert.equal((await save()).status, 409);
    assert.equal(await readFile(target, "utf8"), "old");
    const renamed = await save("rename");
    assert.equal(renamed.status, 200);
    assert.equal(renamed.json.path, join(root, "target (1).txt"));
    assert.equal(await readFile(target, "utf8"), "old");
    assert.equal((await save("replace")).status, 200);
    assert.equal(await readFile(target, "utf8"), "new");
    assert.equal((await save("invalid")).status, 400);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("raw HTML is an isolated download and missing raw paths answer 404", async () => {
  const root = await mkdtemp(join(tmpdir(), "dsh-right-html-"));
  try {
    const file = join(root, "中文 'page'.html");
    await writeFile(file, "<!doctype html><p>test</p>");
    const { routes } = register();
    const result = await call(routes, `/dsh-right/raw?path=${encodeURIComponent(file)}`);
    assert.equal(result.status, 200);
    assert.equal(result.headers["content-type"], "application/octet-stream");
    assert.match(result.headers["content-disposition"], /%27page%27/);
    assert.equal(result.headers["content-security-policy"], "sandbox; default-src 'none'");
    assert.equal(Number(result.headers["content-length"]), Buffer.byteLength(result.text));
    assert.equal((await call(routes, `/dsh-right/raw?path=${encodeURIComponent(join(root, "missing"))}`)).status, 404);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("a rejected request never reaches the filesystem", async () => {
  const { routes } = register({
    connection: { requestRejection: () => 403 }
  });
  const result = await call(routes, "/dsh-right/read", {
    method: "POST",
    headers: JSON_HEADERS,
    body: { path: "C:\\Windows\\win.ini" }
  });
  assert.equal(result.status, 403);
  assert.equal(result.text, "");
});

test("methods and content types are checked before the body", async () => {
  const { routes } = register();
  const wrongMethod = await call(routes, "/dsh-right/stat", {
    method: "GET",
    headers: JSON_HEADERS
  });
  assert.equal(wrongMethod.status, 405);
  assert.equal(wrongMethod.headers.allow, "POST");

  const wrongType = await call(routes, "/dsh-right/stat", {
    method: "POST",
    headers: { "content-type": "text/plain" },
    body: { path: "C:\\a.md" }
  });
  assert.equal(wrongType.status, 415);
});

test("editor navigation rejects invalid protocols, positions, and missing files", async () => {
  const { routes } = register();
  const request = body => call(routes, "/dsh-right/open-location", { method: "POST", headers: JSON_HEADERS, body });
  assert.equal((await request({ path: "relative.ts", editor: "vscode", line: 1 })).status, 400);
  assert.equal((await request({ path: "C:/file.ts", editor: "javascript", line: 1 })).status, 400);
  assert.equal((await request({ path: "C:/file.ts", editor: "vscode", line: -1 })).status, 400);
  assert.equal((await request({ path: join(tmpdir(), "dsh-right-does-not-exist", "a.ts"), editor: "vscode", line: 1 })).status, 404);
});

test("the body ceiling rejects oversized requests", async () => {
  const { routes } = register();
  const route = routes.get("/dsh-right/stat");
  const req = Readable.from([Buffer.alloc(70 * 1024, 0x20)]);
  req.method = "POST";
  req.url = "/dsh-right/stat";
  req.headers = JSON_HEADERS;
  const res = makeResponse();
  await route.handler(req, res);
  assert.equal(res.statusCode, 413);
});

test("missing files answer not-found and binary reads flag the content", async () => {
  const root = await mkdtemp(join(tmpdir(), "dsh-right-routes-"));
  try {
    const binary = join(root, "b.bin");
    await writeFile(binary, Buffer.from([0, 1, 2]));
    const { routes } = register();

    const bin = await call(routes, "/dsh-right/read", {
      method: "POST",
      headers: JSON_HEADERS,
      body: { path: binary }
    });
    assert.equal(bin.status, 200);
    assert.equal(bin.json.binary, true);

    const missing = await call(routes, "/dsh-right/read", {
      method: "POST",
      headers: JSON_HEADERS,
      body: { path: join(root, "nope.md") }
    });
    assert.equal(missing.status, 404);
    assert.equal(missing.json.code, "not-found");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
