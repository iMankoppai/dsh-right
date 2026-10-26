/**
 * What each menu row does.
 *
 * Every action either uses a shipped DSH capability (Session Remote for
 * open/reveal/applications, workspaceFiles for reads, sidebarRight for the
 * in-app preview, directoryPicker for a destination) or one of this package's
 * small host routes.
 */
import { fileAddressFor, joinPath } from "../shared/paths.js";
import { unwrap } from "./resolver.js";
import { MAX_RAW_BYTES, MAX_READ_BYTES } from "../shared/constants.js";
import { formatPath } from "./settings.js";
import { bounded, readBoundedBlob } from "./async.js";

export function editorScheme(app) {
  const name = `${app?.id ?? ""} ${app?.name ?? ""}`.toLowerCase();
  if (/visual studio code|vscode|vs code/.test(name)) return /insiders/.test(name) ? "vscode-insiders" : "vscode";
  return undefined;
}

export function errorKey(error) {
  if (error?.name === "TimeoutError") return "notice.timeout";
  return ({ "permission-denied": "notice.permissionDenied", unauthorized: "notice.unauthorized", "not-found": "notice.fileMissing", "file-too-large": "notice.tooLarge", "host-unavailable": "notice.hostUnavailable", "editor-unavailable": "notice.noLineEditor", timeout: "notice.timeout" })[error?.code] ?? "notice.operationFailed";
}

/** Compact byte text for the toast. */
function sizeText(bytes) {
  if (typeof bytes !== "number" || Number.isNaN(bytes)) return "";
  if (bytes < 1024) return `${String(bytes)}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

export function createActions({ ctx, remotes, host, store, t, notify, closeMenu, P, requestDialog = async () => null, openSettings = () => {}, diagnose = () => {} }) {
  const preferences = () => store.get().settings ?? {};
  /**
   * Briefly cache desktop availability; a failed probe is retried after 5s.
   */
  let desktopResolved = false;
  let desktopValue = false;
  let desktopPromise;
  let desktopAt = 0;
  let desktopService;

  /**
   * File associations are cached per extension. On Windows DSH answers this
   * by spawning `powershell.exe -STA` (~300 ms startup) and querying Shell
   * handlers, so a per-menu query makes the desktop rows visibly late.
   */
  const appCache = new Map();
  const APP_CACHE_TTL_MS = 60_000;
  const appCacheKey = (name) => {
    const at = name.lastIndexOf(".");
    return at > 0 ? name.slice(at).toLowerCase() : `name:${name}`;
  };

  /** Show one file in the in-app preview: the tree row's own gesture, or an address. */
  const openInDsh = (file) => {
    if (file.rowButton !== undefined) {
      if (!document.contains(file.rowButton)) return false;
      try {
        file.rowButton.click();
        return true;
      } catch {
        return false;
      }
    }
    const sidebarRight = ctx.get("sidebarRight");
    if (sidebarRight === undefined || file.sessionId === undefined) return false;
    const address = fileAddressFor(file.sessionId, file.cwd, file.absolutePath);
    try {
      if (typeof sidebarRight.openResource === "function") {
        sidebarRight.openResource(address);
        return true;
      }
    } catch {
      // try the Session-scoped form below
    }
    try {
      if (typeof sidebarRight.openResourceIn === "function") {
        sidebarRight.openResourceIn(file.sessionId, address);
        return true;
      }
    } catch {
      // no preview for this file type / surface
    }
    return false;
  };

  /** Open or reveal one host path through the Session Remote the shipped controls use. */
  const openPath = async (file, action, application) => {
    const session = remotes.session;
    if (session === undefined) return false;
    const request =
      action === "reveal"
        ? { path: file.absolutePath, action }
        : { path: file.absolutePath, ...(application === undefined ? {} : { application }) };
    try {
      return unwrap(await session.openWorkspacePath(request)) !== undefined;
    } catch {
      return false;
    }
  };

  /** Whether this Host can open paths on the desktop. Cheap; resolved once. */
  const loadDesktop = () => {
    const session = remotes.session;
    if (session === undefined) return Promise.resolve(false);
    if (desktopService !== session) { desktopPromise = undefined; desktopResolved = false; desktopService = session; }
    if (desktopResolved && Date.now() - desktopAt < (desktopValue ? 60000 : 5000)) return Promise.resolve(desktopValue);
    if (desktopPromise === undefined) {
      desktopPromise = (async () => {
        let desktop = false;
        try {
          desktop = unwrap(await session.canOpenWorkspacePath()) === true;
        } catch {
          // treat as no desktop
        }
        desktopValue = desktop;
        desktopResolved = true;
        desktopAt = Date.now();
        desktopPromise = undefined;
        return desktop;
      })();
    }
    return desktopPromise;
  };

  /** The already-known answer, for painting the first frame without a wait. */
  const knownDesktop = () => (desktopResolved ? desktopValue : undefined);

  /** The (slow, cached) associated-application list for one file. */
  const loadAppList = async (file) => {
    if (file === undefined) return [];
    const desktop = await loadDesktop();
    if (!desktop) return [];

    const key = `${file.kind}:${file.sessionId ?? ""}:${appCacheKey(file.name)}`;
    const now = Date.now();
    const cached = appCache.get(key);
    if (cached !== undefined && now - cached.at < APP_CACHE_TTL_MS) return cached.promise;

      const promise = (async () => {
      const session = remotes.session;
      if (session === undefined) return [];
      try {
        const value = unwrap(
          await session.workspacePathApplications({ path: file.absolutePath }, new AbortController().signal)
        );
        const list = Array.isArray(value) ? value : Array.isArray(value?.apps) ? value.apps : [];
        return list
          .filter((app) => app !== null && typeof app === "object" && typeof app.id === "string")
          .map((app) => ({
            id: app.id,
            name: typeof app.name === "string" && app.name !== "" ? app.name : app.id,
            default: app.default === true,
            icon: typeof app.icon === "string" ? app.icon : undefined
          }));
      } catch {
        return [];
      }
    })();
    appCache.set(key, { at: now, promise });
    return promise;
  };

  /** Both facts in one call, kept for callers that want the old shape. */
  const loadApplications = async (file) => {
    const desktop = await loadDesktop();
    if (!desktop) return { desktop: false, apps: [] };
    return { desktop: true, apps: await loadAppList(file) };
  };

  /** Read one file as text: this package's route first, the Session Remote as the fallback. */
  const readContents = async (file) => {
    const fromHost = await host.post("/read", { path: file.absolutePath });
    if (fromHost !== undefined) {
      if (fromHost.binary === true) return { binary: true, size: fromHost.size };
      if (typeof fromHost.text !== "string") return undefined;
      return { text: fromHost.text, truncated: fromHost.truncated === true, size: fromHost.size };
    }

    const files = remotes.files;
    if (files === undefined || file.sessionId === undefined) return undefined;
    const signal = new AbortController().signal;
    const relative = file.relativePath ?? file.absolutePath;
    const parts = [];
    let totalBytes = 0;
    let offset = 1;
    let size;
    let completed = false;
    for (let page = 0; page < 12; page += 1) {
      let value;
      try {
        value = unwrap(await files.read(file.sessionId, relative, { offset }, signal));
      } catch {
        return undefined;
      }
      if (value === undefined || typeof value.text !== "string") return undefined;
      if (value.binary === true || value.text.includes("\0")) return { binary: true };
      const encoded = new TextEncoder().encode((parts.length ? "\n" : "") + value.text);
      const remaining = MAX_READ_BYTES - totalBytes;
      if (encoded.length > remaining) {
        parts.push(new TextDecoder().decode(encoded.subarray(0, remaining), { stream: true }));
        break;
      }
      parts.push(new TextDecoder().decode(encoded));
      totalBytes += encoded.length;
      size = value.bytes;
      if (value.eof === true || value.lines === 0) {
        completed = true;
        break;
      }
      if (!Number.isSafeInteger(value.lines) || value.lines < 1) break;
      offset += value.lines;
    }
    return {
      text: parts.join(""),
      size,
      truncated: !completed
    };
  };

  /** The raw bytes of one file, for a Save As. */
  const fetchBytes = async (file) => {
    const fromHost = await host.rawBlob(file.absolutePath);
    if (fromHost !== undefined) {
      if (fromHost.size > MAX_RAW_BYTES) throw Object.assign(new Error(), { code: "file-too-large" });
      return fromHost;
    }

    const downloadController = new AbortController();
    try {
      const response = await bounded(() => fetch(`api/file?path=${encodeURIComponent(file.absolutePath)}`, { signal: downloadController.signal }), downloadController.signal, 30000);
      if (response.ok) {
        const blob = await bounded(() => readBoundedBlob(response, MAX_RAW_BYTES), downloadController.signal, 30000);
        return blob;
      }
    } catch (error) {
      if (error.code === "file-too-large") throw error;
      // fall through
    } finally { downloadController.abort(); }

    const files = remotes.files;
    if (files !== undefined && file.sessionId !== undefined) {
      try {
        const value = unwrap(
          await files.readBytes(
            file.sessionId,
            file.relativePath ?? file.absolutePath,
            {},
            new AbortController().signal
          )
        );
        if (value?.data !== undefined) {
          const blob = new Blob([Array.isArray(value.data) ? new Uint8Array(value.data) : value.data]);
          if (value.truncated || blob.size > MAX_RAW_BYTES) throw Object.assign(new Error(), { code: "file-too-large" });
          return blob;
        }
      } catch (error) {
        if (error.code === "file-too-large") throw error;
        // no byte source
      }
    }
    return undefined;
  };

  /** Write a copy somewhere else, with a real Save-As dialog when the browser has one. */
  const saveAs = async (file) => {
    if (typeof window.showSaveFilePicker === "function") {
      let handle;
      try {
        handle = await window.showSaveFilePicker({ suggestedName: file.name });
      } catch (error) {
        if (error !== null && typeof error === "object" && error.name === "AbortError") {
          return { cancelled: true };
        }
        handle = undefined;
      }
      if (handle !== undefined) {
        const blob = await fetchBytes(file);
        if (blob === undefined) return { failed: true };
        let writable;
        try {
          writable = await handle.createWritable();
          await writable.write(blob);
          await writable.close();
          return { path: handle.name };
        } catch {
          try { await writable?.abort?.(); } catch { /* preserve the original write failure */ }
          return { failed: true };
        }
      }
    }

    const picker = remotes.directoryPicker;
    // Never call an older host's save-as endpoint: it silently overwrites files.
    const probe = typeof host.probe === "function" ? await host.probe() : { available: false };
    if (probe.code === "unauthorized" || probe.code === "permission-denied") throw Object.assign(new Error(), { code: probe.code });
    if (probe.available && probe.capabilities?.includes("exclusive-save") && picker !== undefined && typeof picker.pick === "function") {
      let directory;
      let pickerFailed = false;
      try {
        const answer = await picker.pick(new AbortController().signal);
        if (answer?.ok === false) throw new Error("Directory picker unavailable");
        directory = typeof answer === "string" || answer === null ? answer : unwrap(answer);
      } catch (error) {
        if (error.name === "AbortError") return { cancelled: true };
        pickerFailed = true;
        directory = undefined;
      }
      if (!pickerFailed && (directory === null || directory === undefined)) return { cancelled: true };
      if (typeof directory === "string" && directory !== "") {
        const destination = joinPath(directory, file.name);
        try {
          const written = await host.post("/save-as", { from: file.absolutePath, to: destination });
          if (written !== undefined) return { path: written.path ?? destination };
        } catch (error) {
          if (error.code !== "destination-exists") throw error;
          const conflict = await requestDialog({ type: "conflict", path: destination });
          if (!conflict) return { cancelled: true };
          const written = await host.post("/save-as", { from: file.absolutePath, to: destination, conflict });
          if (written !== undefined) return { path: written.path ?? destination };
        }
      }
    }

    // Last resort: a browser download. Chromium in the desktop shell saves it
    // to the configured download folder without leaving the page.
    const blob = await fetchBytes(file);
    if (blob === undefined) return { failed: true };
    try {
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = file.name;
      anchor.style.display = "none";
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      return { downloaded: true, path: file.name };
    } catch {
      return { failed: true };
    }
  };

  /**
   * Open a link the way a left click would: the anchor's own handler honors
   * the rest of DSH's link behaviour, so clicking it is better than guessing.
   * Used for destinations the window-open handler refuses, such as `mailto:`.
   */
  const openLink = (target) => {
    const anchor = target.anchor;
    if (anchor !== undefined && document.contains(anchor)) {
      try {
        anchor.click();
        return true;
      } catch {
        // fall through
      }
    }
    try {
      window.open(target.href, "_blank", "noopener,noreferrer");
      return true;
    } catch {
      return false;
    }
  };

  /** Open an HTTP(S) link in the right Sidebar's browser tab. */
  const openLinkInSidebar = (target) => {
    if (target.sidebarBrowser !== true) return false;
    const right = ctx.get("sidebarRight");
    if (right === undefined || typeof right.openTab !== "function") return false;
    try {
      right.openTab("browser", { params: { url: target.href } });
      return true;
    } catch {
      return false;
    }
  };

  /**
   * Open an HTTP(S) link in the system's default browser. The Desktop window
   * turns a renderer `window.open` into `shell.openExternal`, so only a throw
   * is a failure; otherwise fall back to the anchor.
   */
  const openLinkExternally = (target) => {
    if (target.scheme !== "http:" && target.scheme !== "https:") return openLink(target);
    try {
      window.open(target.href, "_blank", "noopener,noreferrer");
      return true;
    } catch {
      return openLink(target);
    }
  };

  /** Run one selected row against the menu's captured target. */
  const run = async (id) => {
    const menu = store.get().menu;
    if (menu === null) return;
    const target = menu.target;
    const file = target.file;
    if (id === "settings") { closeMenu(); openSettings(menu.apps); return; }
    if (id === "diagnostics") { closeMenu(); await diagnose(); return; }

    if (
      id === "header" ||
      id === "no-desktop" ||
      id.startsWith("sep-") ||
      id === "open-with"
    ) {
      return;
    }

    if (id.startsWith("app:")) {
      if (file === undefined) return;
      closeMenu();
      const opened = await openPath(file, "open", id.slice(4));
      notify(opened ? t("notice.opened") : t("notice.openFailed"), opened ? "success" : "error");
      return;
    }

    if (id === "open-link") {
      closeMenu();
      const opened = openLink(target);
      notify(opened ? t("notice.openedLink") : t("notice.linkFailed"), opened ? "success" : "error");
      return;
    }
    if (id === "open-link-sidebar") {
      closeMenu();
      const opened = openLinkInSidebar(target);
      notify(opened ? t("notice.openedSidebar") : t("notice.linkFailed"), opened ? "success" : "error");
      return;
    }
    if (id === "open-link-external") {
      closeMenu();
      const opened = openLinkExternally(target);
      notify(opened ? t("notice.openedExternal") : t("notice.linkFailed"), opened ? "success" : "error");
      return;
    }
    if (id === "copy-link") {
      closeMenu();
      const copied = await P.writeClipboard(target.href);
      notify(
        copied ? t("notice.copied", { what: t("what.link") }) : t("notice.copyFailed"),
        copied ? "success" : "error"
      );
      return;
    }
    if (id === "copy-link-text") {
      closeMenu();
      const copied = await P.writeClipboard(target.text ?? "");
      notify(
        copied ? t("notice.copied", { what: t("what.linkText") }) : t("notice.copyFailed"),
        copied ? "success" : "error"
      );
      return;
    }
    if (id === "copy-markdown") {
      closeMenu();
      const label = target.text === undefined || target.text === "" ? target.href : target.text;
      const escaped = label.replace(/[\\[\]]/g, char => `\\${char}`).replace(/\r?\n/g, " ");
      const destination = target.href.replace(/[<>\r\n]/g, char => encodeURIComponent(char));
      const copied = await P.writeClipboard(`[${escaped}](<${destination}>)`);
      notify(
        copied ? t("notice.copied", { what: t("what.markdown") }) : t("notice.copyFailed"),
        copied ? "success" : "error"
      );
      return;
    }

    if (file === undefined) return;

    switch (id) {
      case "preview": {
        closeMenu();
        if (!openInDsh(file)) notify(t("notice.previewUnavailable"), "error");
        return;
      }
      case "open-default": {
        closeMenu();
        const wanted = preferences().defaultApplication;
        const apps = Array.isArray(menu.apps) ? menu.apps : [];
        // Keep the action consistent with the label: a removed preferred app
        // falls back to the system default target, not to the OS default.
        const preferred = wanted
          ? apps.find(app => app.id === wanted) ?? apps.find(app => app.default === true)
          : undefined;
        const opened = await openPath(file, "open", preferred?.id);
        notify(opened ? t("notice.opened") : t("notice.openFailed"), opened ? "success" : "error");
        return;
      }
      case "reveal": {
        closeMenu();
        const revealed = await openPath(file, "reveal");
        notify(revealed ? t("notice.revealed") : t("notice.openFailed"), revealed ? "success" : "error");
        return;
      }
      case "copy-path": {
        closeMenu();
        const copied = await P.writeClipboard(formatPath(file.absolutePath, preferences()));
        notify(
          copied ? t("notice.copied", { what: t("what.path") }) : t("notice.copyFailed"),
          copied ? "success" : "error"
        );
        return;
      }
      case "copy-relative": {
        closeMenu();
        const copied = await P.writeClipboard(formatPath(file.relativePath ?? file.absolutePath, preferences()));
        notify(
          copied ? t("notice.copied", { what: t("what.relative") }) : t("notice.copyFailed"),
          copied ? "success" : "error"
        );
        return;
      }
      case "copy-name": {
        closeMenu();
        const copied = await P.writeClipboard(file.name);
        notify(
          copied ? t("notice.copied", { what: t("what.name") }) : t("notice.copyFailed"),
          copied ? "success" : "error"
        );
        return;
      }
      case "copy-location": {
        closeMenu();
        const path = formatPath(file.relativePath ?? file.absolutePath, preferences());
        const copied = await P.writeClipboard(`${path}:${file.line ?? 1}:${file.column ?? 1}`);
        notify(t(copied ? "notice.copiedLocation" : "notice.copyFailed"), copied ? "success" : "error");
        return;
      }
      case "open-location": {
        closeMenu();
        const apps = Array.isArray(menu.apps) ? menu.apps : [];
        const preferred = apps.find(app => app.id === preferences().defaultApplication);
        const app = preferred && editorScheme(preferred) ? preferred : apps.find(app => app.default && editorScheme(app)) ?? apps.find(app => editorScheme(app));
        const scheme = editorScheme(app);
        if (!scheme) { notify(t("notice.noLineEditor"), "error"); return; }
        const probe = await host.probe();
        if (!probe.available || !probe.capabilities?.includes("editor-location")) { notify(t("notice.hostUnavailable"), "error"); return; }
        const result = await host.post("/open-location", { path: file.absolutePath, line: file.line, column: file.column ?? 1, editor: scheme });
        if (result?.opened !== true) { notify(t("notice.openFailed"), "error"); return; }
        notify(t("notice.opened"), "success");
        return;
      }
      case "copy-contents": {
        closeMenu();
        const contents = await readContents(file);
        if (contents === undefined || contents.binary === true) {
          notify(t("notice.readFailed"), "error");
          return;
        }
        const copied = await P.writeClipboard(contents.text);
        const noticeKey =
          contents.truncated === true ? "notice.copiedContentsTruncated" : "notice.copiedContents";
        notify(
          copied
            ? t(noticeKey, {
                size: sizeText(contents.size ?? contents.text.length)
              })
            : t("notice.copyFailed"),
          copied ? "success" : "error"
        );
        return;
      }
      case "save-as": {
        closeMenu();
        const outcome = await saveAs(file);
        if (outcome.cancelled === true) notify(t("notice.saveCancelled"));
        else if (outcome.failed === true) notify(t("notice.saveFailed"), "error");
        else if (outcome.downloaded === true) notify(t("notice.downloadStarted"), "success");
        else notify(t("notice.saved", { path: outcome.path }), "success");
        return;
      }
      default:
        return;
    }
  };

  const safeRun = async id => {
    try { await run(id); }
    catch (error) { if (error.name !== "AbortError") notify(t(errorKey(error)), "error"); }
  };
  const resetCapabilities = () => { desktopResolved = false; desktopPromise = undefined; appCache.clear(); };
  return { run: safeRun, loadApplications, loadDesktop, loadAppList, knownDesktop, openInDsh, openPath, resetCapabilities };
}
