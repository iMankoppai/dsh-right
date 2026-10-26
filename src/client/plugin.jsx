import * as P from "@deepseek-ai/dsh-client-ui-primitives";
import { LOCALE_NS, OVERLAY_ORDER, PLUGIN_ID } from "../shared/constants.js";
import { isAbsolutePath, joinPath, relativeTo, separatorOf, withSeparator } from "../shared/paths.js";
import { createActions, errorKey } from "./actions.js";
import { createHostApi } from "./api.js";
import { createContextResolver } from "./context.js";
import { en, zh } from "./i18n.js";
import { FileContextMenu } from "./menu.jsx";
import { MENU_CSS } from "./menu-styles.js";
import { createRemotes } from "./remotes.js";
import { createResolver, makeFile } from "./resolver.js";
import { createStore } from "./store.js";
import { loadSettings, normalizeSettings, saveSettings } from "./settings.js";
import { SettingsPage } from "./settings-page.jsx";
import { candidateAtPoint, classifyToken } from "./text.js";

export const inject = ["slots", "locale"];

export function apply(ctx) {
  ctx.effect(() => ctx.locale.register(LOCALE_NS, { zh, en }), `${PLUGIN_ID}: dictionaries`);
  ctx.effect(() => {
    const style = document.createElement("style");
    style.dataset.dshRight = "menu";
    style.textContent = MENU_CSS;
    document.head.append(style);
    return () => style.remove();
  }, `${PLUGIN_ID}: menu styles`);

  const t = ctx.locale.bind(LOCALE_NS);
  const store = createStore();
  store.set({ ...store.get(), settings: loadSettings(), dialog: null });
  const host = createHostApi();
  const remotes = createRemotes(ctx);
  const context = createContextResolver(ctx);
  const resolver = createResolver({
    host,
    remotes,
    // A link can point at another Session's file; that Session's cwd is what
    // relative directory listings need.
    contextForSession: sessionId => ({ sessionId, cwd: context.sessionRow(sessionId)?.cwd })
  });
  let pending = 0;
  let noticeSeq = 0;
  let dialogSeq = 0;
  /** Last successfully loaded file-association list, for the Settings page. */
  let knownApps = [];
  let controller = new AbortController();
  let resolveDialog;
  let focusTarget;

  const notify = (text, tone) => store.set({ ...store.get(), notice: { id: `dsh-right-notice-${++noticeSeq}`, text, tone } });
  const finishDialog = value => {
    const settle = resolveDialog;
    resolveDialog = undefined;
    store.set({ ...store.get(), dialog: null });
    settle?.(value);
  };
  const requestDialog = spec => {
    finishDialog(null);
    return new Promise(resolve => {
      resolveDialog = resolve;
      store.set({ ...store.get(), dialog: { ...spec, restoreFocus: focusTarget, id: ++dialogSeq } });
    });
  };
  const invalidate = () => {
    pending += 1;
    controller.abort();
    controller = new AbortController();
    if (store.get().dialog?.type === "choices") finishDialog(null);
  };
  const closeMenu = () => {
    invalidate();
    const current = store.get();
    if (current.menu !== null) store.set({ ...current, menu: null, seq: current.seq + 1 });
  };
  const openSettings = apps => { void requestDialog({ type: "settings", apps: apps ?? [] }); };
  /** Shared by the in-menu dialog and the Settings page. */
  const applySettings = value => {
    const settings = normalizeSettings(value);
    const persisted = saveSettings(settings);
    store.set({ ...store.get(), settings });
    return persisted;
  };
  const updateSettings = value => {
    const persisted = applySettings(value);
    finishDialog(null);
    notify(t(persisted ? "notice.settingsSaved" : "notice.settingsTemporary"), persisted ? "success" : "error");
  };
  const diagnose = async () => {
    void requestDialog({ type: "diagnostics", loading: true });
    const id = store.get().dialog.id;
    actions.resetCapabilities();
    const [probe, desktop] = await Promise.all([host.probe(), actions.loadDesktop()]);
    if (store.get().dialog?.id !== id) return;
    store.set({ ...store.get(), dialog: { ...store.get().dialog, loading: false, probe, desktop, files: !!remotes.files, picker: !!remotes.directoryPicker, browser: context.sidebarBrowserAvailable() } });
  };
  const actions = createActions({ ctx, remotes, host, store, t, notify, closeMenu, P, requestDialog, openSettings, diagnose });
  /** The Settings page owns diagnostics; no overlay dialog is needed there. */
  const getDiagnostics = async () => {
    actions.resetCapabilities();
    const [probe, desktop] = await Promise.all([host.probe(), actions.loadDesktop()]);
    return {
      probe,
      desktop,
      files: !!remotes.files,
      picker: !!remotes.directoryPicker,
      browser: context.sidebarBrowserAvailable()
    };
  };

  const present = (event, target) => {
    const token = ++pending;
    const seq = store.get().seq + 1;
    const bounds = focusTarget?.getBoundingClientRect?.();
    const rect = event.clientX || event.clientY ? { x: event.clientX, y: event.clientY } : { x: bounds?.left ?? 0, y: bounds?.bottom ?? 0 };
    store.set({ ...store.get(), seq, menu: { seq, rect, target, desktop: actions.knownDesktop(), apps: undefined } });
    if (!target.file) return;
    void (async () => {
      const desktop = await actions.loadDesktop();
      if (token !== pending || store.get().menu?.target !== target) return;
      store.set({ ...store.get(), menu: { ...store.get().menu, desktop } });
      if (!desktop) return;
      const apps = await actions.loadAppList(target.file);
      if (token !== pending || store.get().menu?.target !== target) return;
      knownApps = apps;
      store.set({ ...store.get(), menu: { ...store.get().menu, apps } });
    })().catch(error => { if (token === pending) notify(t(errorKey(error)), "error"); });
  };

  const treeTarget = row => {
    const path = row.getAttribute("data-files-path");
    if (!path) return undefined;
    const root = row.closest("[data-files-state='tree']")?.getAttribute("data-files-root") ?? undefined;
    const separator = separatorOf(root ?? path);
    const absolutePath = isAbsolutePath(path) ? withSeparator(path, separator) : root === undefined ? path : joinPath(root, path);
    const owner = context.contextOfSafe(row);
    return { type: "file", file: makeFile({ absolutePath, kind: row.getAttribute("data-files-entry"), sessionId: owner?.sessionId, cwd: owner?.cwd ?? root, relativePath: relativeTo(root ?? owner?.cwd, absolutePath), rowButton: row.querySelector("button") ?? undefined }) };
  };

  const resolveAndPresent = async (event, resolve, token, signal, notFoundLabel) => {
    try {
      let target = await resolve(signal);
      if (token !== pending || signal.aborted) return;
      while (target?.type === "choices") {
        const choice = await requestDialog({ type: "choices", choices: target.choices });
        if (token !== pending || signal.aborted || !choice) return;
        const link = target.link;
        target = await resolver.resolveToken(target.context, { ...target.location, path: choice }, signal);
        if (link && target?.file) target = { ...link, file: target.file };
        if (token !== pending || signal.aborted) return;
      }
      if (target) present(event, target);
      else notify(t("notice.notFound", { path: notFoundLabel || t("what.file") }), "error");
    } catch (error) {
      if (token === pending && !signal.aborted && error.name !== "AbortError") notify(t(errorKey(error)), "error");
    }
  };

  const onContextMenu = event => {
    try {
      const raw = event.target;
      const element = raw instanceof Element ? raw : raw instanceof Node ? raw.parentElement : null;
      if (!element || element.closest(".dsh-right-dialog")) return;
      closeMenu(); // Also cancels a lookup when the next right-click uses the native menu.
      focusTarget = element.closest("button, a, [tabindex]") ?? document.activeElement;
      if (event.shiftKey || element.closest("[role='menu'], input, textarea, [contenteditable]:not([contenteditable='false']), [data-json-copy-button], [data-files-reload], [data-files-auto-refresh]")) return;
      const row = element.closest("[data-files-path][data-files-entry]");
      if (row) {
        const target = treeTarget(row);
        if (!target) return;
        event.preventDefault(); event.stopPropagation(); present(event, target); return;
      }
      const owner = context.contextOfSafe(element);
      const anchor = element.closest("a[href]");
      let resolve;
      let notFoundLabel = "";
      if (anchor) {
        const href = anchor.getAttribute("href") ?? "";
        let url;
        try { url = new URL(href, document.baseURI); } catch { return; }
        if (!href || href.startsWith("#") || !["http:", "https:", "mailto:", "tel:", "file:", "dsh-resource:"].includes(url.protocol)) return;
        notFoundLabel = (anchor.textContent ?? "").trim() || href;
        resolve = signal => resolver.resolveLink(anchor, { context: owner, sidebarBrowser: context.sidebarBrowserAvailable() }, signal);
      } else {
        const mention = element.closest("button[title]");
        const described = mention?.closest("[data-conversation-session], [data-sidebar-right-session]") ? classifyToken((mention.title ?? "").trim(), false, true) : undefined;
        const candidate = described ?? candidateAtPoint(event);
        if (!candidate) return;
        notFoundLabel = candidate.path;
        resolve = signal => resolver.resolveToken(owner, candidate, signal);
      }
      event.preventDefault(); event.stopPropagation();
      void resolveAndPresent(event, resolve, pending, controller.signal, notFoundLabel);
    } catch (error) { console.error("dsh-right: context menu failed", error); }
  };

  ctx.effect(() => {
    const onPointer = event => {
      if (!(event.target instanceof Element) || event.target.closest("[role='menu'], .dsh-right-dialog")) return;
      closeMenu();
    };
    const onKey = event => { if (event.key === "Escape" && !store.get().dialog) closeMenu(); };
    const onStorage = event => {
      if (event.key === "dsh-right.settings.v1" || event.key === null) store.set({ ...store.get(), settings: loadSettings() });
    };
    const onBlur = () => closeMenu();
    document.addEventListener("contextmenu", onContextMenu, true);
    document.addEventListener("pointerdown", onPointer, true);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("blur", onBlur);
    window.addEventListener("storage", onStorage);
    let unsubscribe;
    try {
      const current = ctx.get("uiSession")?.adapter?.current;
      let key = current?.getSnapshot?.()?.key;
      unsubscribe = current?.subscribe?.(() => {
        const snapshot = current.getSnapshot();
        const next = snapshot?.key ?? snapshot?.props?.sessionId;
        if (key !== next) { key = next; closeMenu(); }
      });
    } catch { /* optional host service */ }
    return () => {
      document.removeEventListener("contextmenu", onContextMenu, true);
      document.removeEventListener("pointerdown", onPointer, true);
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("storage", onStorage);
      unsubscribe?.();
      invalidate(); controller.abort(); finishDialog(null);
      store.set({ ...store.get(), menu: null });
    };
  }, `${PLUGIN_ID}: listeners`);

  ctx.effect(
    () =>
      ctx.slots.inject("settings.section", () =>
        ctx.slots.register(
          {
            name: "settings.section",
            id: PLUGIN_ID,
            order: 18,
            label: () => t("settingsPage.nav"),
            locale: LOCALE_NS,
            inject: () => ({
              settingsStore: store,
              applySettings,
              getApps: () => knownApps,
              getDiagnostics
            })
          },
          SettingsPage
        )
      ),
    `${PLUGIN_ID}: settings page`
  );

  // The settings shell hard-codes a glyph per section id and falls back to the
  // gear for unknown ids. Mark our nav row and let the stylesheet swap the
  // glyph without touching the shell's React tree.
  ctx.effect(() => {
    const labels = new Set([zh["settingsPage.nav"], en["settingsPage.nav"]]);
    let scheduled = false;
    const mark = () => {
      scheduled = false;
      for (const button of document.querySelectorAll("button")) {
        if (button.dataset.dshRightNav === "1") continue;
        if (!labels.has((button.textContent ?? "").trim())) continue;
        if (button.querySelector("svg") === null) continue;
        button.dataset.dshRightNav = "1";
      }
    };
    const schedule = () => {
      if (scheduled) return;
      scheduled = true;
      if (typeof requestAnimationFrame === "function") requestAnimationFrame(mark);
      else setTimeout(mark, 0);
    };
    const containsLabel = (node) => {
      if (!(node instanceof Element)) return false;
      const text = node.textContent ?? "";
      for (const label of labels) if (text.includes(label)) return true;
      return false;
    };
    const observer =
      typeof MutationObserver === "function"
        ? new MutationObserver((records) => {
            // Once our row is marked, ignore unrelated DOM churn until it is
            // removed (the user closed Settings).
            if (document.querySelector("button[data-dsh-right-nav]") !== null) return;
            for (const record of records) {
              for (const node of record.addedNodes) {
                if (containsLabel(node)) {
                  schedule();
                  return;
                }
              }
            }
          })
        : undefined;
    observer?.observe(document.body, { childList: true, subtree: true });
    schedule();
    return () => {
      observer?.disconnect();
      for (const button of document.querySelectorAll("button[data-dsh-right-nav]")) {
        delete button.dataset.dshRightNav;
      }
    };
  }, `${PLUGIN_ID}: settings nav icon`);

  ctx.effect(() => ctx.slots.inject("shell.overlay", () => ctx.slots.register({ name: "shell.overlay", id: PLUGIN_ID, order: OVERLAY_ORDER, locale: LOCALE_NS, inject: () => ({ open: store, run: actions.run, closeMenu, finishDialog, updateSettings, diagnose, t }) }, FileContextMenu)), `${PLUGIN_ID}: overlay occupant`);
}
