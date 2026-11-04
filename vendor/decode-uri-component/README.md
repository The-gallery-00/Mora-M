# SDK 57 CommonJS compatibility copy

Source: `decode-uri-component@0.5.1` from the npm registry, MIT license.
Upstream: https://github.com/SamVerschueren/decode-uri-component

The only executable change to upstream `index.js` is replacing the ESM default
export with `module.exports = function`. Comment punctuation is ASCII-normalized.
The decoding algorithm is unchanged.
Expo Router 57 uses CommonJS `query-string@7.1.3`, which expects `require()`
to return a callable function. Upstream 0.5.1 is ESM-only.

The override is scoped to that query-string version, not to all dependencies.
This retains the upstream fixes for GHSA-vcc3-ghjq-m6fr and
GHSA-qr28-fpjm-wq7f without forcing an incompatible Router major upgrade.

Registry tarball integrity:
`sha512-vWHQkXgg2cE3BB4rR0c+PYw9BCQzLoNIRMI7AunIkZst74tw/vpPp7VLoYtsR/cy1f55g3XDWUslfeCZjiZJyA==`

Remove this directory and override once the SDK-supported router depends on
the fixed decoder with a compatible module interface. When updating this copy,
compare against the official tarball, preserve its license, and rerun
`npm run test:release` plus the production Android build.
