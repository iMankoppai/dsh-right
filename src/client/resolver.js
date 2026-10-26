/**
 * Turning DOM targets into "this file, on this Host" facts.
 *
 * Every resolved file carries an absolute path, a kind, a workspace-relative
 * spelling when it is inside the root, and the Session that authorized the
 * lookup. The menu never offers actions for a path the Host did not confirm.
 */
import { MAX_PATH_LENGTH } from "../shared/constants.js";
import { splitLocation } from "./text.js";
import { bounded } from "./async.js";
import {
  baseName,
  isAbsolutePath,
  joinPath,
  normalizePath,
  relativeTo
} from "../shared/paths.js";

/** Remote calls answer `{ ok, value }`; local helpers answer the value itself. */
export function unwrap(result) {
  if (result === null || typeof result !== "object") return undefined;
  if (!("ok" in result)) return result;
  return result.ok ? result.value : undefined;
}

/** A file-looking tail such as `.json`, `.tsx`, `.tar.gz`. */
const FILE_TAIL = /\.[A-Za-z0-9]{1,8}$/;

/** One file or directory as the rest of the plugin holds it. */
export function makeFile({
  absolutePath,
  kind,
  sessionId,
  cwd,
  rowButton,
  relativePath,
  line,
  column
}) {
  return {
    absolutePath,
    kind: kind === "directory" ? "directory" : "file",
    name: baseName(absolutePath),
    relativePath: relativePath ?? (cwd === undefined ? undefined : relativeTo(cwd, absolutePath)),
    sessionId,
    cwd,
    rowButton,
    ...(line === undefined ? {} : { line, column: column ?? 1 })
  };
}

export function createResolver({ host, remotes, contextForSession }) {
  /**
   * The same `@file` search the composer uses, for a bare name that is not a
   * workspace-root path: an exact candidate wins, then a candidate whose path
   * ends with the name.
   */
  const searchWorkspace = async (sessionId, token, signal) => {
    const references = remotes.references;
    if (references === undefined || typeof references.list !== "function" || sessionId === undefined) {
      return undefined;
    }
    let list;
    try {
      list = unwrap(await references.list(sessionId, token, signal));
    } catch {
      return undefined;
    }
    if (!Array.isArray(list) || list.length === 0) return undefined;
    const wanted = normalizePath(token);
    const usable = list.filter(
      (item) => item !== null && typeof item === "object" && typeof item.path === "string"
    );
    const exact = usable.find(item => normalizePath(item.path) === wanted);
    const matches = exact ? [exact] : usable.filter(item => normalizePath(item.path).endsWith(`/${wanted}`));
    const unique = [...new Map(matches.map(item => [normalizePath(item.path), item])).values()];
    if (unique.length === 0) return undefined;
    if (unique.length > 1) return { choices: unique.map(item => ({ path: item.path, kind: item.kind })) };
    return { path: unique[0].path, kind: unique[0].kind === "directory" ? "directory" : "file" };
  };

  /** Absolute path of one workspace-relative directory, when it is knowable. */
  const absoluteOfListing = (cwd, listing, requested) => {
    if (typeof listing?.path === "string" && isAbsolutePath(listing.path)) return listing.path;
    if (cwd === undefined || cwd === "") return undefined;
    return joinPath(cwd, requested);
  };

  /**
   * Resolve one path to an absolute path and a kind, using every source the
   * Host offers: the `/stat` route for absolute paths anywhere it can reach,
   * the `workspaceFiles` Remote for workspace-relative ones (which also
   * reports the authoritative absolute path), and the composer's own `@file`
   * search for a bare name that is not a workspace-root path.
   *
   * @returns `{ absolutePath, fileKind }` or undefined when nothing proves the path exists.
   */
  const resolveFile = async (sessionId, path, cwd, signal = AbortSignal.timeout(5000)) => {
    signal.throwIfAborted();
    if (typeof path !== "string" || path === "" || path.length > MAX_PATH_LENGTH) return undefined;
    const files = remotes.files;

    if (isAbsolutePath(path)) {
      const hostStat = await host.post("/stat", { path }, signal);
      if (hostStat !== undefined) {
        if (hostStat.exists !== true) return undefined;
        return { absolutePath: path, fileKind: hostStat.kind === "directory" ? "directory" : "file" };
      }
      // No route: an absolute path inside the workspace still resolves remotely.
      if (files === undefined || sessionId === undefined) return undefined;
      try {
        const value = unwrap(await files.stat(sessionId, path, signal));
        if (value !== undefined && value !== null && typeof value.absolutePath === "string") {
          return { absolutePath: value.absolutePath, fileKind: "file" };
        }
      } catch {
        // fall through
      }
      return undefined;
    }

    if (files !== undefined && sessionId !== undefined) {
      // A path without an extension is more likely a directory than a file:
      // try `list` first so `plugins-src/dsh-computer-use-native` is not
      // mistaken for a regular file (or rejected by `stat`).
      if (!FILE_TAIL.test(path)) {
        try {
          const listing = unwrap(await files.list(sessionId, path, signal));
          if (listing !== undefined && listing !== null) {
            const absolutePath = absoluteOfListing(cwd, listing, path);
            if (absolutePath !== undefined) return { absolutePath, fileKind: "directory" };
          }
        } catch {
          // not a directory: fall through to the regular-file stat
        }
      }

      let value;
      try {
        value = unwrap(await files.stat(sessionId, path, signal));
      } catch {
        value = undefined;
      }
      if (value !== undefined && value !== null && typeof value.absolutePath === "string") {
        return { absolutePath: value.absolutePath, fileKind: "file" };
      }

      // `stat` only accepts regular files, so a relative directory is proven
      // through `list`; it answers a workspace-relative path.
      try {
        const listing = unwrap(await files.list(sessionId, path, signal));
        if (listing !== undefined && listing !== null) {
          const absolutePath = absoluteOfListing(cwd, listing, path);
          if (absolutePath !== undefined) return { absolutePath, fileKind: "directory" };
        }
      } catch {
        // not a directory, or not listable: fall through to the search
      }

      const found = await searchWorkspace(sessionId, path, signal);
      if (found !== undefined) {
        if (found.choices) return found;
        let resolved;
        try {
          const statValue = unwrap(await files.stat(sessionId, found.path, signal));
          if (statValue !== undefined && statValue !== null && typeof statValue.absolutePath === "string") {
            resolved = statValue.absolutePath;
          }
        } catch {
          // fall through to the cwd join
        }
        if (resolved === undefined && cwd !== undefined) resolved = joinPath(cwd, found.path);
        if (resolved !== undefined) return { absolutePath: resolved, fileKind: found.kind };
      }
    }

    if (cwd !== undefined && cwd !== "") {
      const guess = joinPath(cwd, path);
      const hostStat = await host.post("/stat", { path: guess }, signal);
      if (hostStat !== undefined && hostStat.exists === true) {
        return { absolutePath: guess, fileKind: hostStat.kind === "directory" ? "directory" : "file" };
      }
    }

    return undefined;
  };

  /** One resolved file, shaped as the menu target's `file` field. */
  const fileFromResolved = (sessionId, cwd, resolved, extra = {}) =>
    makeFile({
      absolutePath: resolved.absolutePath,
      kind: resolved.fileKind,
      sessionId,
      cwd,
      ...extra
    });

  /** Confirm a scanned token against the Host before offering the menu. */
  const resolveToken = async (context, candidate, signal) => {
    const resolved = await bounded(() => resolveFile(context?.sessionId, candidate.path, context?.cwd, signal), signal);
    if (resolved === undefined) return undefined;
    if (resolved.choices) return { type: "choices", choices: resolved.choices, context, location: candidate };
    return { type: "file", file: fileFromResolved(context?.sessionId, context?.cwd, resolved, { line: candidate.line, column: candidate.column }) };
  };

  /**
   * The path a link names on the Host, for the address forms the GUI produces:
   * a `dsh-resource://file/session/…` address, a `dsh-resource://file/absolute/…`
   * address, a `file://` URL, and the authenticated `api/file?path=…` media
   * route.
   *
   * @returns `{ sessionId?, path }`, or undefined for a link that is not a file.
   */
  const localPathOfLink = (url) => {
    if (url === undefined) return undefined;
    try {
      if (url.protocol === "dsh-resource:") {
        if (url.host !== "file") return undefined;
        const pathname = url.pathname;
        const session = pathname.match(/^\/session\/([^/]+)\/(.*)$/);
        if (session !== null) {
          const sessionId = decodeURIComponent(session[1]);
          const path = session[2].split("/").map(decodeURIComponent).join("/");
          return path === "" ? undefined : { sessionId, path };
        }
        const absolute = pathname.match(/^\/absolute\/(.*)$/);
        if (absolute !== null) {
          const path = absolute[1].split("/").map(decodeURIComponent).join("/");
          return path === "" ? undefined : { path };
        }
        return undefined;
      }
      if (url.protocol === "file:") {
        let path = decodeURIComponent(url.pathname);
        if (url.hostname && url.hostname !== "localhost") return { path: `\\\\${url.hostname}${path.replace(/\//g, "\\")}` };
        if (/^\/[A-Za-z]:/.test(path)) path = path.slice(1);
        return path === "" ? undefined : { path };
      }
      if (url.origin === new URL(document.baseURI).origin && url.pathname.endsWith("/api/file")) {
        const path = url.searchParams.get("path");
        return path === null || path === "" ? undefined : { path };
      }
    } catch {
      return undefined;
    }
    return undefined;
  };

  /**
   * Resolve a link element. External links need no Host confirmation; a link
   * that names a file is resolved like a clicked path, and the file rows are
   * added only when the file is really there.
   */
  const resolveLink = async (anchor, { context, sidebarBrowser }, signal) => {
    const href = anchor.getAttribute("href") ?? "";
    let url;
    try {
      url = new URL(href, document.baseURI);
    } catch {
      url = undefined;
    }
    const text = (anchor.textContent ?? "").trim();
    const label = url === undefined || url.host === "" ? href : url.host;
    const target = {
      type: "link",
      name: label,
      href: url === undefined ? href : url.href,
      scheme: url === undefined ? "" : url.protocol,
      text,
      anchor,
      sidebarBrowser: sidebarBrowser === true
    };
    const local = localPathOfLink(url);
    if (local === undefined) return target;
    if (local.sessionId && local.sessionId !== context?.sessionId) context = contextForSession?.(local.sessionId) ?? { sessionId: local.sessionId };
    const location = splitLocation(local.path + (/^#L\d+(?:C\d+)?$/.test(url.hash) ? url.hash : ""));
    const resolved = await bounded(() => resolveFile(local.sessionId ?? context?.sessionId, location.path, context?.cwd, signal), signal);
    if (resolved?.choices) return { type: "choices", choices: resolved.choices, context: { ...context, sessionId: local.sessionId ?? context?.sessionId }, location, link: target };
    if (resolved !== undefined) {
      target.file = fileFromResolved(local.sessionId ?? context?.sessionId, context?.cwd, resolved, { line: location.line, column: location.column });
    }
    return target;
  };

  /**
   * A file mention the chat renders as a button: its `title` carries the path
   * exactly as the tool spelled it, which keeps names with spaces working.
   */
  const resolveMention = async (button, context, signal) => {
    const path = (button.getAttribute("title") ?? "").trim();
    if (path === "" || path.length > MAX_PATH_LENGTH) return undefined;
    // A mention may name a directory, so a separator (or an absolute path)
    // is enough; the Host still proves that it exists.
    return resolveToken(context, splitLocation(path), signal);
  };

  return {
    resolveFile,
    fileFromResolved,
    resolveToken,
    resolveLink,
    resolveMention,
    localPathOfLink,
    searchWorkspace
  };
}
