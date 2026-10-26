/**
 * Host half HTTP routes.
 *
 * The browser needs four facts the Session Remotes do not offer: whether an
 * arbitrary absolute path exists, a file's text for "copy contents", its raw
 * bytes for "save as", and the ability to write a copy somewhere else. These
 * routes provide exactly those operations and nothing else.
 *
 * Every route sits behind the same trust fence the shipped controls use:
 * Host/Origin checks plus browser authentication from `connection`, then a
 * method check, a media-type check, a small body ceiling, and absolute-path
 * validation before any filesystem call.
 */
import { open } from "node:fs/promises";
import { baseName } from "../shared/paths.js";
import {
  MAX_BODY_BYTES,
  MAX_PATH_LENGTH,
  MAX_RAW_BYTES,
  PLUGIN_ID,
  PLUGIN_VERSION,
  ROUTE_BASE
} from "../shared/constants.js";
import { isAbsolutePath } from "../shared/paths.js";
import { copyFileTo, describePath, readTextFile } from "./fs-service.js";
import { openEditorLocation } from "./editor.js";

/** JSON response: live filesystem facts, never cached. */
function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify(payload));
}

/** 405 with the one method a route supports. */
function sendMethodNotAllowed(res, allow) {
  res.statusCode = 405;
  res.setHeader("allow", allow);
  res.end();
}

/**
 * Collect a bounded request body as UTF-8 text.
 * @returns the text, `null` past the ceiling (stream drained), or `undefined`
 * when the stream failed mid-body.
 */
async function readBoundedBody(req) {
  const chunks = [];
  let size = 0;
  try {
    for await (const chunk of req) {
      size += chunk.byteLength;
      if (size > MAX_BODY_BYTES) {
        req.resume();
        return null;
      }
      chunks.push(chunk);
    }
  } catch {
    return undefined;
  }
  return Buffer.concat(chunks, size).toString("utf8");
}

/** Parse a JSON object body carrying the given required string fields. */
function parseBody(text, fields) {
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) return null;
  const picked = { ...body };
  for (const field of fields) {
    const value = body[field];
    if (typeof value !== "string" || value === "") return null;
    picked[field] = value;
  }
  return picked;
}

/** An absolute, non-NUL, bounded path field; `false` for anything else. */
function isHostPath(value) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_PATH_LENGTH &&
    !value.includes("\u0000") &&
    isAbsolutePath(value)
  );
}

/** The path query parameter of the raw route, or `undefined`. */
function queryPath(req) {
  try {
    return new URL(String(req.url), "http://localhost").searchParams.get("path") ?? undefined;
  } catch {
    return undefined;
  }
}

/** Register every route on one injected `webServer` + `connection` scope. */
export function registerRoutes(scope) {
  /** Answer an untrusted/unauthenticated request; true when it was rejected. */
  const rejected = (req, res) => {
    const rejection = scope.connection.requestRejection(req);
    if (rejection === undefined) return false;
    res.statusCode = rejection;
    res.end();
    return true;
  };

  /** Wrap one JSON POST route: fence, method, media type, ceiling, fields. */
  const post = (suffix, fields, handler) =>
    scope.effect(
      () =>
        scope.webServer.register({
          kind: "exact",
          path: `${ROUTE_BASE}${suffix}`,
          handler: async (req, res) => {
            if (rejected(req, res)) return;
            if (req.method !== "POST") {
              sendMethodNotAllowed(res, "POST");
              return;
            }
            const essence = String(req.headers["content-type"]).split(";", 1)[0]?.trim().toLowerCase();
            if (essence !== "application/json") {
              sendJson(res, 415, {
                code: "unsupported-media-type",
                message: "content-type must be application/json"
              });
              return;
            }
            const text = await readBoundedBody(req);
            if (text === null) {
              sendJson(res, 413, { code: "payload-too-large", message: "request body is too large" });
              return;
            }
            if (text === undefined) {
              sendJson(res, 400, { code: "bad-request", message: "request body unreadable" });
              return;
            }
            const parsed = parseBody(text, fields);
            if (parsed === null) {
              sendJson(res, 400, {
                code: "bad-request",
                message: `request body must be JSON with string ${fields.map((field) => `"${field}"`).join(", ")}`
              });
              return;
            }
            try {
              await handler(parsed, res);
            } catch (error) {
              const code = error?.code === "EEXIST" ? "destination-exists"
                : ["EACCES", "EPERM"].includes(error?.code) ? "permission-denied"
                : error?.code === "ENOENT" ? "not-found" : "failed";
              sendJson(res, code === "destination-exists" ? 409 : code === "permission-denied" ? 403 : code === "not-found" ? 404 : 500, {
                code,
                message: error instanceof Error ? error.message : String(error)
              });
            }
          }
        }),
      `${PLUGIN_ID}: POST ${ROUTE_BASE}${suffix}`
    );

  /** Liveness probe: also tells the browser half whether the host half loaded. */
  scope.effect(
    () =>
      scope.webServer.register({
        kind: "exact",
        path: `${ROUTE_BASE}/ping`,
        handler: (req, res) => {
          if (rejected(req, res)) return;
          if (req.method !== "GET") {
            sendMethodNotAllowed(res, "GET");
            return;
          }
          sendJson(res, 200, { ok: true, service: PLUGIN_ID, version: 2, pluginVersion: PLUGIN_VERSION, capabilities: ["exclusive-save", "rename-save", "safe-download", "editor-location"] });
        }
      }),
    `${PLUGIN_ID}: GET ${ROUTE_BASE}/ping`
  );

  /** Raw bytes for one absolute path: the source of a browser-side Save As. */
  scope.effect(
    () =>
      scope.webServer.register({
        kind: "exact",
        path: `${ROUTE_BASE}/raw`,
        handler: async (req, res) => {
          if (rejected(req, res)) return;
          if (req.method !== "GET") {
            sendMethodNotAllowed(res, "GET");
            return;
          }
          const path = queryPath(req);
          if (path === undefined || !isHostPath(path)) {
            sendJson(res, 400, { code: "bad-request", message: "path must be an absolute path" });
            return;
          }
          let bytes;
          try {
            const handle = await open(path, "r");
            try {
              const info = await handle.stat();
              if (!info.isFile()) {
                sendJson(res, 400, { code: "not-a-file", message: path });
                return;
              }
              if (info.size > MAX_RAW_BYTES) {
                sendJson(res, 413, { code: "file-too-large", message: "file is too large to save as" });
                return;
              }
              bytes = Buffer.alloc(info.size);
              let offset = 0;
              while (offset < bytes.length) {
                const result = await handle.read(bytes, offset, bytes.length - offset, offset);
                if (result.bytesRead === 0) break;
                offset += result.bytesRead;
              }
              bytes = bytes.subarray(0, offset);
            } finally {
              await handle.close();
            }
          } catch (error) {
            sendJson(res, error.code === "ENOENT" ? 404 : ["EACCES", "EPERM"].includes(error.code) ? 403 : 500, {
              code: error.code === "ENOENT" ? "not-found" : ["EACCES", "EPERM"].includes(error.code) ? "permission-denied" : "failed",
              message: error instanceof Error ? error.message : String(error)
            });
            return;
          }
          res.statusCode = 200;
          res.setHeader("content-type", "application/octet-stream");
          res.setHeader("content-disposition", `attachment; filename*=UTF-8''${encodeURIComponent(baseName(path)).replace(/['()*]/g, char => `%${char.charCodeAt(0).toString(16)}`)}`);
          res.setHeader("x-content-type-options", "nosniff");
          res.setHeader("content-security-policy", "sandbox; default-src 'none'");
          res.setHeader("cache-control", "no-store");
          res.setHeader("content-length", String(bytes.byteLength));
          res.end(bytes);
        }
      }),
    `${PLUGIN_ID}: GET ${ROUTE_BASE}/raw`
  );

  post("/stat", ["path"], async ({ path }, res) => {
    if (!isHostPath(path)) {
      sendJson(res, 400, { code: "bad-request", message: "path must be an absolute path" });
      return;
    }
    sendJson(res, 200, { path, ...(await describePath(path)) });
  });

  post("/read", ["path"], async ({ path }, res) => {
    if (!isHostPath(path)) {
      sendJson(res, 400, { code: "bad-request", message: "path must be an absolute path" });
      return;
    }
    const result = await readTextFile(path);
    if (!result.ok) {
      sendJson(res, result.code === "not-found" ? 404 : 400, { code: result.code, message: path });
      return;
    }
    sendJson(res, 200, { path, ...result });
  });

  post("/save-as", ["from", "to"], async ({ from, to, conflict = "error" }, res) => {
    if (!isHostPath(from) || !isHostPath(to)) {
      sendJson(res, 400, { code: "bad-request", message: "from and to must be absolute paths" });
      return;
    }
    if (!["error", "replace", "rename"].includes(conflict)) {
      sendJson(res, 400, { code: "bad-request", message: "invalid conflict policy" });
      return;
    }
    const source = await describePath(from);
    if (!source.exists || source.kind !== "file") {
      sendJson(res, 404, { code: "not-found", message: from });
      return;
    }
    const written = await copyFileTo(from, to, conflict);
    sendJson(res, 200, { path: written.path, size: written.size });
  });

  post("/open-location", ["path", "editor"], async ({ path, editor, line, column = 1 }, res) => {
    if (!isHostPath(path) || !["vscode", "vscode-insiders"].includes(editor) || !Number.isSafeInteger(line) || line < 1 || !Number.isSafeInteger(column) || column < 1) {
      sendJson(res, 400, { code: "bad-request", message: "invalid editor location" });
      return;
    }
    const info = await describePath(path);
    if (!info.exists || info.kind !== "file") {
      sendJson(res, 404, { code: "not-found", message: path });
      return;
    }
    await openEditorLocation(path, line, column, editor);
    sendJson(res, 200, { opened: true });
  });

}
