import { spawn } from "node:child_process";
import { encodePath } from "../shared/paths.js";

/** Only known editor protocols; never interpolate a path into shell source. */
export function editorUrlFor(path, line, column = 1, editor = "vscode") {
  if (!["vscode", "vscode-insiders"].includes(editor)) throw new Error("unsupported editor");
  if (!Number.isSafeInteger(line) || line < 1 || !Number.isSafeInteger(column) || column < 1) throw new Error("invalid location");
  const normalized = path.replace(/\\/g, "/").replace(/^\//, "");
  return `${editor}://file/${encodePath(normalized)}:${line}:${column}`;
}

export function openEditorLocation(path, line, column, editor, { launch = spawn, platform = process.platform } = {}) {
  const uri = editorUrlFor(path, line, column, editor);
  const executable = platform === "win32" ? "rundll32.exe" : platform === "darwin" ? "open" : "xdg-open";
  const args = platform === "win32" ? ["url.dll,FileProtocolHandler", uri] : [uri];
  return new Promise((resolve, reject) => {
    const child = launch(executable, args, { shell: false, windowsHide: true, stdio: "ignore" });
    const timer = setTimeout(() => { child.kill(); reject(Object.assign(new Error("editor launch timed out"), { code: "timeout" })); }, 10000);
    child.once("error", () => { clearTimeout(timer); reject(Object.assign(new Error("editor unavailable"), { code: "editor-unavailable" })); });
    child.once("exit", code => {
      clearTimeout(timer);
      if (code === 0) resolve(); else reject(Object.assign(new Error("editor launch failed"), { code: "editor-unavailable" }));
    });
  });
}
