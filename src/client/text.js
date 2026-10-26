/**
 * Finding the file-like token under the pointer.
 *
 * A chat message can show a path three ways: a real anchor (handled before
 * this module), an inline `<code>` element, or ordinary prose. The scanner
 * below reads the token around the caret and only accepts something that
 * *could* be a path; the Host then proves the file exists before the menu
 * opens, so ordinary prose never turns into a menu.
 */
import { MAX_PATH_LENGTH } from "../shared/constants.js";
import { isAbsolutePath } from "../shared/paths.js";

/** Characters a path token may contain: separators, name characters, CJK. */
const PATH_CHAR =
  /[A-Za-z0-9_\-.\\/:@+~()\[\]{}#$%&=!,\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/;

/** Punctuation never part of a path, stripped from both ends of a raw token. */
const LEADING_JUNK = /^[\s"'`(\[{<（【《“‘]+/;
const TRAILING_JUNK = /[\s"'`)\]}>，。；：！？、）】》”’…]+$/;

/** A file-looking tail such as `.json`, `.tsx`, `.tar.gz`. */
const FILE_TAIL = /\.[A-Za-z0-9]{1,8}$/;

/** A stem carrying a letter or a CJK word, so `1.2` is not read as a file. */
const STEM_LETTER = /[A-Za-z\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/;

/** Editor locations, without confusing the Windows drive colon with a line. */
export function splitLocation(value) {
  const match = value.match(/^(.*?)(?::([1-9]\d*)(?::([1-9]\d*))?|#L([1-9]\d*)(?:C([1-9]\d*))?)$/);
  if (!match) return { path: value };
  const line = Number(match[2] ?? match[4]);
  const column = Number(match[3] ?? match[5] ?? 1);
  if (!Number.isSafeInteger(line) || !Number.isSafeInteger(column)) return { path: value };
  return { path: match[1], line, column };
}

/** Whether a bare token reads as a file name (`production.json`, `README.md`). */
export function looksLikeFileName(token) {
  if (!FILE_TAIL.test(token)) return false;
  return STEM_LETTER.test(token.slice(0, token.lastIndexOf(".")));
}

/** The text node and offset under a viewport point, when the point is over text. */
function caretAt(x, y) {
  if (typeof document.caretPositionFromPoint === "function") {
    const position = document.caretPositionFromPoint(x, y);
    if (position !== null && position.offsetNode !== null) {
      return { node: position.offsetNode, offset: position.offset };
    }
  }
  if (typeof document.caretRangeFromPoint === "function") {
    const range = document.caretRangeFromPoint(x, y);
    if (range !== null) return { node: range.startContainer, offset: range.startOffset };
  }
  return null;
}

/** The contiguous token around an offset inside one text node. */
function tokenAround(text, offset) {
  let start = offset;
  let end = offset;
  while (start > 0 && PATH_CHAR.test(text[start - 1])) start -= 1;
  while (end < text.length && PATH_CHAR.test(text[end])) end += 1;
  return text.slice(start, end);
}

/** The content of a quoted path the offset sits inside, when there is one. */
function quotedAround(text, offset) {
  for (const quote of ['"', "'"]) {
    const before = text.lastIndexOf(quote, Math.max(0, offset - 1));
    if (before === -1) continue;
    const after = text.indexOf(quote, offset);
    if (after === -1) continue;
    const inner = text.slice(before + 1, after);
    if (inner === "" || inner.length > MAX_PATH_LENGTH || inner.includes("\n")) continue;
    return inner;
  }
  return undefined;
}

/**
 * A path-shaped token with at least two segments (or a trailing separator).
 *
 * Directory paths often have no extension (`plugins-src/dsh-computer-use-native`),
 * so they need to pass the same gate as `src/index.ts`. The Host still proves
 * existence before the menu opens, so a false positive only costs a toast.
 */
function looksLikePathToken(token) {
  if (!/[\\/]/.test(token)) return false;
  const segments = token.split(/[\\/]+/).filter((segment) => segment !== "");
  if (segments.length < 2 && !/[\\/]$/.test(token)) return false;
  return segments.some((segment) => /[A-Za-z0-9_\-.~\u4e00-\u9fff]{2,}/.test(segment));
}

/**
 * Decide whether a raw token is a file path worth offering a menu for.
 * `inCode` marks a token that sits inside code markup, which accepts a wider
 * range: a path is verified against the Host before the menu opens, so the
 * gate here only keeps ordinary prose out.
 *
 * @returns `{ path, absolute }` or undefined.
 */
export function classifyToken(raw, inCode, allowSpaces = false) {
  const location = splitLocation(raw.replace(LEADING_JUNK, "").replace(TRAILING_JUNK, ""));
  const token = location.path;
  if (token.length < 2 || token.length > MAX_PATH_LENGTH) return undefined;
  // A quoted path may contain spaces; unquoted prose must not.
  if (!allowSpaces && /\s/u.test(token)) return undefined;
  if (token.includes("://")) return undefined;

  // Function calls/operators and normal code aren't path candidates.
  if (/[\r\n\t]|[;=<>|]/.test(token) || /[(){}]/.test(token) && !allowSpaces) return undefined;
  const result = absolute => ({ ...location, absolute });
  if (isAbsolutePath(token)) return result(true);

  const separated = /[\\/]/.test(token);
  if (
    separated &&
    (FILE_TAIL.test(token) || /^\.{1,2}[\\/]/.test(token) || looksLikePathToken(token))
  ) {
    return result(false);
  }
  if (looksLikeFileName(token) && !/[():{}]/.test(token)) return result(false);
  if (inCode && /^(?:README|LICENSE|Dockerfile|Makefile|\.env(?:\.[\w-]+)?|\.gitignore)$/i.test(token)) return result(false);
  return undefined;
}

/** Whether an element is rendered as code, where bare file names are meaningful. */
function isCodeElement(element) {
  if (element === null || element === undefined) return false;
  return element.closest("code, pre, [data-code-block]") !== null;
}

/**
 * The path-shaped candidate under a pointer event: the inline code element
 * under the pointer first (highlighting may split a path across spans, so
 * the element's whole text is read), then the caret's token including a
 * quoted path, then an explicit selection.
 *
 * @returns `{ path, absolute }` or undefined when nothing path-shaped was found.
 */
export function candidateAtPoint(event) {
  const target = event.target instanceof Element ? event.target : null;
  if (target === null) return undefined;

  // Inputs and editable surfaces keep their native text menu.
  if (target.closest("input, textarea, [contenteditable='true'], [contenteditable='']")) {
    return undefined;
  }

  const code = target.closest("code");
  if (code !== null) {
    const whole = classifyToken(code.textContent ?? "", true, true);
    if (whole !== undefined) return whole;
  }

  const caret = caretAt(event.clientX, event.clientY);
  if (caret !== null && caret.node.nodeType === 3) {
    const text = caret.node.data;
    const inCode = isCodeElement(caret.node.parentElement);
    const quoted = quotedAround(text, caret.offset);
    if (quoted !== undefined) {
      const picked = classifyToken(quoted, inCode, true);
      if (picked !== undefined) return picked;
    }
    const picked = classifyToken(tokenAround(text, caret.offset), inCode);
    if (picked !== undefined) return picked;
    return undefined;
  }

  const selection = window.getSelection();
  const selected = selection === null ? "" : selection.toString().trim();
  if (selected !== "" && selected.length < MAX_PATH_LENGTH && !selected.includes("\n")) {
    const picked = classifyToken(selected, isCodeElement(target));
    if (picked !== undefined) return picked;
  }
  return undefined;
}
