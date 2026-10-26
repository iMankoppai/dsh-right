import assert from 'node:assert/strict';
import test from 'node:test';
import { createResolver } from '../src/client/resolver.js';
import { createHostApi, HostApiError } from '../src/client/api.js';
import { createActions } from '../src/client/actions.js';
import { createStore } from '../src/client/store.js';
import { bounded, readBoundedBlob } from '../src/client/async.js';
import { buildItems } from '../src/client/menu-model.js';
import { zh, en } from '../src/client/i18n.js';
import { createContextResolver } from '../src/client/context.js';
import { editorUrlFor, openEditorLocation } from '../src/host/editor.js';
import { EventEmitter } from 'node:events';
import { normalizeSettings, saveSettings, loadSettings, configureItems, formatPath } from '../src/client/settings.js';

const file = { absolutePath: 'C:/ws/a.txt', name: 'a.txt', kind: 'file', relativePath: 'a.txt', sessionId: 's1', line: 42, column: 8 };
function actionHarness({ host = {}, remotes = {}, dialog, settings = {}, apps = [] } = {}) {
  const store = createStore();
  store.set({ ...store.get(), settings, menu: { target: { type: 'file', file }, apps } });
  const notices = [], copied = [];
  const actions = createActions({ ctx: {}, remotes, host: { post: async () => undefined, rawBlob: async () => new Blob(['bytes']), ...host }, store, t: key => key, notify: (...args) => notices.push(args), closeMenu() {}, P: { writeClipboard: async text => { copied.push(text); return true; } }, requestDialog: dialog });
  return { actions, notices, copied };
}

// Browser download side effects are captured without touching disk or opening applications.
let downloads = 0;
globalThis.window = {};
globalThis.document = { baseURI: 'http://localhost/', createElement: () => ({ style: {}, click() { downloads++; }, remove() {} }), body: { append() {} } };
const originalSetTimeout = globalThis.setTimeout;
// URL revocation should not keep the Node test process alive for ten seconds.
globalThis.setTimeout = (fn, ms, ...args) => { const timer = originalSetTimeout(fn, ms, ...args); if (ms === 10000) timer.unref(); return timer; };

test('settings tolerate corrupt storage, preserve ordering, and keep settings accessible', () => {
  const storage = { value: 'broken', getItem() { return this.value; }, setItem(_key, value) { this.value = value; } };
  assert.equal(loadSettings(storage).compact, false);
  assert.equal(saveSettings({ compact: true, hidden: ['copy-name', 'unknown'], order: ['copy-relative', 'copy-path', 'copy-relative'] }, storage), true);
  const settings = loadSettings(storage);
  assert.deepEqual(settings.hidden, ['copy-name']);
  const items = configureItems([{ id: 'header', type: 'label' }, { id: 's1', type: 'separator' }, { id: 'copy-path' }, { id: 'copy-relative' }, { id: 'copy-name' }], settings);
  assert.deepEqual(items.map(item => item.id), ['header', 's1', 'copy-relative', 'copy-path']);
  assert.equal(formatPath('C:\\ws\\a.txt', { separator: 'forward' }), 'C:/ws/a.txt');
  assert.equal(normalizeSettings(null).separator, 'native');
});

test('UNC links retain server names, while external api/file URLs stay external', () => {
  const resolver = createResolver({ host: {}, remotes: {} });
  assert.deepEqual(resolver.localPathOfLink(new URL('file://server/share/a.txt')), { path: '\\\\server\\share\\a.txt' });
  assert.equal(resolver.localPathOfLink(new URL('https://example.com/api/file?path=C:/secret')), undefined);
});

test('host API distinguishes route absence, file absence, authentication, and cancellation', async () => {
  const original = globalThis.fetch;
  try {
    const api = createHostApi();
    globalThis.fetch = async () => ({ ok: false, status: 404, json: async () => ({}) });
    assert.equal(await api.post('/read', {}), undefined);
    globalThis.fetch = async () => ({ ok: false, status: 404, json: async () => ({ code: 'not-found' }) });
    await assert.rejects(api.post('/read', {}), error => error instanceof HostApiError && error.code === 'not-found');
    globalThis.fetch = async () => ({ ok: false, status: 403, json: async () => { throw Error(); } });
    await assert.rejects(api.post('/read', {}), { code: 'unauthorized' });
    const controller = new AbortController(); controller.abort();
    await assert.rejects(api.post('/read', {}, controller.signal), { name: 'AbortError' });
  } finally { globalThis.fetch = original; }
});

test('unresponsive RPCs time out and caller cancellation is immediate', async () => {
  await assert.rejects(bounded(() => new Promise(() => {}), undefined, 15), { name: 'TimeoutError' });
  const controller = new AbortController();
  const request = bounded(() => new Promise(() => {}), controller.signal);
  controller.abort();
  await assert.rejects(request, { name: 'AbortError' });
});

test('missing and legacy hosts fall back to a download without calling a directory picker', async () => {
  for (const probe of [{ available: false }, { available: true, version: 1 }]) {
    let picked = 0, saved = 0;
    const before = downloads;
    const { actions, notices } = actionHarness({ host: { probe: async () => probe, post: async () => { saved++; } }, remotes: { directoryPicker: { pick: async () => { picked++; return 'C:/dest'; } } } });
    await actions.run('save-as');
    assert.equal(picked, 0); assert.equal(saved, 0);
    assert.equal(downloads, before + 1);
    assert.equal(notices.at(-1)[0], 'notice.downloadStarted');
  }
});

test('directory-picker cancellation never falls through to a download', async () => {
  for (const result of [null, undefined, { ok: true, value: null }]) {
    const before = downloads;
    const { actions, notices } = actionHarness({ host: { probe: async () => ({ available: true, capabilities: ['exclusive-save'] }) }, remotes: { directoryPicker: { pick: async () => result } } });
    await actions.run('save-as');
    assert.equal(downloads, before);
    assert.equal(notices.at(-1)[0], 'notice.saveCancelled');
  }
});

test('unavailable directory-picker RPC falls through to a download', async () => {
  const before = downloads;
  const { actions } = actionHarness({ host: { probe: async () => ({ available: true, capabilities: ['exclusive-save'] }) }, remotes: { directoryPicker: { pick: async () => ({ ok: false }) } } });
  await actions.run('save-as');
  assert.equal(downloads, before + 1);
});

test('failed browser writes abort the writable and do not start another save', async () => {
  let aborted = false;
  window.showSaveFilePicker = async () => ({ name: 'a.txt', createWritable: async () => ({ write: async () => { throw Error('write failed'); }, abort: async () => { aborted = true; } }) });
  try {
    const before = downloads;
    const { actions, notices } = actionHarness();
    await actions.run('save-as');
    assert.equal(aborted, true);
    assert.equal(downloads, before);
    assert.equal(notices.at(-1)[0], 'notice.saveFailed');
  } finally { delete window.showSaveFilePicker; }
});

test('browser Save As cancellation stops all fallbacks', async () => {
  window.showSaveFilePicker = async () => { throw new DOMException('Cancelled', 'AbortError'); };
  try {
    const before = downloads;
    const { actions, notices } = actionHarness();
    await actions.run('save-as');
    assert.equal(downloads, before);
    assert.equal(notices.at(-1)[0], 'notice.saveCancelled');
  } finally { delete window.showSaveFilePicker; }
});

test('overwrite is retried only after an explicit conflict choice', async () => {
  for (const choice of [null, 'rename', 'replace']) {
    const requests = [];
    const { actions } = actionHarness({ host: { probe: async () => ({ available: true, capabilities: ['exclusive-save'] }), post: async (_path, body) => {
      requests.push(body);
      if (requests.length === 1) throw new HostApiError('destination-exists', 409);
      return { path: body.to };
    } }, remotes: { directoryPicker: { pick: async () => ({ ok: true, value: 'C:/dest' }) } }, dialog: async () => choice });
    await actions.run('save-as');
    assert.equal(requests.length, choice ? 2 : 1);
    assert.equal(requests[0].conflict, undefined);
    if (choice) assert.equal(requests[1].conflict, choice);
  }
});

test('permission errors become a visible error without bypassing to a fallback', async () => {
  const { actions, notices } = actionHarness({ host: { post: async () => { throw new HostApiError('permission-denied', 403); } } });
  await actions.run('copy-contents');
  assert.equal(notices.at(-1)[0], 'notice.permissionDenied');
});

test('streaming downloads stop reading once the byte limit is exceeded', async () => {
  let cancelled = false;
  const response = new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(4)); controller.enqueue(new Uint8Array(4)); }, cancel() { cancelled = true; } }));
  await assert.rejects(readBoundedBlob(response, 5), { code: 'file-too-large' });
  assert.equal(cancelled, true);
});

test('all-hidden menus leave only the header; English/Chinese keys match', () => {
  const settings = normalizeSettings();
  settings.hidden = [...settings.order];
  const items = buildItems({ target: { type: 'file', file }, desktop: true, apps: [] }, key => key, {}, '', settings);
  assert.deepEqual(items.filter(item => !item.type).map(item => item.id), []);
  assert.equal(items.some((item, index) => item.type === 'separator' && items[index + 1]?.type === 'separator'), false);
  assert.deepEqual(Object.keys(zh).sort(), Object.keys(en).sort());
});

test('sidebar command ownership wins over the active chat fallback', () => {
  const services = { sessions: { list: { getSnapshot: () => ({ byId: { other: { cwd: 'C:/other' } } }) } }, uiSession: { adapter: { current: { getSnapshot: () => ({ key: 'current' }) } } }, sidebarRight: { commandTarget: () => ({ sessionId: 'other' }) } };
  const resolver = createContextResolver({ get: key => services[key] });
  assert.deepEqual(resolver.contextOf({ closest: () => null }), { sessionId: 'other', cwd: 'C:/other' });
});

test('line copying respects path style and opening goes through the host', async () => {
  const requests = [];
  const { actions, copied, notices } = actionHarness({ host: { probe: async () => ({ available: true, capabilities: ['editor-location'] }), post: async (route, body) => { requests.push({ route, body }); return { opened: true }; } }, settings: { separator: 'backward' }, apps: [{ id: 'vscode', name: 'Visual Studio Code' }] });
  await actions.run('copy-location');
  assert.equal(copied[0], 'a.txt:42:8');
  await actions.run('open-location');
  assert.deepEqual(requests, [{ route: '/open-location', body: { path: 'C:/ws/a.txt', line: 42, column: 8, editor: 'vscode' } }]);
  assert.equal(notices.at(-1)[0], 'notice.opened');
});

test('editor locations are encoded and launched with arguments rather than shell code', async () => {
  assert.equal(editorUrlFor('C:\\My Projects\\a #&.ts', 42, 8), 'vscode://file/C:/My%20Projects/a%20%23%26.ts:42:8');
  assert.throws(() => editorUrlFor('C:/a.ts', 1, 1, 'javascript'));
  assert.throws(() => editorUrlFor('C:/a.ts', -1));
  for (const platform of ['win32', 'darwin', 'linux']) {
    const calls = [];
    await openEditorLocation('C:/ws/a.ts', 42, 8, 'vscode', { platform, launch(exe, args, options) {
      calls.push({ exe, args, options });
      const child = new EventEmitter();
      queueMicrotask(() => child.emit('exit', 0));
      return child;
    } });
    assert.equal(calls[0].options.shell, false);
    assert.equal(calls[0].args.at(-1), 'vscode://file/C:/ws/a.ts:42:8');
    assert.equal(calls[0].exe, platform === 'win32' ? 'rundll32.exe' : platform === 'darwin' ? 'open' : 'xdg-open');
  }
});

test('remote copy fallback is bounded to 1 MiB without splitting UTF-8', async () => {
  const { actions, copied, notices } = actionHarness({ remotes: { files: { read: async () => ({ ok: true, value: { text: '中'.repeat(500000), lines: 1, eof: true } }) } } });
  await actions.run('copy-contents');
  assert.ok(Buffer.byteLength(copied[0]) <= 1024 * 1024);
  assert.equal(copied[0].includes('\uFFFD'), false);
  assert.equal(notices.at(-1)[0], 'notice.copiedContentsTruncated');
});
