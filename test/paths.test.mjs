import assert from "node:assert/strict";
import test from "node:test";
import {
  baseName,
  fileAddressFor,
  isAbsolutePath,
  joinPath,
  normalizePath,
  relativeTo,
  sessionFileAddress
} from "../src/shared/paths.js";

test("absolute paths are recognized in both spellings", () => {
  assert.equal(isAbsolutePath("/home/me/a.md"), true);
  assert.equal(isAbsolutePath("C:\\Users\\me\\a.md"), true);
  assert.equal(isAbsolutePath("C:/Users/me/a.md"), true);
  assert.equal(isAbsolutePath("\\\\server\\share\\a.md"), true);
  assert.equal(isAbsolutePath("src/a.md"), false);
  assert.equal(isAbsolutePath("./a.md"), false);
});

test("relativeTo keeps Windows comparison case-insensitive but the original casing", () => {
  assert.equal(relativeTo("C:\\Work\\App", "c:\\work\\app\\src\\Index.ts"), "src/Index.ts");
  assert.equal(relativeTo("C:\\Work\\App", "C:\\Work\\App"), "");
  assert.equal(relativeTo("C:\\Work\\App", "C:\\Other\\a.ts"), undefined);
  assert.equal(relativeTo("/home/me", "/home/me/a/b.md"), "a/b.md");
  assert.equal(relativeTo("/home/me", "/home/me-other/a.md"), undefined);
});

test("joinPath follows the directory's separator", () => {
  assert.equal(joinPath("C:\\ws", "src/index.ts"), "C:\\ws\\src\\index.ts");
  assert.equal(joinPath("/ws", "src\\index.ts"), "/ws/src/index.ts");
  assert.equal(joinPath("C:\\ws\\", "a.md"), "C:\\ws\\a.md");
});

test("baseName handles both separators and a trailing slash", () => {
  assert.equal(baseName("C:\\ws\\a.md"), "a.md");
  assert.equal(baseName("/ws/a.md"), "a.md");
  assert.equal(baseName("/ws/dir/"), "dir");
});

test("session addresses encode spaces and keep the drive colon", () => {
  assert.equal(
    sessionFileAddress("s1", "My Files/a b.md"),
    "dsh-resource://file/session/s1/My%20Files/a%20b.md"
  );
  assert.equal(
    sessionFileAddress("s1", "C:/Users/me/a.md"),
    "dsh-resource://file/session/s1/C:/Users/me/a.md"
  );
});

test("fileAddressFor relativizes paths inside the workspace", () => {
  assert.equal(
    fileAddressFor("s1", "C:\\ws", "C:\\ws\\src\\a.md"),
    "dsh-resource://file/session/s1/src/a.md"
  );
  assert.equal(
    fileAddressFor("s1", "C:\\ws", "C:\\other\\a.md"),
    "dsh-resource://file/session/s1/C:/other/a.md"
  );
  assert.equal(
    fileAddressFor("s1", "C:\\ws", "src\\a.md"),
    "dsh-resource://file/session/s1/src/a.md"
  );
});

test("normalizePath strips leading dot segments and trailing separators", () => {
  assert.equal(normalizePath(".\\src\\a.md"), "./src/a.md".replace(/^\.\//, ""));
  assert.equal(normalizePath("src\\a.md"), "src/a.md");
  assert.equal(normalizePath("src/"), "src");
});
