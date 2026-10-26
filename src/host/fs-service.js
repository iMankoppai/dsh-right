/**
 * Filesystem operations behind the host routes.
 *
 * Kept separate from the HTTP layer so they can be unit-tested with plain
 * paths, and so a future change (symlink policy, size caps, encoding) has one
 * obvious home.
 */
import { copyFile, mkdir, open, stat } from "node:fs/promises";
import { dirname, extname } from "node:path";
import { constants } from "node:fs";
import { StringDecoder } from "node:string_decoder";
import { MAX_READ_BYTES } from "../shared/constants.js";

/** Content types the raw-byte route answers with; anything else is opaque. */
const CONTENT_TYPES = {
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".cjs": "text/javascript; charset=utf-8",
  ".ts": "text/plain; charset=utf-8",
  ".tsx": "text/plain; charset=utf-8",
  ".jsx": "text/plain; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".pdf": "application/pdf",
  ".csv": "text/csv; charset=utf-8",
  ".yaml": "text/yaml; charset=utf-8",
  ".yml": "text/yaml; charset=utf-8"
};

/** Missing paths are distinct from permission and I/O errors. */
export async function describePath(path) {
  try {
    const info = await stat(path);
    return {
      exists: true,
      kind: info.isDirectory() ? "directory" : info.isFile() ? "file" : "other",
      size: info.size,
      mtimeMs: info.mtimeMs
    };
  } catch (error) {
    if (["ENOENT", "ENOTDIR"].includes(error.code)) return { exists: false };
    throw error;
  }
}

/**
 * Read at most `limit` bytes of one regular file as UTF-8 text.
 *
 * The whole file is never buffered: a 2 GiB log read for "copy contents" costs
 * one page, not 2 GiB. Binary detection looks for a NUL byte in the head of the
 * returned slice, matching what text editors use.
 */
export async function readTextFile(path, limit = MAX_READ_BYTES) {
  let handle;
  try { handle = await open(path, "r"); }
  catch (error) {
    if (error.code === "ENOENT") return { ok: false, code: "not-found" };
    throw error;
  }
  let info;
  let buffer;
  let bytesRead = 0;
  try {
    info = await handle.stat();
    if (!info.isFile()) return { ok: false, code: "not-a-file" };
    const bytesToRead = Math.min(info.size, limit + 1);
    buffer = Buffer.alloc(bytesToRead);
    while (bytesRead < bytesToRead) {
      const result = await handle.read(buffer, bytesRead, bytesToRead - bytesRead, bytesRead);
      if (result.bytesRead === 0) break;
      bytesRead += result.bytesRead;
    }
  } finally {
    await handle.close();
  }

  const truncated = bytesRead > limit;
  const slice = truncated
    ? buffer.subarray(0, Math.min(limit, bytesRead))
    : buffer.subarray(0, bytesRead);
  const binary = slice.subarray(0, 8000).includes(0);
  return {
    ok: true,
    // write() retains an incomplete trailing code point; don't flush it on truncation.
    text: binary ? "" : truncated ? new StringDecoder("utf8").write(slice) : slice.toString("utf8"),
    binary,
    truncated,
    size: info.size
  };
}

/** Copy one regular file to an absolute destination, creating its directory. */
export async function copyFileTo(from, to, policy = "error") {
  if (!["error", "replace", "rename"].includes(policy)) throw new Error("invalid conflict policy");
  await mkdir(dirname(to), { recursive: true });
  const extension = extname(to);
  const stem = extension ? to.slice(0, -extension.length) : to;
  for (let index = 0; index < 1000; index += 1) {
    const destination = index === 0 ? to : `${stem} (${index})${extension}`;
    try {
      await copyFile(from, destination, policy === "replace" ? 0 : constants.COPYFILE_EXCL);
      return { ...(await describePath(destination)), path: destination };
    } catch (error) {
      if (error.code !== "EEXIST" || policy !== "rename") throw error;
    }
  }
  throw Object.assign(new Error("No unused destination name"), { code: "EEXIST" });
}

/** The content type for the raw-byte route, by extension. */
export function contentTypeFor(path) {
  return CONTENT_TYPES[extname(path).toLowerCase()] ?? "application/octet-stream";
}
