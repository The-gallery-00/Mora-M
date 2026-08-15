// assets/legal/licenses.ko.ts — 오픈소스 라이선스 (SCR-30 `doc=licenses`)
//
// Screen Specs SCR-30 문서 표는 소스를 `빌드 시 생성(npx license-checker --json)` 으로 적어 두었다.
// 그 파이프라인은 아직 없고 **패키지 설치가 금지**되어 있으므로(license-checker 도 패키지다),
// 지금은 `package.json` 의 **직접 의존성**을 손으로 옮겨 적는다.
//
// 라이선스 종류는 추측하지 않고 `node_modules/<pkg>/package.json` 의 `license` 필드를 읽어 확인했다
// (2026-07-28 기준 전부 MIT). 의존성을 추가·제거하면 이 목록도 함께 고쳐야 한다 —
// 나중에 생성 스크립트가 생기면 이 파일을 그 산출물로 교체한다.
//
// `.md` 가 아니라 `.ts` 인 이유는 `terms.ko.ts` 상단 주석 참조.

export const LICENSES_KO = `
MORA 앱은 아래 오픈소스 소프트웨어를 사용합니다. 각 소프트웨어의 저작권은 해당 저작권자에게 있으며,
원 라이선스의 조건에 따라 배포됩니다.

## 프레임워크 · 런타임

| 이름 | 라이선스 |
|---|---|
| React | MIT |
| React Native | MIT |
| Expo (expo, expo-router 외 expo-* 모듈 일체) | MIT |
| react-native-web | MIT |

## 상태 · 데이터

| 이름 | 라이선스 |
|---|---|
| TanStack Query (@tanstack/react-query) | MIT |
| Zustand | MIT |
| Zod | MIT |
| React Hook Form | MIT |
| @hookform/resolvers | MIT |
| react-native-mmkv | MIT |
| @react-native-community/netinfo | MIT |

## UI · 애니메이션

| 이름 | 라이선스 |
|---|---|
| NativeWind | MIT |
| Tailwind CSS | MIT |
| react-native-reanimated | MIT |
| react-native-worklets | MIT |
| react-native-gesture-handler | MIT |
| react-native-screens | MIT |
| react-native-safe-area-context | MIT |
| react-native-svg | MIT |
| @shopify/flash-list | MIT |
| @gorhom/bottom-sheet | MIT |
| react-native-nitro-modules | MIT |

## 글꼴

| 이름 | 라이선스 |
|---|---|
| Pretendard | SIL Open Font License 1.1 |
| Patua One | SIL Open Font License 1.1 |
| Space Mono | SIL Open Font License 1.1 |

## 서버 측 오픈소스

| 이름 | 라이선스 |
|---|---|
| Spring Boot | Apache License 2.0 |
| FastAPI | MIT |
| PaddleOCR / PaddlePaddle | Apache License 2.0 |
| PostgreSQL | PostgreSQL License |
| Bucket4j | Apache License 2.0 |

## MIT License 전문

\`\`\`
Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
\`\`\`

Apache License 2.0 및 SIL Open Font License 1.1 전문은 아래 주소에서 확인할 수 있습니다.

- https://www.apache.org/licenses/LICENSE-2.0
- https://openfontlicense.org

---

© 2026 MORA. All rights reserved.

https://github.com/The-gallery-00/Mora-M
`.trim();
