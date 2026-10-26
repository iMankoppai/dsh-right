import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir } from 'node:fs/promises';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
const bundle = await build({ entryPoints: ['test/browser-entry.jsx'], bundle: true, write: false, format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' } });
const server = createServer((req, res) => {
  if (req.url === '/app.js') { res.setHeader('content-type', 'text/javascript'); res.end(bundle.outputFiles[0].text); }
  else { res.setHeader('content-type', 'text/html; charset=utf-8'); res.end('<!doctype html><html lang="zh"><meta name="viewport" content="width=device-width,initial-scale=1"><title>DSH Right dialog tests</title><body><button id="origin">原来的焦点</button><div id="root"></div><script src="/app.js"></script></body></html>'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(() => typeof window.showDialog === 'function');
  const show = async (type, extra) => { await page.locator('#origin').focus(); await page.evaluate(([type, extra]) => window.showDialog(type, extra), [type, extra]); await page.locator('dialog[open]').waitFor(); };

  await show('settings');
  await page.getByLabel('紧凑菜单', { exact: true }).check();
  await page.getByLabel('复制路径的分隔符', { exact: true }).selectOption('forward');
  await page.getByLabel('首选打开程序', { exact: true }).selectOption('vscode');
  await page.getByLabel('复制文件名', { exact: true }).uncheck();
  await page.getByRole('button', { name: '上移 · 复制路径', exact: true }).click();
  await mkdir('_tmp/verification', { recursive: true });
  await page.screenshot({ path: '_tmp/verification/settings-desktop.png' });
  await page.getByRole('button', { name: '保存设置', exact: true }).click();
  await page.locator('dialog').waitFor({ state: 'detached' });
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('dsh-right.settings.v1')));
  assert.equal(stored.compact, true); assert.equal(stored.separator, 'forward'); assert.equal(stored.defaultApplication, 'vscode'); assert.ok(stored.hidden.includes('copy-name'));
  assert.ok(stored.order.indexOf('copy-path') < stored.order.indexOf('save-as'));
  await page.reload(); await page.waitForFunction(() => typeof window.showDialog === 'function');
  await show('settings');
  assert.equal(await page.getByLabel('紧凑菜单', { exact: true }).isChecked(), true);
  assert.equal(await page.getByLabel('复制文件名', { exact: true }).isChecked(), false);
  for (let i = 0; i < 50; i++) {
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.closest('dialog') !== null), true);
  }
  await page.keyboard.press('Escape');
  await page.locator('dialog').waitFor({ state: 'detached' });
  assert.equal(await page.evaluate(() => document.activeElement.id), 'origin');

  await show('conflict', { path: 'C:/目标/已经存在的文件.txt' });
  await page.getByRole('button', { name: '自动改名', exact: true }).click();
  assert.equal(await page.evaluate(() => window.results.at(-1)), 'rename');
  await show('conflict', { path: 'C:/target.txt' });
  await page.keyboard.press('Escape');
  await page.locator('dialog').waitFor({ state: 'detached' });
  assert.equal(await page.evaluate(() => window.results.at(-1)), null);

  await show('choices', { choices: [{ path: 'backend/config.json' }, { path: 'frontend/config.json' }] });
  await page.getByRole('button', { name: 'frontend/config.json', exact: true }).click();
  assert.equal(await page.evaluate(() => window.results.at(-1)), 'frontend/config.json');

  await page.setViewportSize({ width: 390, height: 650 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await show('settings');
  const bounds = await page.locator('dialog').boundingBox();
  assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 391);
  assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= 651);
  assert.equal(await page.evaluate(() => document.querySelector('dialog').scrollWidth <= document.querySelector('dialog').clientWidth), true);
  await page.screenshot({ path: '_tmp/verification/settings-mobile-dark.png' });
  await page.keyboard.press('Escape');
  await show('diagnostics', { loading: false, probe: { available: false, code: 'host-unavailable' }, desktop: true, files: true, picker: false, browser: true });
  await page.getByText(/宿主未加载或版本较旧/).waitFor();
  await page.screenshot({ path: '_tmp/verification/diagnostics.png' });
  assert.deepEqual(errors, []);
  console.log('Browser checks passed: settings persistence/order, focus containment/restoration, Escape, conflict choices, duplicate selection, narrow/dark layout, diagnostics.');
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
