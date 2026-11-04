const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const { createRequire } = require('node:module');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');
const queryString = require('query-string');

const root = path.join(__dirname, '..');
const routerRequire = createRequire(require.resolve('expo-router/package.json'));
const queryRequire = createRequire(routerRequire.resolve('query-string'));
const decode = queryRequire('decode-uri-component');

test('Router uses the patched CommonJS decoder, not the old registry dependency', () => {
  assert.equal(typeof decode, 'function');
  assert.equal(fs.realpathSync(queryRequire.resolve('decode-uri-component')),
    path.join(root, 'vendor/decode-uri-component/index.js'));
});

test('vendored decoding algorithm matches the official 0.5.1 tarball', () => {
  const source = fs.readFileSync(path.join(root, 'vendor/decode-uri-component/index.js'), 'utf8');
  const normalized = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, removeComments: true },
  }).outputText;
  // SHA-256 of official 0.5.1 source with only its export converted to CommonJS.
  assert.equal(createHash('sha256').update(normalized).digest('hex'),
    'f7d286b8c33286709c7c986d18ec75667de19b53b29e8c39bccc3b3a74bc2481');
});

test('OAuth parameters, Korean document names, and duplicate query values round-trip', () => {
  const name = '\uD55C\uAE00 \uBB38\uC11C';
  const parsed = queryString.parseUrl('mora://auth?' + queryString.stringify({
    token: 'synthetic-token+/=', name, state: 'sample-state',
    redirect: 'https://example.test/callback?code=sample&state=sample',
  }));
  assert.equal(parsed.url, 'mora://auth');
  assert.equal(parsed.query.token, 'synthetic-token+/=');
  assert.equal(parsed.query.name, name);
  assert.equal(parsed.query.redirect, 'https://example.test/callback?code=sample&state=sample');
  assert.deepEqual(queryString.parse('id=1&id=2').id, ['1', '2']);
  assert.equal(queryString.parse('q=a+b').q, 'a b');
});

test('malformed encoding remains non-throwing and decoded escapes are not decoded twice', () => {
  for (const [input, expected] of [
    ['%E0%A4%A', '%E0%A4%A'], ['%zz', '%zz'], ['%C2', '\uFFFD'],
    ['%FE%FF', '\uFFFD\uFFFD'], ['%25C3%25A5', '%C3%A5'],
    ['%ED%95%9C%EA%B8%80%zz', '\uD55C\uAE00%zz'],
  ]) assert.equal(decode(input), expected);
  assert.throws(() => decode(null), TypeError);
});

test('both percent-decoding denial-of-service inputs finish in a bounded worker', () => {
  const script = `
    const assert = require('node:assert/strict');
    const decode = require(process.argv[1]);
    let distinct = '';
    for (let i = 0; i < 32000; i++) {
      distinct += '%' + (i >> 8).toString(16).padStart(2, '0') +
        '%' + (i & 255).toString(16).padStart(2, '0') + 'x';
    }
    assert.ok(decode(distinct + '%zz').endsWith('%zz'));
    assert.equal(decode('%ea'.repeat(15000)).length, 45000);
  `;
  const result = spawnSync(process.execPath, ['-e', script, queryRequire.resolve('decode-uri-component')], {
    encoding: 'utf8', timeout: 5000,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
});

test('Metro retains its buffer and file-path image parser contract', async () => {
  const metroRequire = createRequire(require.resolve('metro/private/Assets'));
  const imageSize = metroRequire('image-size');
  const exported = imageSize.__esModule ? imageSize.default : imageSize;
  assert.equal(typeof exported, 'function');
  assert.deepEqual(exported(fs.readFileSync(path.join(root, 'assets/images/icon.png'))), {
    width: 1024, height: 1024, type: 'png',
  });
  const assets = metroRequire('metro/private/Assets');
  const asset = await assets.getAssetData(path.join(root, 'assets/images/icon.png'),
    'assets/images/icon.png', [], 'android', '/assets');
  assert.equal(asset.width, 1024);
  assert.equal(asset.height, 1024);
});

function authSchemas() {
  const filename = path.join(root, 'src/features/auth/schema.ts');
  const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS }, fileName: filename,
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(compiled, { module, exports: module.exports, require }, { filename });
  return module.exports;
}

test('updated Zod preserves real login/signup/nickname validation', () => {
  const { loginSchema, signupSchema, nicknameSchema } = authSchemas();
  assert.equal(loginSchema.parse({ email: '  MORA@example.test ', password: '1234' }).email,
    'mora@example.test');
  assert.equal(signupSchema.safeParse({ email: 'mora@example.test', password: '1234' }).success, false);
  assert.equal(signupSchema.safeParse({ email: 'mora@example.test', password: 'sample123' }).success, true);
  assert.equal(nicknameSchema.safeParse({ name: '\uBAA8\uB77C' }).success, true);
  assert.equal(nicknameSchema.safeParse({ name: '<script>' }).success, false);
});

test('React Hook Form resolver still produces values and field errors with updated Zod', async () => {
  const { zodResolver } = require('@hookform/resolvers/zod');
  const resolve = zodResolver(authSchemas().signupSchema);
  const invalid = await resolve({ email: 'invalid', password: '123' }, {}, {});
  assert.ok(invalid.errors.email);
  assert.ok(invalid.errors.password);
  const valid = await resolve({ email: 'MORA@example.test', password: 'sample123' }, {}, {});
  assert.equal(valid.values.email, 'mora@example.test');
  assert.equal(Object.keys(valid.errors).length, 0);
});
