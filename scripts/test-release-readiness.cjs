const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

function loadSource(file, dependencies, globals = {}) {
  const filename = path.join(__dirname, '..', file);
  const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
    fileName: filename,
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(compiled, {
    module,
    exports: module.exports,
    require(name) {
      assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency: ${name}`);
      return dependencies[name];
    },
    ...globals,
  }, { filename });
  return module.exports;
}

const { releaseFeatures } = loadSource('src/config/releaseFeatures.ts', {});
const fail = () => assert.fail('Disabled feature or unnecessary permission was invoked');

function scanHarness(result, cameraGranted = false) {
  const calls = { picker: [], sources: [], failures: [], camera: 0 };
  const store = {
    docType: 'RECEIPT', values: {}, failure: null, uploadPhase: null,
    step: 'idle', uploadProgress: 0, scanAttempts: 0,
    setSource: (...args) => calls.sources.push(args),
    setFailure: (failure) => calls.failures.push(failure),
  };
  const { useScan } = loadSource('src/features/scan/useScan.ts', {
    'expo-camera': { useCameraPermissions: () => [null, async () => {
      calls.camera += 1;
      return { granted: cameraGranted };
    }] },
    'expo-image-picker': {
      requestMediaLibraryPermissionsAsync: fail,
      getMediaLibraryPermissionsAsync: fail,
      launchImageLibraryAsync: async (options) => { calls.picker.push(options); return result; },
    },
    react: { useCallback: (fn) => fn, useMemo: (fn) => fn() },
    'react-native': { Linking: { openSettings: fail } },
    './api': { springUpstreamFailure: () => null },
    './fieldSchema': { recognitionSummary: () => ({}) },
    './scanStore': {
      useScanStore: () => store,
      currentFieldDefs: () => [], currentValidation: () => ({ ok: true }),
      currentSoftWarning: () => null, classificationTier: () => 'unclassified',
      hasNoExtractedValues: () => true, confidenceBadge: () => null, canSave: () => false,
    },
  });
  return { scan: useScan(), calls };
}

test('first release features are explicitly disabled and immutable', () => {
  assert.equal(releaseFeatures.aiChat, false);
  assert.equal(releaseFeatures.googleCalendar, false);
  assert.ok(Object.isFrozen(releaseFeatures));
});

test('gallery opens the system single-image picker without requesting library permission', async () => {
  const { scan, calls } = scanHarness({ canceled: false, assets: [
    { uri: 'file:///cache/selected.jpg', width: 1200, height: 1600 },
  ] });
  assert.equal(await scan.pickFromLibrary(), 'selected');
  const options = calls.picker[0];
  assert.equal(calls.picker.length, 1);
  assert.equal(JSON.stringify(options.mediaTypes), '["images"]');
  assert.equal(options.allowsMultipleSelection, false);
  assert.equal(options.allowsEditing, false);
  assert.equal(options.legacy, false);
  assert.equal(options.exif, false);
  assert.equal(options.quality, 1);
  assert.equal(calls.camera, 0);
  assert.equal(calls.failures.length, 0);
  assert.equal(calls.sources[0][0], 'file:///cache/selected.jpg');
  assert.equal(calls.sources[0][1].width, 1200);
  assert.equal(calls.sources[0][1].height, 1600);
});

for (const result of [{ canceled: true, assets: null }, { canceled: false, assets: [] }]) {
  test(`picker cancellation or empty result preserves the existing scan (${result.canceled})`, async () => {
    const { scan, calls } = scanHarness(result);
    assert.equal(await scan.pickFromLibrary(), 'canceled');
    assert.equal(calls.sources.length, 0);
    assert.equal(calls.failures.length, 0);
  });
}

test('camera permission remains separate from photo selection', async () => {
  for (const granted of [false, true]) {
    const { scan, calls } = scanHarness(null, granted);
    assert.equal(await scan.ensureCameraPermission(), granted ? 'granted' : 'denied');
    assert.equal(calls.camera, 1);
    assert.equal(calls.picker.length, 0);
    assert.equal(calls.failures.length, granted ? 0 : 1);
    if (!granted) assert.equal(calls.failures[0].code, 'SCF-01');
  }
});

test('all Android variants block broad photo/video/storage and audio permissions', () => {
  const previous = process.env.APP_VARIANT;
  const configFile = path.join(__dirname, '..', 'app.config.js');
  try {
    for (const variant of ['development', 'preview', 'production']) {
      process.env.APP_VARIANT = variant;
      delete require.cache[require.resolve(configFile)];
      const config = require(configFile)({ config: {} });
      for (const permission of [
        'READ_MEDIA_IMAGES', 'READ_MEDIA_VIDEO', 'READ_MEDIA_VISUAL_USER_SELECTED',
        'READ_EXTERNAL_STORAGE', 'WRITE_EXTERNAL_STORAGE', 'RECORD_AUDIO',
      ]) {
        assert.ok(config.android.blockedPermissions.includes(`android.permission.${permission}`));
        assert.ok(!config.android.permissions.includes(`android.permission.${permission}`));
      }
      assert.ok(config.android.permissions.includes('android.permission.CAMERA'));
      if (variant === 'production') assert.equal(config.android.package, 'com.thegallery.mora');
    }
  } finally {
    if (previous === undefined) delete process.env.APP_VARIANT;
    else process.env.APP_VARIANT = previous;
    delete require.cache[require.resolve(configFile)];
  }
});

function calendarHarness() {
  return loadSource('src/features/dashboard/calendar.ts', {
    'expo-linking': {}, 'expo-web-browser': { openAuthSessionAsync: fail },
    '@/config/releaseFeatures': { releaseFeatures },
    '@/features/auth/oauth': { oauthRedirectUri: 'mora://auth' },
    '@/services/http': { request: fail },
    './api': { toLocalDateString: (date) => date.toISOString().slice(0, 10) },
  }, { process: { env: { EXPO_PUBLIC_CALENDAR_DEEPLINK: '1' } } });
}

test('calendar release gate overrides old env flags and never opens OAuth or sends requests', async () => {
  const calendar = calendarHarness();
  assert.equal(calendar.isCalendarConnectEnabled(), false);
  assert.equal((await calendar.startCalendarConnect()).status, 'unavailable');
});

test('disabled Google Calendar queries do not auto-fetch even with a previously connected user', () => {
  const queries = loadSource('src/features/dashboard/queries.ts', {
    '@tanstack/react-query': { useQuery: (options) => options },
    react: { useMemo: (fn) => fn() },
    '@/config/releaseFeatures': { releaseFeatures },
    '@/features/documents/api': {}, '@/features/network': {}, './api': {},
    './calendar': calendarHarness(),
  });
  assert.equal(queries.useCalendarConnection('existing-user').enabled, false);
  assert.equal(queries.useCalendarTokenInfo('existing-user', true).enabled, false);
});

test('document calendar events remain available without Google Calendar integration', () => {
  const calendar = calendarHarness();
  const events = calendar.toCalendarEvents([
    { type: 'TICKET', id: 1, departureLocation: '서울', arrivalLocation: '부산',
      departureDate: '2026-11-05', departureTime: '10:00', transportType: '기차' },
    { type: 'POSTER', id: 2, title: '팀 발표', organizerName: 'MORA',
      eventStartDate: '2026-11-06', eventEndDate: '2026-11-07' },
  ]);
  assert.equal(events.length, 2);
  assert.equal(events[0].key, 'TICKET:1');
  assert.equal(events[1].key, 'POSTER:2');
  assert.equal(events[1].endDate, '2026-11-07');
});

for (const [file, testId, feature] of [
  ['app/(tabs)/search.tsx', 'search-chat-fab', 'aiChat'],
  ['app/(tabs)/settings/index.tsx', 'row-gcal', 'googleCalendar'],
]) {
  test(`${testId} is rendered only inside its release feature gate`, () => {
    const ast = ts.createSourceFile(file, fs.readFileSync(path.join(__dirname, '..', file), 'utf8'),
      ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let matches = 0;
    function visit(node) {
      if (ts.isJsxAttribute(node) && node.name.getText(ast) === 'testID' &&
          node.initializer && ts.isStringLiteral(node.initializer) && node.initializer.text === testId) {
        matches += 1;
        let parent = node.parent;
        while (parent && !(ts.isBinaryExpression(parent) &&
          parent.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken &&
          parent.left.getText(ast) === `releaseFeatures.${feature}`)) parent = parent.parent;
        assert.ok(parent, `${testId} has an unguarded entry point`);
      }
      ts.forEachChild(node, visit);
    }
    visit(ast);
    assert.equal(matches, 1);
  });
}

test('direct chat route redirects without mounting hooks or sending messages', () => {
  const file = 'app/chat.tsx';
  const ast = ts.createSourceFile(file, fs.readFileSync(path.join(__dirname, '..', file), 'utf8'),
    ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const dependencies = {};
  for (const statement of ast.statements) {
    if (ts.isImportDeclaration(statement)) {
      dependencies[statement.moduleSpecifier.text] = new Proxy({}, { get: () => fail });
    }
  }
  const redirect = Symbol('Redirect');
  dependencies['expo-router'] = { Redirect: redirect };
  dependencies['@/config/releaseFeatures'] = { releaseFeatures };
  dependencies['react/jsx-runtime'] = { jsx: (type, props) => ({ type, props }) };
  const screen = loadSource(file, dependencies).default();
  assert.equal(screen.type, redirect);
  assert.equal(screen.props.href, '/(tabs)/search');
});
