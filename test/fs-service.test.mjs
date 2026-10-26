import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  contentTypeFor,
  copyFileTo,
  describePath,
  readTextFile
} from "../src/host/fs-service.js";

test("describePath reports files, directories, and missing paths", async () => {
  const root = await mkdtemp(join(tmpdir(), "dsh-right-fs-"));
  try {
    const file = join(root, "a.md");
    await writeFile(file, "hello");
    const fileInfo = await describePath(file);
    assert.equal(fileInfo.exists, true);
    assert.equal(fileInfo.kind, "file");
    assert.equal(fileInfo.size, 5);

    const dirInfo = await describePath(root);
    assert.equal(dirInfo.kind, "directory");

    const missing = await describePath(join(root, "nope.md"));
    assert.deepEqual(missing, { exists: false });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("readTextFile reads text, truncates at the cap, and refuses binaries", async () => {
  const root = await mkdtemp(join(tmpdir(), "dsh-right-fs-"));
  try {
    const text = join(root, "a.md");
    await writeFile(text, "hello world");
    const whole = await readTextFile(text);
    assert.equal(whole.ok, true);
    assert.equal(whole.text, "hello world");
    assert.equal(whole.truncated, false);
    assert.equal(whole.size, 11);

    const short = await readTextFile(text, 4);
    assert.equal(short.text, "hell");
    assert.equal(short.truncated, true);
    assert.equal(short.size, 11);

    const binary = join(root, "b.bin");
    await writeFile(binary, Buffer.from([0, 1, 2, 3]));
    const bin = await readTextFile(binary);
    assert.equal(bin.ok, true);
    assert.equal(bin.binary, true);
    assert.equal(bin.text, "");

    const dir = await readTextFile(root);
    assert.equal(dir.ok, false);
    assert.equal(dir.code, "not-a-file");

    const missing = await readTextFile(join(root, "nope"));
    assert.equal(missing.ok, false);
    assert.equal(missing.code, "not-found");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("copyFileTo creates the destination directory", async () => {
  const root = await mkdtemp(join(tmpdir(), "dsh-right-fs-"));
  try {
    const source = join(root, "a.md");
    await writeFile(source, "copy me");
    const target = join(root, "nested", "dir", "b.md");
    const copied = await copyFileTo(source, target);
    assert.equal(copied.exists, true);
    assert.equal(copied.size, 7);
    assert.equal((await readTextFile(target)).text, "copy me");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("contentTypeFor maps common extensions", () => {
  assert.match(contentTypeFor("a.md"), /text\/markdown/);
  assert.match(contentTypeFor("a.PNG"), /image\/png/);
  assert.equal(contentTypeFor("a.unknown"), "application/octet-stream");
});

test("UTF-8 truncation keeps complete Chinese and emoji code points", async () => {
  const root = await mkdtemp(join(tmpdir(), "dsh-right-utf8-"));
  try {
    const file = join(root, "utf8.txt");
    await writeFile(file, "中文😀末尾");
    assert.equal((await readTextFile(file, 4)).text, "中");
    assert.equal((await readTextFile(file, 8)).text, "中文");
    assert.equal((await readTextFile(file, 10)).text, "中文😀");
    assert.equal((await readTextFile(file, 100)).text, "中文😀末尾");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("parallel exclusive saves never overwrite or reuse the same renamed destination", async () => {
  const root = await mkdtemp(join(tmpdir(), "dsh-right-race-"));
  try {
    const source = join(root, "source.txt"), target = join(root, "target.txt");
    await writeFile(source, "copy");
    const copies = await Promise.all(Array.from({ length: 6 }, () => copyFileTo(source, target, "rename")));
    assert.equal(new Set(copies.map(item => item.path)).size, 6);
  } finally { await rm(root, { recursive: true, force: true }); }
});
