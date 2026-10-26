import assert from "node:assert/strict";
import test from "node:test";
import { classifyToken, looksLikeFileName, splitLocation } from "../src/client/text.js";

test("classifyToken keeps prose out and paths in", () => {
  assert.deepEqual(classifyToken("src/index.ts", false), { path: "src/index.ts", absolute: false });
  assert.deepEqual(classifyToken("C:\\ws\\a.md", false), { path: "C:\\ws\\a.md", absolute: true });
  assert.deepEqual(classifyToken("README.md", false), { path: "README.md", absolute: false });
  // Directories often have no extension; a separator is enough to try.
  assert.deepEqual(classifyToken("plugins-src/dsh-computer-use-native", false), {
    path: "plugins-src/dsh-computer-use-native",
    absolute: false
  });
  assert.equal(classifyToken("好/坏", false), undefined);
  assert.equal(classifyToken("他/她", false), undefined);
  assert.equal(classifyToken("1.2", false), undefined);
  assert.equal(classifyToken("https://example.com/a.md", false), undefined);
  assert.equal(classifyToken("npm install foo", false), undefined);
});

test("code expressions stay native; file locations retain line and column", () => {
  for (const code of ["console.log(value)", "foo()", "return", "const x = y", "x => y", "foo.bar(baz)"]) assert.equal(classifyToken(code, true), undefined, code);
  assert.deepEqual(classifyToken("src/app.ts:42:8", true), { path: "src/app.ts", line: 42, column: 8, absolute: false });
  assert.deepEqual(splitLocation("C:\\ws\\a.ts:10"), { path: "C:\\ws\\a.ts", line: 10, column: 1 });
  assert.deepEqual(splitLocation("src/a.ts#L20C5"), { path: "src/a.ts", line: 20, column: 5 });
  assert.equal(classifyToken("README", true).path, "README");
  assert.equal(classifyToken(".env", true).path, ".env");
});

test("a bare name needs a letter or CJK stem", () => {
  assert.equal(looksLikeFileName("production.json"), true);
  assert.equal(looksLikeFileName("1.2"), false);
  assert.equal(looksLikeFileName("README"), false);
});

test("quoted paths may contain spaces when explicitly allowed", () => {
  assert.equal(classifyToken("C:\\My Projects\\a b.txt", false), undefined);
  assert.deepEqual(classifyToken("C:\\My Projects\\a b.txt", false, true), {
    path: "C:\\My Projects\\a b.txt",
    absolute: true
  });
  assert.deepEqual(classifyToken('"C:\\My Projects\\a b.txt"', false, true), {
    path: "C:\\My Projects\\a b.txt",
    absolute: true
  });
  assert.deepEqual(classifyToken("src/My Folder/a b.ts", false, true), {
    path: "src/My Folder/a b.ts",
    absolute: false
  });
  assert.equal(classifyToken("just some words", false, true), undefined);
});
