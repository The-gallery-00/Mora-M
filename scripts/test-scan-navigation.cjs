const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createRequire } = require('node:module');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');
const { StackRouter, StackActions } = require('expo-router/build/react-navigation/routers/StackRouter');

const root = path.join(__dirname, '..');
const no = () => assert.fail('Unexpected navigation or draft mutation');
const react = { useCallback: (fn) => fn };
function load(code, env = {}) {
  const module = { exports: {} };
  const compiled = ts.transpileModule(code, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(compiled, { module, exports: module.exports, ...env });
  return module.exports;
}
function source(file) {
  return ts.createSourceFile(file, fs.readFileSync(path.join(root, file), 'utf8'),
    ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}
function find(sf, predicate) {
  const out = [];
  function visit(node) { if (predicate(node)) out.push(node); ts.forEachChild(node, visit); }
  visit(sf);
  return out;
}
function callback(file, name, env) {
  const sf = source(file);
  const node = find(sf, (n) => ts.isVariableDeclaration(n) && n.name.getText(sf) === name)[0];
  assert.ok(node?.initializer && ts.isCallExpression(node.initializer), name);
  return load('module.exports = ' + node.initializer.arguments[0].getText(sf), env);
}
function focusCallback(file, fragment, env) {
  const sf = source(file);
  const node = find(sf, (n) => ts.isCallExpression(n) && n.expression.getText(sf) === 'useFocusEffect'
    && n.getText(sf).includes(fragment))[0];
  assert.ok(node, `${file}: missing focused effect for ${fragment}`);
  return load('module.exports = ' + node.arguments[0].arguments[0].getText(sf), env);
}
function backBus() {
  let listeners = [];
  return {
    addEventListener(name, fn) {
      assert.equal(name, 'hardwareBackPress'); listeners.push(fn);
      return { remove: () => { listeners = listeners.filter((listener) => listener !== fn); } };
    },
    press: () => [...listeners].reverse().some((fn) => fn()),
    count: () => listeners.length,
  };
}

// Run Expo's actual focus subscription implementation; only native navigation events are mocked.
function focusLifecycle(effect, initiallyFocused = true) {
  let focused = initiallyFocused;
  const listeners = { focus: new Set(), blur: new Set() };
  const cleanups = [];
  const nav = {
    isFocused: () => focused,
    addListener: (event, fn) => { listeners[event].add(fn); return () => listeners[event].delete(fn); },
  };
  const filename = require.resolve('expo-router/build/useFocusEffect');
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module, exports: module.exports, process, console,
    require(name) {
      if (name === 'react') return { useEffect: (fn) => cleanups.push(fn()) };
      if (name === './useNavigation') return { useNavigation: () => nav };
      if (name === './link/useLoadedNavigation') return { useOptionalNavigation: () => nav };
      return no();
    },
  });
  module.exports.useFocusEffect(effect);
  return {
    blur: () => { focused = false; listeners.blur.forEach((fn) => fn()); },
    focus: () => { focused = true; listeners.focus.forEach((fn) => fn()); },
    unmount: () => cleanups.forEach((fn) => fn?.()),
  };
}

const context = () => ({ default: () => null });
context.keys = () => fs.readdirSync(path.join(root, 'app'), { recursive: true })
  .filter((file) => /\.[jt]sx?$/.test(file)).map((file) => './' + file);
const routeTree = require('expo-router/build/getRoutesCore').getRoutes(context, {
  platform: 'android', skipGenerated: true, ignoreEntryPoints: true, importMode: 'lazy',
});
const config = require('expo-router/build/getReactNavigationConfig').getReactNavigationConfig(routeTree, true);
const parseFilename = require.resolve('expo-router/build/fork/getStateFromPath');
const parserModule = { exports: {} };
const parseRequire = createRequire(parseFilename);
vm.runInNewContext(fs.readFileSync(parseFilename, 'utf8'), {
  module: parserModule, exports: parserModule.exports, URL, process, console,
  require: (name) => name === '../react-navigation/native'
    ? require('expo-router/build/react-navigation/core/validatePathConfig') : parseRequire(name),
});

// Use the installed SDK's linking, action targeting, and stack reducers, not a hand-written router.
function navigation(steps = ['index'], coldStart = false) {
  const rootOptions = { routeNames: Object.keys(config.screens), routeParamList: {}, routeGetIdList: {} };
  const scanOptions = { routeNames: ['index', 'crop', 'analyzing', 'review', 'done'], routeParamList: {}, routeGetIdList: {} };
  const rootRouter = StackRouter({ initialRouteName: coldStart ? 'scan' : '(tabs)' });
  const scanRouter = StackRouter({ initialRouteName: steps[0] });
  let state = rootRouter.getInitialState(rootOptions);
  const tabKey = state.routes[0].key;
  let scan = scanRouter.getInitialState(scanOptions);
  for (const step of steps.slice(1)) scan = scanRouter.getStateForAction(scan, StackActions.push(step), scanOptions);
  if (!coldStart) state = rootRouter.getStateForAction(state, StackActions.push('scan'), rootOptions);
  state.routes[state.index].state = scan;
  function apply(action) {
    let found = false;
    function visit(current) {
      if (current.key === action.target) {
        found = true;
        const next = (current.key === state.key ? rootRouter : scanRouter)
          .getStateForAction(current, action, current.key === state.key ? rootOptions : scanOptions);
        assert.ok(next, 'SDK rejected navigation action'); return next;
      }
      return { ...current, routes: current.routes.map((route) => route.state
        ? { ...route, state: visit(route.state) } : route) };
    }
    state = visit(state); assert.ok(found, 'Wrong navigator target');
  }
  function segments() {
    let current = state; const names = [];
    while (current) { const route = current.routes[current.index]; names.push(route.name); current = route.state; }
    return names;
  }
  const store = {
    assertIsReady() {}, redirects: [], navigationRef: { current: { getRootState: () => state } },
    getRouteInfo: () => ({ segments: segments(), params: {} }),
    linking: { config, getStateFromPath: (url, options) => parserModule.exports.getStateFromPath(url, options, segments()) },
  };
  const actionFile = require.resolve('expo-router/build/global-state/getNavigationAction');
  const actionRequire = createRequire(actionFile);
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(actionFile, 'utf8'), {
    module, exports: module.exports, process, console,
    require: (name) => name === './store' ? { store } : name === '../getRoutesRedirects'
      ? { applyRedirects: (url) => url } : actionRequire(name),
  });
  const router = {
    dismissTo: (url) => apply(module.exports.getNavigateAction(url, {}, 'POP_TO')),
    canGoBack: () => state.index > 0,
    back: () => apply({ type: 'GO_BACK', target: state.key }),
    replace: no,
  };
  const { useScanNavigation } = load(fs.readFileSync(path.join(root, 'src/features/scan/useScanNavigation.ts'), 'utf8'), {
    require(name) {
      if (name === 'react') return react;
      if (name === 'expo-router') return { useRouter: () => router,
        useNavigation: (parent) => { assert.equal(parent, '/'); return { getState: () => state, dispatch: apply }; } };
      return no();
    },
  });
  return {
    ...useScanNavigation(), router, tabKey, state: () => state,
    cameraRoutes: () => state.routes.findLast((r) => r.name === 'scan')?.state.routes.map((r) => r.name),
    push: (name) => { state = rootRouter.getStateForAction(state, StackActions.push(name), rootOptions); assert.ok(state); },
    pushScan: (name) => apply({ ...StackActions.push(name), target: state.routes[state.index].state.key }),
  };
}

for (const [file, vars] of [
  ['app/scan/index.tsx', { helpSheetOpen: false, closeScan() {}, setHelpSheetOpen: no }],
  ['app/scan/crop.tsx', { handleCancel() {} }],
  ['app/scan/review.tsx', { handleBack() {} }],
  ['app/scan/analyzing.tsx', { backPressedAt: { current: 0 }, running: false, abortToCamera() {} }],
  ['app/scan/done.tsx', { goHome() {} }],
  ['app/viewer.tsx', { closing: { set() {} }, setDismissing() {}, close() {} }],
]) {
  test(`${file}: hardware back listener follows focus, blur, refocus, and unmount`, () => {
    const bus = backBus();
    const life = focusLifecycle(focusCallback(file, 'BackHandler', { BackHandler: bus, ...vars }), false);
    assert.equal(bus.count(), 0); life.focus(); assert.equal(bus.count(), 1);
    assert.equal(bus.press(), true); life.blur(); assert.equal(bus.count(), 0);
    life.focus(); life.focus(); assert.equal(bus.count(), 1);
    life.unmount(); assert.equal(bus.count(), 0);
    const sf = source(file);
    assert.equal(find(sf, (n) => ts.isCallExpression(n) && n.expression.getText(sf) === 'useEffect'
      && n.getText(sf).includes('BackHandler.addEventListener')).length, 0);
  });
}

for (const input of ['camera', 'gallery']) {
  for (const back of ['header', 'hardware']) {
    test(`${input}: crop ${back} back clears capture, reuses camera, then exits to original tab`, () => {
      const nav = navigation(['index', 'crop']); let capture = `file:///${input}.jpg`;
      const cancel = callback('app/scan/crop.tsx', 'handleCancel', {
        processing: false, resetForNextScan: () => { capture = null; }, toCamera: nav.toCamera,
      });
      if (back === 'header') cancel();
      else {
        const bus = backBus();
        const life = focusLifecycle(focusCallback('app/scan/crop.tsx', 'BackHandler', { BackHandler: bus, handleCancel: cancel }));
        assert.equal(bus.press(), true); life.unmount();
      }
      assert.equal(capture, null); assert.deepEqual(nav.cameraRoutes(), ['index']);
      const close = callback('app/scan/index.tsx', 'closeScan', {
        capturing: false, useScanStore: { getState: () => ({ sourceUri: capture }) }, close: nav.close, Alert: { alert: no },
      });
      close(); assert.deepEqual(nav.state().routes.map((r) => r.name), ['(tabs)']);
      assert.equal(nav.state().routes[0].key, nav.tabKey);
    });
  }
}

test('viewer hardware back returns to review without asking to discard or mutating draft', () => {
  const nav = navigation(['index', 'review']); const bus = backBus();
  const review = focusLifecycle(focusCallback('app/scan/review.tsx', 'BackHandler', { BackHandler: bus, handleBack: no }));
  review.blur(); nav.push('viewer');
  let closing = false;
  const gate = { get: () => closing, set: (value) => { closing = value; } };
  const close = callback('app/viewer.tsx', 'close', { closing: gate, setDismissing() {}, router: nav.router });
  const viewer = focusLifecycle(focusCallback('app/viewer.tsx', 'BackHandler', {
    BackHandler: bus, closing: gate, setDismissing() {}, close,
  }));
  assert.equal(bus.press(), true); close(); // A second close during dismissal must not pop review.
  assert.deepEqual(nav.state().routes.map((r) => r.name), ['(tabs)', 'scan']);
  assert.deepEqual(nav.cameraRoutes(), ['index', 'review']); viewer.unmount(); review.unmount();
  let cleared = false;
  callback('app/scan/review.tsx', 'leaveToCamera', {
    resetForNextScan: () => { cleared = true; }, toCamera: nav.toCamera,
  })();
  assert.equal(cleared, true); assert.deepEqual(nav.cameraRoutes(), ['index']); nav.close();
  for (const screen of ['notifications', 'settings/profile', 'doc/[type]/[id]']) {
    nav.push(screen); assert.equal(bus.press(), false); nav.router.back();
    assert.deepEqual(nav.state().routes.map((r) => r.name), ['(tabs)']);
  }
});

for (const screen of ['crop', 'review', 'analyzing', 'done']) {
  test(`${screen}: return to camera supports deep links without an existing camera`, () => {
    const nav = navigation([screen], true); nav.toCamera(); nav.toCamera();
    assert.deepEqual(nav.cameraRoutes(), ['index']); nav.close(); nav.close();
    assert.deepEqual(nav.state().routes.map((r) => r.name), ['(tabs)']);
  });
}

test('empty review behind another screen never redirects until it is focused', () => {
  let calls = 0;
  const life = focusLifecycle(focusCallback('app/scan/review.tsx', '!scan', {
    scan: null, initialValues: {}, previewUri: null, toCamera: () => calls++,
  }), false);
  assert.equal(calls, 0); life.focus(); assert.equal(calls, 1); life.unmount();
});

test('processing crop and saving review cannot discard an in-flight operation', () => {
  callback('app/scan/crop.tsx', 'handleCancel', { processing: true, resetForNextScan: no, toCamera: no })();
  callback('app/scan/review.tsx', 'handleBack', {
    saving: true, setValues: no, collect: no, confirmDiscardScan: no, leaveToCamera: no,
  })();
});

test('review still confirms cancellation when not saving, including during reclassification', () => {
  const calls = [];
  const leave = () => calls.push('leave');
  callback('app/scan/review.tsx', 'handleBack', {
    saving: false, collect: () => ({ title: 'draft' }),
    setValues: (values) => { assert.equal(values.title, 'draft'); calls.push('sync'); },
    confirmDiscardScan: (onLeave) => { assert.equal(onLeave, leave); calls.push('confirm'); },
    leaveToCamera: leave,
  })();
  assert.deepEqual(calls, ['sync', 'confirm']);
});

test('camera refocus clears stale ready/error state and rechecks permission', () => {
  let ready = true, error = true, checks = 0;
  const life = focusLifecycle(focusCallback('app/scan/index.tsx', 'getPermission', {
    setReady: (value) => { ready = value; }, setMountError: (value) => { error = value; },
    getPermission: () => { checks++; },
  }));
  assert.equal(ready, false); assert.equal(error, false); assert.equal(checks, 1);
  life.blur(); ready = true; error = true; life.focus();
  assert.equal(ready, false); assert.equal(error, false); assert.equal(checks, 2); life.unmount();
});

test('closing a legacy duplicate scan stack removes every scan and preserves the original tabs route', () => {
  const nav = navigation(['index', 'review']); nav.push('viewer'); nav.push('scan'); nav.close();
  assert.deepEqual(nav.state().routes.map((r) => r.name), ['(tabs)']);
  assert.equal(nav.state().routes[0].key, nav.tabKey);
});

test('camera exit preserves the selected tab and its history rather than resetting to home', () => {
  const nav = navigation();
  const tabs = { type: 'tab', key: 'original-tabs', index: 1,
    routes: [{ name: 'index', key: 'home' }, { name: 'archive/index', key: 'archive' }],
    history: [{ type: 'route', key: 'home' }, { type: 'route', key: 'archive' }] };
  nav.state().routes[0].state = tabs; nav.close();
  assert.equal(nav.state().routes[0].state, tabs);
});

test('camera preview is not mounted while crop, viewer, or another route has focus', () => {
  const sf = source('app/scan/index.tsx');
  const camera = find(sf, (n) => ts.isJsxSelfClosingElement(n) && n.tagName.getText(sf) === 'CameraView')[0];
  assert.ok(camera);
  let conditional = camera.parent;
  while (conditional && !ts.isConditionalExpression(conditional)) conditional = conditional.parent;
  assert.ok(conditional); assert.equal(conditional.whenTrue.kind, ts.SyntaxKind.NullKeyword);
  assert.equal(vm.runInNewContext(conditional.condition.getText(sf), { focused: false, mountError: false }), true);
  assert.equal(vm.runInNewContext(conditional.condition.getText(sf), { focused: true, mountError: false }), false);
});

for (const [name, href] of [['goHome', '/(tabs)'], ['goArchive', '/(tabs)/archive']]) {
  test(`done ${name} dismisses scan instead of leaving a duplicate tabs route`, () => {
    const nav = navigation(['index', 'done']);
    callback('app/scan/done.tsx', name, { router: nav.router, HOME_HREF: '/(tabs)', ARCHIVE_HREF: '/(tabs)/archive' })();
    assert.deepEqual(nav.state().routes.map((r) => r.name), ['(tabs)']);
    assert.equal(nav.state().routes[0].key, nav.tabKey);
    assert.equal(nav.state().routes[0].params.screen, href.endsWith('archive') ? 'archive/index' : 'index');
  });
}

test('continue scanning repeatedly reuses one camera and resets only the current draft', () => {
  const nav = navigation(['index', 'done']); let resets = 0;
  const again = callback('app/scan/done.tsx', 'scanAgain', {
    haptics: { impact() {} }, resetForNextScan: () => resets++, toCamera: nav.toCamera,
  });
  for (let i = 0; i < 5; i++) {
    again(); assert.deepEqual(nav.cameraRoutes(), ['index']);
    if (i < 4) nav.pushScan('done');
  }
  assert.equal(resets, 5); nav.close();
  assert.deepEqual(nav.state().routes.map((r) => r.name), ['(tabs)']);
});

test('camera cannot exit while a capture is still being produced', () => {
  callback('app/scan/index.tsx', 'closeScan', {
    capturing: true, useScanStore: { getState: no }, close: no,
  })();
});

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function scanJobs() {
  const preparations = [], uploads = [];
  const types = load(fs.readFileSync(path.join(root, 'src/features/scan/types.ts'), 'utf8'));
  const { useScanStore } = load(fs.readFileSync(path.join(root, 'src/features/scan/scanStore.ts'), 'utf8'), {
    require(name) {
      if (name === 'zustand') return require('zustand');
      if (name === './types') return types;
      if (name === './fieldSchema') return {
        buildFieldDefs: () => [], initialFieldValues: (defs, parsed) => ({ ...parsed }),
        inheritFieldValues: (defs, current, parsed) => ({ ...parsed, ...current }),
      };
      if (name === './imagePipeline') return { prepareForUpload: () => {
        const pending = deferred(); preparations.push(pending); return pending.promise;
      } };
      if (name === './api') return { commitDocument: no, saveDocument: no, scanImage: (image, options) => {
        const pending = deferred(); const handle = { ...pending, cancelCalls: 0, cancel() { handle.cancelCalls++; } };
        uploads.push({ handle, options }); return handle;
      } };
      return no();
    },
  });
  return { store: useScanStore, preparations, uploads };
}
const prepared = { uri: 'file:///compressed.jpg', width: 100, height: 100, size: 1000 };
const success = { ok: true, data: { type: 'BUSINESS_CARD', fields: [], parsed: { name: 'latest' },
  classified: false, confidence: 1, rawBlocks: [{ text: 'synthetic' }] } };

for (const action of ['reset', 'resetForNextScan', 'cancelScan']) {
  test(`${action}: late compression cannot resurrect an abandoned scan`, async () => {
    const { store, preparations, uploads } = scanJobs();
    store.getState().setSource('file:///original.jpg');
    const start = callback('app/scan/analyzing.tsx', 'start', {
      prepare: store.getState().prepare, runScan: store.getState().runScan,
    });
    const pending = start(); store.getState()[action](); preparations[0].resolve(prepared);
    assert.equal(await pending, false); assert.equal(store.getState().prepared, null);
    assert.equal(uploads.length, 0);
  });
}

test('old compression failure cannot overwrite the next selected image or its prepared result', async () => {
  const { store, preparations } = scanJobs();
  store.getState().setSource('file:///old.jpg'); const old = store.getState().prepare();
  store.getState().setSource('file:///next.jpg'); const next = store.getState().prepare();
  preparations[1].resolve(prepared); assert.equal(await next, true);
  preparations[0].reject(new Error('old decode failed')); assert.equal(await old, false);
  assert.equal(store.getState().sourceUri, 'file:///next.jpg');
  assert.equal(store.getState().prepared, prepared); assert.equal(store.getState().failure, null);
});

test('canceled OCR ignores late progress and success without resetting the next session', async () => {
  const { store, uploads } = scanJobs();
  store.getState().setSource('file:///original.jpg'); store.setState({ prepared, sessionSavedCount: 2 });
  const pending = store.getState().runScan(); store.getState().resetForNextScan();
  assert.equal(uploads[0].handle.cancelCalls, 1);
  uploads[0].options.onProgress(0.8); uploads[0].handle.resolve(success);
  assert.equal(await pending, false); assert.equal(store.getState().step, 'idle');
  assert.equal(store.getState().scan, null); assert.equal(store.getState().uploadProgress, 0);
  assert.equal(store.getState().sessionSavedCount, 2);
});

test('a superseded OCR request cannot clear the newer cancel handle or overwrite newer results', async () => {
  const { store, uploads } = scanJobs(); store.setState({ prepared });
  const old = store.getState().runScan(), next = store.getState().runScan();
  assert.equal(uploads[0].handle.cancelCalls, 1);
  uploads[0].options.onProgress(0.9); assert.equal(store.getState().uploadProgress, 0);
  uploads[0].handle.resolve({ ok: false, canceled: true }); assert.equal(await old, false);
  assert.equal(store.getState().cancelUpload, uploads[1].handle.cancel);
  uploads[1].handle.resolve(success); assert.equal(await next, true);
  assert.equal(store.getState().values.name, 'latest'); assert.equal(store.getState().step, 'editing');
});
