const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

// Exercise the real TypeScript without importing Expo's native runtime in Node.
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
    URL,
    require(name) {
      assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency: ${name}`);
      return dependencies[name];
    },
    ...globals,
  }, { filename });
  return module.exports;
}

function imageHarness() {
  const values = new Map();
  const env = loadSource('src/config/env.ts', {
    'expo-constants': { default: {} },
    '@/services/session': { clearSession: async () => {} },
    '@/store/storage': {
      StorageKey: { serverApiUrl: 'api', serverOcrUrl: 'ocr' },
      storage: {
        getString: (key) => values.get(key),
        set: (key, value) => values.set(key, value),
        remove: (key) => values.delete(key),
        contains: (key) => values.has(key),
      },
    },
  }, {
    process: { env: {
      EXPO_PUBLIC_API_URL: 'https://spring.test',
      EXPO_PUBLIC_OCR_URL: 'https://ocr.test',
    } },
  });
  const images = loadSource('src/services/documentImages.ts', { '@/config/env': env });
  return { env, images, values };
}

const sessionA = { token: 'token-a', userId: 'owner-a' };
const sessionB = { token: 'token-b', userId: 'owner-b' };
const anonymous = { token: null, userId: null };
const upload = '/uploads/RECEIPT/receipt.jpg';

test('relative and configured, build-time, and historical OCR uploads resolve to Spring', () => {
  const { env, values } = imageHarness();
  const expected = `https://spring.test${upload}`;
  for (const uri of [
    upload,
    upload.slice(1),
    `https://ocr.test${upload}`,
    `https://mora-mobile-ocr-971562891559.asia-northeast3.run.app${upload}`,
  ]) assert.equal(env.resolveImageUrl(uri), expected);

  values.set('ocr', 'http://10.0.2.2:8000');
  assert.equal(env.resolveImageUrl(`http://10.0.2.2:8000${upload}`), expected);
  assert.equal(env.resolveImageUrl(`https://ocr.test${upload}`), expected);
  assert.equal(env.resolveImageUrl(`https://ocr.test${upload}?v=1#ignored`), `${expected}?v=1`);
});

test('bearer headers are limited to the exact Spring origin and uploads path', () => {
  const { env, images } = imageHarness();
  const trusted = images.getDocumentImageSource(upload, sessionA);
  assert.equal(trusted.uri, `https://spring.test${upload}`);
  assert.equal(trusted.headers.Authorization, 'Bearer token-a');

  for (const uri of [
    'https://spring.test.evil.test/uploads/a.jpg',
    'https://spring.test@evil.test/uploads/a.jpg',
    'https://other.test/uploads/a.jpg',
    'http://spring.test/uploads/a.jpg',
    'https://spring.test:444/uploads/a.jpg',
    'https://user:password@spring.test/uploads/a.jpg',
    'https://spring.test/profile/avatar.jpg',
    'https://spring.test/uploads-other/a.jpg',
    'https://spring.test/profile?next=/uploads/a.jpg',
    'https://spring.test/uploads/../profile/a.jpg',
    'https://spring.test/uploads/%2e%2e/profile/a.jpg',
    '//evil.test/uploads/a.jpg',
    'file:///cache/scan.jpg',
    'content://media/external/images/1',
    'not a URL',
  ]) {
    assert.equal(env.isTrustedDocumentImageUrl(uri), false, uri);
    assert.equal(images.getDocumentImageSource(uri, sessionA)?.headers, undefined, uri);
  }
  assert.equal(env.resolveImageUrl('/uploads/../profile/a.jpg'), null);
});

test('public and local images stay unchanged, including while logged out', () => {
  const { env, images } = imageHarness();
  for (const uri of [
    'https://profiles.test/avatar.jpg',
    'https://spring.test/brand.png',
    'file:///cache/scan.jpg',
    'content://media/external/images/1',
  ]) {
    assert.equal(env.resolveImageUrl(uri), uri);
    assert.equal(images.getDocumentImageSource(uri, anonymous).uri, uri);
    assert.equal(images.getDocumentImageSource(uri, sessionA).headers, undefined);
  }
  assert.equal(images.getDocumentImageSource(null, sessionA), null);
  assert.equal(images.getDocumentImageSource('', sessionA), null);
});

test('private images require a session and their cache identity is account-specific, not a JWT', () => {
  const { images } = imageHarness();
  assert.equal(images.getDocumentImageSource(upload, anonymous), null);
  assert.equal(images.getDocumentImageSource(upload, { ...sessionA, token: null }), null);
  assert.equal(images.getDocumentImageSource(upload, { ...sessionA, userId: null }), null);
  const a = images.getDocumentImageSource(upload, sessionA);
  const b = images.getDocumentImageSource(upload, sessionB);
  const refreshed = images.getDocumentImageSource(upload, { ...sessionA, token: 'new-token' });
  assert.notEqual(a.cacheKey, b.cacheKey);
  assert.equal(a.cacheKey, refreshed.cacheKey);
  assert.equal(refreshed.headers.Authorization, 'Bearer new-token');
  assert.equal(a.cacheKey.includes(sessionA.token), false);
});

test('server overrides restrict tokens to the current Spring origin and base path', () => {
  const { images, values } = imageHarness();
  values.set('api', 'https://replacement.test/gateway');
  assert.equal(images.getDocumentImageSource(upload, sessionA).uri,
    `https://replacement.test/gateway${upload}`);
  for (const uri of [
    `https://spring.test${upload}`,
    `https://replacement.test${upload}`,
    `https://replacement.test/gateway-other${upload}`,
  ]) assert.equal(images.getDocumentImageSource(uri, sessionA).headers, undefined);
});

test('DocumentImage reflects logout/account/token changes and enforces memory-only owner caching', () => {
  const { images } = imageHarness();
  let state = { status: 'authenticated', token: sessionA.token, user: { id: sessionA.userId } };
  const { DocumentImage } = loadSource('src/components/documents/DocumentImage.tsx', {
    'expo-image': { Image: 'NativeImage' },
    react: {
      useMemo: (fn) => fn(),
      createElement: (type, props) => ({ type, props, key: props.key }),
    },
    'react/jsx-runtime': { jsx: (type, props, key) => ({ type, props, key }) },
    '@/services/documentImages': images,
    '@/store/authStore': { useAuthStore: (selector) => selector(state) },
  });
  const onLoad = () => {};
  const a = DocumentImage({ uri: upload, onLoad });
  assert.equal(a.props.cachePolicy, 'memory');
  assert.equal(a.props.recyclingKey, a.props.source.cacheKey);
  assert.equal(a.props.onLoad, onLoad);
  assert.equal(a.props.source.headers.Authorization, 'Bearer token-a');
  state = { ...state, token: 'refreshed' };
  assert.equal(DocumentImage({ uri: upload }).props.source.headers.Authorization, 'Bearer refreshed');
  state = { status: 'anonymous', token: null, user: null };
  assert.equal(DocumentImage({ uri: upload }), null);
  state = { status: 'authenticated', token: sessionB.token, user: { id: sessionB.userId } };
  const b = DocumentImage({ uri: upload });
  assert.notEqual(a.key, b.key);
  assert.notEqual(a.props.source.cacheKey, b.props.source.cacheKey);
});

function scanHarness() {
  const { env } = imageHarness();
  const requests = [];
  class MockXHR {
    headers = {};
    upload = {};
    constructor() { requests.push(this); }
    open(method, url) { this.method = method; this.url = url; }
    setRequestHeader(key, value) { this.headers[key] = value; }
    send(form) { this.form = form; }
    abort() { this.onabort?.(); }
    respond(status, body) {
      this.status = status;
      this.responseText = JSON.stringify(body);
      this.onload();
    }
  }
  class MockFormData {
    parts = new Map();
    append(key, value) { this.parts.set(key, value); }
  }
  const api = loadSource('src/features/scan/api.ts', {
    '@/config/env': env,
    '@/mocks/config': { isMockEnabled: () => false },
    '@/mocks/scan': {},
    '@/services/http': {},
    '@/services/session': { getTokenSync: () => sessionA.token },
    './fieldSchema': {},
    './types': { isDocumentType: (type) => type === 'RECEIPT' },
  }, { XMLHttpRequest: MockXHR, FormData: MockFormData });
  return { api, requests };
}

const file = { uri: 'file:///cache/prepared.jpg', name: 'prepared.jpg', type: 'image/jpeg' };

test('commit uses the authenticated Spring gateway, keeps multipart fields, and unwraps the same envelope', async () => {
  const { api, requests } = scanHarness();
  const blocks = [{ block_index: 0, text: 'item', bbox: [], confidence: 1 }];
  const corrected = { total: '1000' };
  const handle = api.commitDocument(file, 'RECEIPT', blocks, corrected);
  const xhr = requests[0];
  assert.equal(xhr.method, 'POST');
  assert.equal(xhr.url, 'https://spring.test/api/commit');
  assert.equal(xhr.headers.Authorization, 'Bearer token-a');
  assert.equal(xhr.headers['Content-Type'], undefined);
  assert.equal(xhr.form.parts.get('file').uri, file.uri);
  assert.equal(xhr.form.parts.get('document_type'), 'RECEIPT');
  assert.equal(xhr.form.parts.get('raw_blocks'), JSON.stringify(blocks));
  assert.equal(xhr.form.parts.get('corrected_fields'), JSON.stringify(corrected));
  xhr.respond(200, { success: true, data: { image_url: upload, count: 1 } });
  const result = await handle.promise;
  assert.equal(result.ok, true);
  assert.equal(result.data.imageUrl, upload);
  assert.equal(result.data.count, 1);
});

test('scan remains authenticated and retains double-envelope parsing', async () => {
  const { api, requests } = scanHarness();
  const handle = api.scanImage(file, { documentType: 'RECEIPT' });
  const xhr = requests[0];
  assert.equal(xhr.url, 'https://spring.test/api/scan');
  assert.equal(xhr.headers.Authorization, 'Bearer token-a');
  xhr.respond(200, { success: true, data: { success: true, data: {
    type: 'RECEIPT', classified: false, raw_blocks: [], parsed: { total: '1000' },
  } } });
  const result = await handle.promise;
  assert.equal(result.ok, true);
  assert.equal(result.data.type, 'RECEIPT');
  assert.equal(result.data.parsed.total, '1000');
});

test('failed or canceled commits cannot become successful image URLs', async () => {
  for (const status of [401, 403, 502, 503]) {
    const { api, requests } = scanHarness();
    const handle = api.commitDocument(file, 'RECEIPT');
    requests[0].respond(status, { success: false, error: 'Rejected' });
    const result = await handle.promise;
    assert.equal(result.ok, false);
    assert.equal(result.error.status, status);
  }
  const { api } = scanHarness();
  const handle = api.commitDocument(file, 'RECEIPT');
  handle.cancel();
  assert.equal((await handle.promise).canceled, true);
});
/* global __dirname */
