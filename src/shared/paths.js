/**
 * Path helpers shared by the host and browser halves.
 *
 * DSH can run against either spelling of a path: POSIX (`/home/me/a.md`) or
 * Windows (`C:\Users\me\a.md`). The helpers below never guess a platform from
 * the running process; they take the spelling from the path itself, because
 * the Host may serve a workspace on another platform (remote profiles).
 */

/** A Windows drive path or a UNC path. */
export function isWindowsStylePath(value) {
  return /^[A-Za-z]:[/\\]/.test(value) || value.startsWith("\\\\");
}

/** Whether a path is rooted, in either spelling. */
export function isAbsolutePath(value) {
  return value.startsWith("/") || isWindowsStylePath(value);
}

/** The separator a path already uses. */
export function separatorOf(path) {
  return path.includes("\\") ? "\\" : "/";
}

/** Rewrite a path to one separator spelling. */
export function withSeparator(path, separator) {
  return separator === "\\" ? path.replace(/\//g, "\\") : path.replace(/\\/g, "/");
}

/** Join a directory and a name in that directory's own spelling. */
export function joinPath(directory, name) {
  const separator = separatorOf(directory);
  const base = directory.replace(/[/\\]+$/, "");
  return `${base}${separator}${withSeparator(name, separator)}`;
}

/** One path in a single `/` spelling, for comparisons and display. */
export function normalizePath(path) {
  return path
    .replace(/\\/g, "/")
    .replace(/^(?:\.\/)+/, "")
    .replace(/\/+$/, "");
}

/** The last path segment of either separator spelling. */
export function baseName(path) {
  const trimmed = path.replace(/[/\\]+$/, "");
  const at = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return at === -1 ? trimmed : trimmed.slice(at + 1);
}

/**
 * A workspace-relative spelling of an absolute path, or `undefined` when the
 * path is outside the root. Windows comparison is case-insensitive, matching
 * the filesystem; the returned slice keeps the caller's original casing.
 */
export function relativeTo(root, absolute) {
  if (root === undefined || root === null || root === "") return undefined;
  const normalizedRoot = normalizePath(root);
  const normalizedAbsolute = normalizePath(absolute);
  if (normalizedRoot === "") return undefined;
  const windows = isWindowsStylePath(normalizedRoot);
  const rootKey = windows ? normalizedRoot.toLowerCase() : normalizedRoot;
  const absoluteKey = windows ? normalizedAbsolute.toLowerCase() : normalizedAbsolute;
  if (absoluteKey === rootKey) return "";
  if (!absoluteKey.startsWith(`${rootKey}/`)) return undefined;
  return normalizedAbsolute.slice(normalizedRoot.length + 1);
}

/** Encode one path segment, keeping the Windows drive colon readable. */
export function encodeSegment(segment) {
  return encodeURIComponent(segment).replace(/%3A/gi, ":");
}

/** Encode a `/`-separated path for a `dsh-resource:` address. */
export function encodePath(path) {
  return path.split("/").map(encodeSegment).join("/");
}

/** The `dsh-resource://file/session/<id>/<path>` address for one Session file. */
export function sessionFileAddress(sessionId, path) {
  const normalized = path.replace(/\\/g, "/").replace(/^(?:\.\/)+/, "");
  return `dsh-resource://file/session/${encodeSegment(sessionId)}/${encodePath(normalized)}`;
}

/**
 * The address for a path as the menu holds it: a workspace-relative path, or
 * an absolute path inside the workspace, becomes session-scoped.
 */
export function fileAddressFor(sessionId, cwd, path) {
  const normalized = path.replace(/\\/g, "/");
  if (!isAbsolutePath(normalized)) return sessionFileAddress(sessionId, normalized);
  const root = cwd === undefined || cwd === "" ? "" : cwd.replace(/\\/g, "/").replace(/\/+$/, "");
  if (root !== "") {
    const windows = isWindowsStylePath(root);
    const rootKey = windows ? root.toLowerCase() : root;
    const pathKey = windows ? normalized.toLowerCase() : normalized;
    if (pathKey === rootKey) return sessionFileAddress(sessionId, "");
    if (pathKey.startsWith(`${rootKey}/`)) {
      return sessionFileAddress(sessionId, normalized.slice(root.length + 1));
    }
  }
  return sessionFileAddress(sessionId, normalized);
}
