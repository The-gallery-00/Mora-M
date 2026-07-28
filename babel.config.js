// babel-preset-expo 가 reanimated/worklets 플러그인을 자동 주입한다. 직접 추가하면 중복된다.
// nativewind 는 (1) jsx 런타임 교체 (2) nativewind/babel 프리셋 두 가지가 모두 필요하다.
module.exports = function (api) {
  api.cache(true);
  return {
    presets: [
      ['babel-preset-expo', { jsxImportSource: 'nativewind' }],
      'nativewind/babel',
    ],
  };
};
