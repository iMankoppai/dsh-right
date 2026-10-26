import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { JSDOM } from "jsdom";
import { buildItems } from "../src/client/menu-model.js";

const require = createRequire(import.meta.url);
const React = require("react");

const dom = new JSDOM(
  `<!doctype html><html><body>
    <div data-conversation-session="s1">
      <p id="msg">见 src/index.ts 这个文件</p>
      <a id="link" href="dsh-resource://file/session/s1/foo.md">foo.md</a>
      <a id="web" href="https://example.com/docs">docs</a>
      <div data-files-state="tree" data-files-root="C:\\ws">
        <div id="row" data-files-path="src\\index.ts" data-files-entry="file"><button id="rowbutton">open</button></div>
      </div>
      <button id="mention" title="src/index.ts">index.ts</button>
      <button id="dirmention" title="plugins-src/dsh-computer-use-native">dsh-computer-use-native</button>
    </div>
    <div id="outside">ordinary text</div>
  </body></html>`,
  { url: "http://127.0.0.1:56228/" }
);

globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.Node = dom.window.Node;
globalThis.Element = dom.window.Element;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Event = dom.window.Event;
globalThis.MouseEvent = dom.window.MouseEvent;

const clipboard = [];
const icon = () => React.createElement("span");

const primitives = {
  Menu: (props) =>
    React.createElement(
      "div",
      { "data-menu": "1" },
      props.items.map((item) =>
        React.createElement(
          "div",
          { key: item.id, "data-item": item.id },
          item.label ?? item.text ?? ""
        )
      )
    ),
  Toast: (props) => React.createElement("div", { "data-toast": props.text }),
  FileTypeIcon: () => React.createElement("span", { "data-file-icon": "1" }),
  classifyFileType: () => "text",
  writeClipboard: async (text) => {
    clipboard.push(text);
    return true;
  },
  IconPanelLeftOutlineRegular: icon,
  IconRightUpOutlineRegular: icon,
  IconLinkOutlineRegular: icon,
  IconCopyOutlineRegular: icon,
  IconCodeOutlineRegular: icon,
  IconBrowseOutlineRegular: icon,
  IconDownloadOutlineRegular: icon,
  IconWarningOutlineRegular: icon
};

globalThis.fetch = async (url) => {
  const text = String(url);
  if (text.startsWith("/dsh-right/stat")) {
    return { ok: false, status: 404, json: async () => ({}) };
  }
  if (text.startsWith("/dsh-right/read")) {
    return {
      ok: true,
      status: 200,
      json: async () => ({ text: "host text", binary: false, truncated: false, size: 9 })
    };
  }
  if (text.startsWith("/dsh-right/raw")) {
    return { ok: true, status: 200, blob: async () => new Blob(["raw"]) };
  }
  return { ok: false, status: 404, json: async () => ({}) };
};

let registration;
dom.window.__ModuleLoader__ = {
  load(next) {
    registration = next;
  }
};

await import(pathToFileURL(path.resolve("lib/client.js")).href);
assert.ok(registration, "the bundle registers a module factory");

function requireShim(name) {
  if (name === "react") return React;
  if (name === "react/jsx-runtime") return require("react/jsx-runtime");
  if (name === "@deepseek-ai/dsh-client-ui-primitives") return primitives;
  throw new Error(`unexpected require: ${name}`);
}

const client = registration.factory(requireShim);
assert.equal(typeof client.apply, "function");
assert.deepEqual(client.inject, ["slots", "locale"]);

function interpolate(template, params) {
  if (params === undefined) return template;
  return template.replace(/\{(\w+)\}/g, (_, key) => String(params[key] ?? `{${key}}`));
}

let disposeHarness = () => {};
function makeHarness({ currentSession } = {}) {
  disposeHarness();
  const disposers = [];
  const opened = [];
  const remotes = {
    session: {
      canOpenWorkspacePath: async () => ({ ok: true, value: true }),
      workspacePathApplications: async () => ({
        ok: true,
        value: [
          { id: "vscode", name: "Visual Studio Code", default: true },
          { id: "notepad", name: "Notepad", default: false }
        ]
      }),
      openWorkspacePath: async (request) => {
        opened.push(request);
        return { ok: true, value: { opened: true } };
      }
    },
    workspaceFiles: {
      stat: async (_sessionId, filePath) => {
        if (filePath === "src/index.ts" || filePath === "src\\index.ts") {
          return { ok: true, value: { absolutePath: "C:/ws/src/index.ts" } };
        }
        if (filePath === "foo.md") {
          return { ok: true, value: { absolutePath: "C:/ws/foo.md" } };
        }
        return { ok: false, error: { code: "workspace-file/not-found" } };
      },
      list: async (_sessionId, filePath) => {
        if (filePath === "plugins-src/dsh-computer-use-native") {
          return { ok: true, value: { path: filePath, entries: [], truncated: false } };
        }
        return { ok: false, error: { code: "workspace-file/not-directory" } };
      },
      read: async () => ({ ok: true, value: { text: "remote text", lines: 1, eof: true, bytes: 11 } }),
      readBytes: async () => ({ ok: false })
    },
    fileReferences: {
      list: async () => ({ ok: true, value: [{ path: "src/index.ts", kind: "file" }] })
    },
    directoryPicker: {
      pick: async () => "C:/tmp"
    }
  };

  const services = {
    sessions: { list: { getSnapshot: () => ({ byId: { s1: { cwd: "C:\\ws" } } }) } },
    uiSession: { adapter: { current: { getSnapshot: () => ({ key: "s1" }) } } },
    sidebarRightTabs: { get: (id) => (id === "browser" ? { id } : undefined) },
    sidebarRight: {
      openResource() {},
      openResourceIn() {},
      openTab() {},
      commandTarget: () => undefined
    }
  };

  const registrations = [];
  if (currentSession) services.uiSession.adapter.current = currentSession;
  const ctx = {
    effect(fn) {
      const dispose = fn();
      if (typeof dispose === "function") disposers.push(dispose);
      return dispose;
    },
    inject(deps, callback) {
      if (deps[0] === "remote") {
        const namespace = deps[1].slice("remote.".length);
        callback({ remote: { [namespace]: remotes[namespace] } });
        return;
      }
      callback({});
    },
    locale: {
      register() {},
      bind() {
        return (key, params) => interpolate(key, params);
      }
    },
    slots: {
      inject(_name, fn) {
        return fn();
      },
      register(spec, component) {
        registrations.push({ spec, component });
        return () => {};
      }
    },
    get(name) {
      return services[name];
    }
  };

  client.apply(ctx);
  const overlay = registrations.find((entry) => entry.spec.name === "shell.overlay");
  assert.ok(overlay);
  const injected = overlay.spec.inject();

  disposeHarness = () => { for (const dispose of disposers.reverse()) dispose(); };
  return { opened, overlay, injected, remotes, services, dispose: disposeHarness };
}

const t = (key, params) => {
  const dict = {
    "menu.preview": "打开文件",
    "menu.expand": "在文件树中展开",
    "menu.openDefault": "在默认应用中打开",
    "menu.openInApp": "在{name}中打开",
    "menu.openFolder": "打开文件夹",
    "menu.openWith": "打开方式",
    "menu.reveal": "在资源管理器中打开",
    "menu.copyPath": "复制路径",
    "menu.copyRelative": "复制相对路径",
    "menu.copyName": "复制文件名",
    "menu.copyContents": "复制文件内容",
    "menu.saveAs": "另存为…",
    "menu.openLinkSidebar": "在侧边栏中打开",
    "menu.openLinkExternal": "在外部浏览器中打开",
    "menu.copyLink": "复制链接地址",
    "menu.copyLinkText": "复制链接文字",
    "menu.copyMarkdown": "复制为 Markdown 链接",
    "menu.header.file": "文件",
    "menu.header.folder": "文件夹",
    "menu.header.link": "链接"
  };
  return interpolate(dict[key] ?? key, params);
};

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function rightClick(element) {
  const event = new dom.window.MouseEvent("contextmenu", {
    bubbles: true,
    cancelable: true,
    clientX: 40,
    clientY: 20,
    button: 2
  });
  element.dispatchEvent(event);
  return event;
}

test("a file-tree row opens a menu with the expected actions", async () => {
  const { opened, injected } = makeHarness();
  const rowButton = document.getElementById("rowbutton");
  const event = rightClick(rowButton);
  assert.equal(event.defaultPrevented, true);

  const menu = injected.open.get().menu;
  assert.ok(menu);
  assert.equal(menu.target.type, "file");
  assert.equal(menu.target.file.absolutePath, "C:\\ws\\src\\index.ts");
  assert.equal(menu.target.file.relativePath, "src/index.ts");

  await tick();
  const items = buildItems(injected.open.get().menu, t);
  const labels = items.map((item) => item.label ?? item.text ?? "");
  for (const expected of [
    "打开文件",
    "在VS Code中打开",
    "打开方式",
    "在资源管理器中打开",
    "复制路径",
    "复制相对路径",
    "复制文件名",
    "复制文件内容",
    "另存为…"
  ]) {
    assert.ok(labels.includes(expected), `missing ${expected}: ${labels.join(" | ")}`);
  }

  const copyItem = items.find((item) => item.id === "copy-path");
  assert.equal(copyItem.label, "复制路径");
  await injected.run("copy-path");
  assert.equal(clipboard.at(-1), "C:\\ws\\src\\index.ts");

  // Re-open and open in the default application.
  rightClick(rowButton);
  await tick();
  await injected.run("open-default");
  assert.equal(opened.length, 1);
  assert.equal(opened[0].path, "C:\\ws\\src\\index.ts");
  assert.equal(opened[0].application, undefined);
});

test("a dsh-resource file link gets both link and file rows", async () => {
  const { injected } = makeHarness();
  const link = document.getElementById("link");
  rightClick(link);
  await tick();
  const menu = injected.open.get().menu;
  assert.ok(menu);
  assert.equal(menu.target.type, "link");
  assert.equal(menu.target.file.absolutePath, "C:/ws/foo.md");
  assert.equal(menu.target.sidebarBrowser, true);

  const items = buildItems(menu, t);
  const labels = items.map((item) => item.label ?? item.text ?? "");
  for (const expected of ["复制链接地址", "复制路径", "复制文件内容"]) {
    assert.ok(labels.includes(expected), `missing ${expected}`);
  }
});

test("a web link has link rows and no file rows", async () => {
  const { injected } = makeHarness();
  rightClick(document.getElementById("web"));
  await tick();
  const menu = injected.open.get().menu;
  assert.equal(menu.target.type, "link");
  assert.equal(menu.target.file, undefined);
  const labels = buildItems(menu, t).map((item) => item.label ?? item.text ?? "");
  assert.ok(labels.includes("在侧边栏中打开"));
  assert.ok(labels.includes("在外部浏览器中打开"));
  assert.ok(!labels.includes("复制文件内容"));
});

test("plain text with a path-shaped token resolves through the Session Remote", async () => {
  const { injected } = makeHarness();
  document.caretRangeFromPoint = () => {
    const node = document.getElementById("msg").firstChild;
    return { startContainer: node, startOffset: 7 };
  };
  const event = rightClick(document.getElementById("msg"));
  assert.equal(event.defaultPrevented, true);
  await tick();
  const menu = injected.open.get().menu;
  assert.ok(menu);
  assert.equal(menu.target.type, "file");
  assert.equal(menu.target.file.absolutePath, "C:/ws/src/index.ts");
});

test("a chat file mention resolves through its title", async () => {
  const { injected } = makeHarness();
  rightClick(document.getElementById("mention"));
  await tick();
  const menu = injected.open.get().menu;
  assert.ok(menu);
  assert.equal(menu.target.file.absolutePath, "C:/ws/src/index.ts");
});

test("a directory mention without an extension gets folder actions", async () => {
  const { injected } = makeHarness();
  rightClick(document.getElementById("dirmention"));
  await tick();
  const menu = injected.open.get().menu;
  assert.ok(menu);
  assert.equal(menu.target.type, "file");
  assert.equal(menu.target.file.kind, "directory");
  assert.equal(menu.target.file.absolutePath, "C:\\ws\\plugins-src\\dsh-computer-use-native");

  const labels = buildItems(menu, t).map((item) => item.label ?? item.text ?? "");
  assert.ok(labels.some((label) => label.startsWith("文件夹 ·")), labels.join(" | "));
  assert.ok(labels.includes("打开文件夹"), labels.join(" | "));
  assert.ok(labels.includes("复制路径"));
  assert.ok(!labels.includes("复制文件内容"));
});

test("ordinary text keeps the native context menu", () => {
  const { injected } = makeHarness();
  document.caretRangeFromPoint = () => null;
  const event = rightClick(document.getElementById("outside"));
  assert.equal(event.defaultPrevented, false);
  assert.equal(injected.open.get().menu, null);
});

test("Shift-right-click bypasses the plugin even for a file-tree row", () => {
  const { injected } = makeHarness();
  const event = new window.MouseEvent("contextmenu", { bubbles: true, cancelable: true, shiftKey: true, button: 2 });
  document.getElementById("rowbutton").dispatchEvent(event);
  assert.equal(event.defaultPrevented, false);
  assert.equal(injected.open.get().menu, null);
});

test("a newer native right-click cancels a pending file menu", async () => {
  const { injected, remotes } = makeHarness();
  let complete;
  remotes.workspaceFiles.stat = () => new Promise(resolve => { complete = resolve; });
  document.caretRangeFromPoint = () => ({ startContainer: document.getElementById("msg").firstChild, startOffset: 7 });
  rightClick(document.getElementById("msg")); await tick();
  document.caretRangeFromPoint = () => null;
  rightClick(document.getElementById("outside"));
  complete({ ok: true, value: { absolutePath: "C:/ws/src/index.ts" } });
  await tick();
  assert.equal(injected.open.get().menu, null);
});

test("Escape cancels a pending resolution", async () => {
  const { injected, remotes } = makeHarness();
  let complete;
  remotes.workspaceFiles.stat = () => new Promise(resolve => { complete = resolve; });
  rightClick(document.getElementById("mention")); await tick();
  document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  complete({ ok: true, value: { absolutePath: "C:/ws/src/index.ts" } }); await tick();
  assert.equal(injected.open.get().menu, null);
});

test("ambiguous bare filenames require choosing a full path", async () => {
  const { injected, remotes } = makeHarness();
  const mention = document.getElementById("mention");
  const old = mention.title; mention.title = "config.json";
  remotes.fileReferences.list = async () => ({ ok: true, value: [{ path: "a/config.json" }, { path: "b/config.json" }] });
  remotes.workspaceFiles.stat = async (_id, path) => path === "b/config.json" ? { ok: true, value: { absolutePath: "C:/ws/b/config.json" } } : { ok: false };
  rightClick(mention); await tick();
  assert.equal(injected.open.get().dialog.type, "choices");
  assert.equal(injected.open.get().menu, null);
  injected.finishDialog("b/config.json"); await tick();
  assert.equal(injected.open.get().menu.target.file.absolutePath, "C:/ws/b/config.json");
  mention.title = old;
});

test("session switching cancels a pending resolution", async () => {
  let snapshot = { key: "s1" }, onSession;
  const { injected, remotes } = makeHarness({ currentSession: { getSnapshot: () => snapshot, subscribe: fn => { onSession = fn; return () => {}; } } });
  let complete;
  remotes.workspaceFiles.stat = () => new Promise(resolve => { complete = resolve; });
  rightClick(document.getElementById("mention")); await tick();
  snapshot = { key: "s2" }; onSession();
  complete({ ok: true, value: { absolutePath: "C:/ws/src/index.ts" } }); await tick();
  assert.equal(injected.open.get().menu, null);
});

test("unloading a plugin removes listeners and discards pending menus", async () => {
  const { injected, remotes, dispose } = makeHarness();
  let complete;
  remotes.workspaceFiles.stat = () => new Promise(resolve => { complete = resolve; });
  rightClick(document.getElementById("mention")); await tick();
  dispose();
  complete({ ok: true, value: { absolutePath: "C:/ws/src/index.ts" } }); await tick();
  assert.equal(injected.open.get().menu, null);
  assert.equal(rightClick(document.getElementById("rowbutton")).defaultPrevented, false);
});
