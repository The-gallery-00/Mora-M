# ADR-004 Styling

NativeWind v4로 스타일링하고, 색·간격·타이포·모서리 토큰은 `src/theme/tokens.ts` 단일 출처에서 Tailwind 설정으로 주입한다. 색은 **라이트/다크 두 벌**을 CSS 변수로 주입한다(§4).

상위: [[Architecture]]
관련: [[Design Tokens]] · [[Component Library]] · [[Mobile UX Guide]] · [[Conventions]] · [[ADR-001 Framework]] · [[Offline and State]] · [[Tech Stack]] · [[Screen Specs]] · [[QA Checklist]] · [[Scope]]

---

## 상태

**Accepted** — 2026-07-27. 사용자가 직접 선택.
**Amended** — 2026-07-27. §4 테마 결정이 뒤집혔다. 아래 개정 이력 참조.

### 개정 이력

| 일자 | 변경 | 영향 범위 |
|---|---|---|
| 2026-07-27 | **사용자 결정으로 다크모드를 v1 In scope로 편입 — 기존 "v1 라이트 고정" 결정 폐기.** 스타일링 수단(NativeWind v4)과 토큰 단일 출처 결정(§1~§3, §5)은 **변경 없이 유지**되며, 뒤집힌 것은 §4 테마 결정 하나다. | §4 전면 교체 · §맥락 요구사항 3 강화 · §결과 긍정 4/부정 6~8 · §재검토 트리거 2 소진 |

**폐기된 결정 원문 (기록 보존)** — 아래는 2026-07-27 오전까지 유효했던 §4의 원문이다. 지우지 않고 남긴다. 이 문단을 근거로 작성된 다른 문서 구절이 남아 있으면 전부 개정 대상이다.

> - v1은 **라이트 고정**으로 출시하되, 모든 색 사용처가 `className` 또는 `useTheme()`을 통과하도록 강제해 `dark:` variant 추가만으로 다크 모드가 가능한 상태를 유지한다. `app.json`에 `"userInterfaceStyle": "light"`를 명시해 네이티브 컴포넌트가 앱과 어긋나지 않게 한다.
> - 설정 화면의 테마 세그먼트는 노출하되 v1에서는 `라이트`만 활성. 근거: 웹 설정에 `theme` 값이 이미 존재하지만 실제 다크 스타일 정의가 없어 이식할 자산이 없다.
> - 다크 팔레트 확정은 v1 범위 밖이다 — [[Scope]] Deferred **D-17**. 상세 사유는 [[Design Tokens]] §10.

**폐기 사유** — 위 결정의 근거는 전부 "원본에 다크 자산이 없다"는 **공급 측 사실**이었고, "사용자가 다크를 원하지 않는다"는 **수요 측 근거는 한 번도 없었다.** 2026-07-27 사용자가 다크를 v1 필수로 확정했으므로 근거가 성립하지 않는다. 원본에 자산이 없다는 사실 자체는 여전히 참이며, 그것은 "안 한다"의 이유가 아니라 **"신규 설계이므로 비용과 리스크가 있다"**의 이유로 §결과에 다시 기록했다.

---

## 맥락

### 원본 웹의 스타일 실태

| 사실 | 내용 | 근거 |
|---|---|---|
| 토큰 파일은 있다 | `globals.css`의 `:root`에 `--color-primary: #15293D`, `--color-point: #0077B6`, 문서 유형 색 4쌍, `--radius-button/card` 정의 | 원본: `frontend/app/globals.css` |
| **그런데 거의 안 쓴다** | 대부분의 페이지가 CSS 변수를 쓰지 않고 인라인 `style`에 HEX를 직접 박았다 | 03-design §0-1 |
| 페이지마다 팔레트가 따로 있다 | `app/page.tsx`, `search/page.tsx`, `settings/page.tsx`, `storage/receipts/page.tsx`가 각각 로컬 `const C = {...}`를 선언하고 **값이 서로 다르다** | 01-screens §0-7 |
| 액센트가 3개로 갈렸다 | `#0077B6`(대시보드 계열) / `#3B82F6`(랜딩·설정·검색 계열) / `#FF8A3D`(랜딩 컴포넌트 계열) | 03-design §1-C, 02-components §0 |
| 문서 유형 색이 3벌 | `globals.css` 정본 / `dashboard/page.tsx` `TYPE_COLORS` / 캘린더 pill 색(티켓 `#FCE7F3`·포스터 `#DCFCE7`)이 서로 다름 | 01-screens §0-7 |
| 작성 방식도 2갈래 | 컴포넌트 18개 중 5개는 인라인 `style` 객체, 13개는 Tailwind `className` | 02-components §0 |
| 폰트 지정도 2갈래 | 로고가 `var(--font-logo)`와 `font-['Patua_One']` 두 방식으로 각각 지정됨 | 02-components §0 |

**즉, 이식해야 할 원본에는 신뢰할 수 있는 단일 디자인 토큰이 없다.** 이식의 첫 작업은 "복사"가 아니라 "정본 확정"이다.

### 요구사항

1. 원본 디자인 언어(네이비 `#15293D` + 액션 블루 `#0077B6`, 문서 유형 4색)를 유지한다.
2. **토큰이 단 하나의 출처에서 나와야 한다.** 파편화를 그대로 옮기면 모바일에서도 같은 문제가 재발한다.
3. **라이트/다크 두 테마를 v1에 모두 출시한다** — 테마 선택은 `시스템 따름`(기본값)/`라이트`/`다크` 3택이다. (2026-07-27 개정: 종전 "대응 여지를 남긴다"에서 필수 요구사항으로 강화. 웹 설정 화면에 `theme: 'light'|'dark'` 값이 이미 있으나 대응 스타일은 없어 **다크 팔레트는 신규 설계**다.)
4. Tailwind에 익숙한 팀 자산을 살린다(웹 컴포넌트 13개가 Tailwind 클래스).

---

## 검토한 대안

| 대안 | 장점 | 단점 | 기각 이유 |
|---|---|---|---|
| **NativeWind v4** | 웹 Tailwind 클래스 지식·자산 직결. `tailwind.config.js`가 곧 토큰 주입 지점이라 **단일 출처를 강제**하기 쉽다. `dark:` variant로 테마 대응. 조건부 스타일이 문자열 결합으로 간결. `className`이 컴포넌트 시그니처를 오염시키지 않음 | 빌드 체인(babel 플러그인 + metro 설정) 추가. 런타임 클래스 파싱 오버헤드(v4에서 크게 개선되었으나 0은 아님). RN에 없는 CSS 속성 클래스를 쓰면 조용히 무시됨. 타입 오타를 컴파일러가 못 잡음 | **채택** |
| 순수 `StyleSheet.create` | 의존성 0. RN 정석. 런타임 오버헤드 최소. 타입 안전 | 조건부·반응형 스타일이 장황해짐(`[styles.base, active && styles.active]`). 토큰을 import해서 쓰는 규율이 무너지기 쉬움 — **원본 웹이 정확히 이 방식으로 실패했다**(인라인 style에 HEX 직박기). 다크 모드는 전부 수동 분기 | **원본 실패를 재현할 위험이 가장 큰 선택.** 규율을 사람에게 맡기는 구조 |
| Tamagui | 컴파일 타임 최적화로 성능 최상. 자체 토큰/테마 시스템이 강력. 컴포넌트 라이브러리 동봉 | 학습 곡선이 가파르다(자체 DSL, `styled()`, 토큰 스케일 개념). 빌드 설정이 무겁고 Expo 업그레이드 시 호환 이슈가 잦다. 동봉 컴포넌트의 룩앤필이 강해 원본 디자인 언어를 덮어씀 | **팀 프로젝트 일정 대비 학습·유지 비용 과다.** 성능이 병목인 앱이 아니다 |
| react-native-unistyles | 런타임 오버헤드 거의 없음. 테마·브레이크포인트 1급 지원. `StyleSheet` API와 유사해 학습 쉬움 | 네이티브 모듈(v3부터 Nitro Modules)이 필요해 **Expo 관리형에서 dev client 빌드가 요구될 수 있다** → [[ADR-001 Framework]]의 "관리형 유지" 전제와 충돌. 생태계·레퍼런스가 NativeWind보다 적음 | **Phase 0의 "관리형 상태로 APK 관통"을 위협한다.** 성능 이점이 이 앱의 병목(이미지·네트워크)과 무관 |
| styled-components / emotion | 웹 CSS-in-JS 경험 전이 | RN에서 리렌더마다 스타일 객체 생성. 테마 접근이 Context 의존이라 깊은 트리에서 비용. 커뮤니티가 RN에서 이탈 중 | 성능·생태계 모두 열세 |

---

## 결정

### 1. NativeWind v4 채택 — 실측 확정 버전과 두 개의 제약

**확정 버전 (2026-07-27 Phase 0 실측)**: `nativewind 4.2.6` + `react-native-css-interop 0.2.6` + **`tailwindcss 3.4.19` 고정**.

**제약 1 — Tailwind 4를 쓸 수 없다.** NativeWind 4.2.6이 선언한 peer 범위는 `tailwindcss > 3.3.0` 이어서 npm이 4.x 설치를 막지 않지만, **NativeWind 4 계열은 Tailwind 4를 실제로 지원하지 않는다.** Tailwind 4 지원은 `nativewind@5.0.0-preview.4` 계열뿐이다. 그리고 이 실패는 **오류를 내지 않는다** — Tailwind 4가 들어오면 설정 파일 형식(`@theme` / CSS-first config)이 어긋나 **색 토큰이 조용히 적용되지 않는다.** 다크모드가 CSS 변수 2벌에 전면 의존하는 §4 결정에서 그 침묵은 곧 테마 붕괴다.

→ **`tailwindcss@3.4.x` 로 고정한다**([[Tech Stack]] VR-7). 커밋 게이트에 `npm ls tailwindcss` 를 넣어 강제하고([[QA Checklist]] §6-2), **재검토 트리거는 `nativewind@5` 정식 릴리스**다([[Risks]] RSK-33). preview를 v1 기반으로 삼지 않는다 — Phase 1~7 전체가 그 위에 쌓이면 되돌릴 수 없다.

> **원본 웹이 Tailwind 4라는 사실이 이 결정을 바꾸지 않는다.** 우리가 이식하는 것은 **클래스명 어휘**와 CSS 변수 개념이고, 그 둘은 Tailwind 3.4에서 전부 표현된다. 원본의 `@theme inline` 문법을 그대로 옮기려는 유인이 실재하므로 **위키 예시에 Tailwind 4 신문법을 쓰지 않는다.**

**제약 2 — `babel.config.js` 가 필수이고, 그것이 빌드 체인 함정을 하나 데려온다.** NativeWind는 (a) jsx 런타임 교체와 (b) `nativewind/babel` 프리셋 두 가지가 모두 필요하므로 `babel.config.js` 를 직접 만들어야 한다. 그런데 SDK 57은 `babel-preset-expo` 를 `node_modules/expo/node_modules/` 하위에 **중첩 설치**하므로, 우리가 만든 설정 파일에서 bare name `'babel-preset-expo'` 가 해석되지 않아 `Cannot find module 'babel-preset-expo'` 로 번들이 죽는다. **즉 NativeWind를 쓰기로 한 이 결정이 그 문제를 반드시 만나게 한다.**

→ **`babel-preset-expo` 를 명시 devDependency로 선언한다**([[Tech Stack]] PKG-42). 확정 형태:

```js
// babel.config.js — Phase 0 검증 완료 (Android 번들 1753 모듈 성공)
module.exports = function (api) {
  api.cache(true);
  return {
    presets: [
      ['babel-preset-expo', { jsxImportSource: 'nativewind' }],
      'nativewind/babel',
    ],
  };
};
```

`react-native-worklets/plugin` 을 **직접 추가하지 않는다** — `babel-preset-expo` 가 reanimated/worklets 플러그인을 자동 주입하므로 중복된다(실측).

- 스타일은 `className`으로 작성한다.
- **인라인 `style` 사용은 예외로만 허용**한다: (a) 런타임 계산값(애니메이션 `transform`, 측정 기반 크기, bbox 오버레이 좌표), (b) NativeWind가 지원하지 않는 속성. 그 외에 인라인 `style`이 보이면 리뷰에서 반려한다 — 원본 웹의 실패 모드를 재발시키지 않기 위한 명시적 규율.
- 조건부 스타일은 `clsx` 또는 `tailwind-variants`로 작성한다. 문자열 템플릿 결합 금지(정적 추출 실패).

### 2. 토큰 단일 출처

```
theme/tokens.ts        ← 유일한 정본. 색·간격·radius·타이포·그림자
   ├─→ tailwind.config.js  (theme.extend 에 spread)
   └─→ 런타임 소비처        (Reanimated, expo-image placeholder, StatusBar, 네이티브 헤더 등
                             className 을 못 쓰는 지점)
```

> 아래 두 블록은 **단일 출처 구조를 설명하는 발췌**다. 다크모드 편입(§4) 이후 실제 파일은 색을 `light`/`dark` 두 객체로 갖고 `tailwind.config.js`는 HEX 대신 CSS 변수를 참조한다 — **완성형 코드는 [[Design Tokens]] §13-1~13-3**이며 값이 충돌하면 그쪽이 이긴다. 여기서 읽을 것은 "화살표 방향"뿐이다.

```ts
// src/theme/tokens.ts — 발췌(라이트 값). 전체 값과 다크 대응은 [[Design Tokens]] 가 정본
export const colors = {
  primary: '#15293D',        // 브랜드 네이비 — 로고/제목/제출버튼
  point:   '#0077B6',        // 액션 블루 — 주요 버튼/활성 상태
  bg: '#FFFFFF', surface: '#F8FAFC', surfaceAlt: '#F1F5F9', activeBg: '#F0F9FF',
  text: '#111111', textStrong: '#333333', subtitle: '#505050',
  mute: '#64748B', faint: '#94A3B8', disabled: '#999999',
  border: '#CBD5E1', borderSoft: '#E2E8F0', borderFaint: '#F1F5F9',
  danger: '#DC2626', dangerSoft: '#FEE2E2', dangerFaint: '#FEF2F2', dangerBorder: '#FECACA',
  success: '#16A34A', successSoft: '#DCFCE7',
  warnBg: '#FFFBEB', warnBorder: '#FDE68A', warnText: '#92400E',
} as const;

// fg = 배지 텍스트 색. 원본값 중 대비 4.5:1 미달인 3개는 [[Design Tokens]] §9에서 보정했다.
export const docTypes = {
  BUSINESS_CARD: { fg: '#15293D', bg: '#E8EDF3', label: '명함' },   // 12.6:1
  TICKET:        { fg: '#6746AF', bg: '#E9E5FA', label: '티켓' },   //  5.6:1
  POSTER:        { fg: '#0069A0', bg: '#E8EDF3', label: '포스터' }, // 원본 #0077B6(4.1:1) → 5.1:1
  RECEIPT:       { fg: '#166534', bg: '#CFE5D0', label: '영수증' }, // 원본 #4FB048(2.1:1) → 5.4:1
  DEADLINE:      { fg: '#B45309', bg: '#FEF3E2', label: '마감' },   // 원본 #DC8540(2.6:1) → 4.6:1
} as const;
// 원본 fg(#0077B6 / #4FB048 / #DC8540)는 비텍스트 용도(아이콘·프로그레스·컬러바)에만 그대로 쓴다.

export const radius  = { xs:4, sm:6, md:8, button:10, card:12, lg:14, xl:16, panel:20, pill:999 } as const;
export const spacing = { xxs:4, xs:6, sm:8, md:12, lg:16, xl:20, xxl:24, xxxl:32 } as const;
```

```js
// tailwind.config.js
const { colors, docTypes, radius, spacing } = require('./theme/tokens');
module.exports = {
  presets: [require('nativewind/preset')],
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './features/**/*.{ts,tsx}'],
  theme: { extend: {
    colors: { ...colors, doc: Object.fromEntries(
      Object.entries(docTypes).map(([k, v]) => [k.toLowerCase(), { DEFAULT: v.fg, bg: v.bg }])) },
    borderRadius: radius,
    spacing,
  }},
};
```

### 3. 파편화 정리 규칙 (원본 3벌 → 1벌)

| 원본의 갈라짐 | 정본 결정 | 이유 |
|---|---|---|
| 액센트 `#0077B6` vs `#3B82F6` vs `#FF8A3D` | **`#0077B6` 하나로 통일** | 대시보드(로그인 후 사용 시간의 대부분)의 액션 색이다. `#3B82F6`은 랜딩·설정에만 산발적으로 등장했고, `#FF8A3D`는 미사용 랜딩 컴포넌트 계열(`landing/*.tsx`)에만 있다 |
| 문서 유형 색 3벌 | **`dashboard/page.tsx` `TYPE_COLORS` 정본 채택 + 배지 텍스트 대비 보정** (`docTypes` 표) | `TYPE_COLORS`가 `globals.css`와 일치하면서 명함까지 유일하게 정의한다. 캘린더 pill 전용 색(티켓 `#FCE7F3`, 포스터 `#DCFCE7`)과 랜딩 목업 팔레트는 폐기. 대비 미달 fg 3개는 [[Design Tokens]] §9의 보정값을 쓴다 |
| 로고 폰트 2방식 | **`PatuaOne` 하나** (`expo-font`로 번들) | |
| 본문 폰트 | **Pretendard** 번들. 원본 CSS는 `'Pretendard'`를 첫 순위로 지정하면서 실제로는 로드하지 않고 `Noto Sans KR`로 폴백되고 있었다 | Phase 1에서 Pretendard를 실제로 번들해 의도대로 만든다 |
| radius 값 산재 | `radius` 스케일 9단 | |

### 4. 테마(라이트/다크) — v1 In scope

**결정: 라이트/다크 두 테마를 v1에 출시한다.** 값의 정본은 [[Design Tokens]] §10(팔레트) / §13(배선)이고, 이 ADR은 **수단과 강제 규칙**만 정한다.

| 항목 | 결정 | 이유 |
|---|---|---|
| 테마 선택 | `시스템 따름`(기본값) / `라이트` / `다크` 3택. 변경 지점은 설정 화면(SCR-25) 세그먼트 하나 | 2택(라이트/다크)만 두면 OS 설정을 존중하지 않아 기기 전역 다크 사용자에게 앱이 튄다. 3택이 모바일 관례다 |
| 영속 | MMKV `theme.mode` ([[Offline and State]] §1-4). **v4 API**: 인스턴스는 `createMMKV({ id })`, 삭제는 `remove()` | MMKV는 **동기** 읽기라 부팅 첫 프레임에 복원된다. AsyncStorage는 rehydrate가 한 틱 늦어 라이트로 깜빡인다([[Tech Stack]]가 AsyncStorage를 기각한 이유와 동일) |
| 전환 수단 | **CSS 변수 2벌** (`:root` / `.dark:root`) + `darkMode: 'class'` + `nativewind` `colorScheme.set()` | 값이 변수 뒤로 숨으므로 컴포넌트는 `bg-bg-base` 하나만 쓰고 테마를 모른다. §2 토큰 단일 출처가 테마 2벌에서도 그대로 성립한다 |
| **`dark:` variant 사용 금지(색에 한해)** | 색 분기(`bg-white dark:bg-black`)를 금지한다. `dark:`는 변수로 표현 불가한 것(다크에서 특정 이미지 숨김, `borderWidth` 증감)에만 허용 | `dark:`로 색을 분기하면 컴포넌트마다 HEX 두 개가 다시 등장한다 — **원본 웹의 실패 모드(팔레트 파편화)를 테마 축으로 재현**하는 것이다. 이 규칙이 없으면 §2의 이점이 무너진다 |
| 네이티브 | `app.config.js` `userInterfaceStyle: "automatic"` (구 결정의 `"light"` 폐기) | 액션시트·날짜 피커·키보드가 앱 테마와 함께 움직여야 한다 |
| 스플래시 | 라이트/다크 2장 번들(`expo-splash-screen` `dark` 옵션). 단 스플래시는 네이티브 리소스라 `theme.mode`를 못 읽고 **OS 테마만 따른다** | OS=다크 + 사용자 선택=라이트 조합에서 1프레임 점프를 감수한다. 대안(스플래시 라이트 고정)은 OS 다크 사용자 전원에게 매 실행 흰 섬광을 준다 |
| 런타임 소비처 | `className`을 못 쓰는 지점(Reanimated, 네이티브 헤더, StatusBar, `expo-image` placeholder, BottomSheet backdrop, elevation, SVG `fill`)은 `useTheme()`이 반환하는 `ThemeTokens`에서만 색을 얻는다 | §결과 부정 5의 "두 경로 공존"이 테마 2벌에서도 값이 어긋날 수 없는 이유. 변수와 객체가 같은 `tokens.ts`에서 생성된다 |
| 브랜드 색 | 브랜드 아이덴티티(`#15293D` 딥네이비 / `#0077B6` 액션블루)는 **hue를 보존**하고 다크 전용 변형을 새로 정의한다(`#AEC4D8` / `#4BA3DB`) | `#15293D`는 다크 베이스 `#0F1621` 위에서 1.22:1로 배경과 붙어 사라진다. 그대로 쓸 수 없다 — 상세 계산은 [[Design Tokens]] §10-3 |
| 검증 기준 | 모든 텍스트 조합 **WCAG AA 4.5:1**(대형 텍스트·비텍스트 경계 3:1). 대비비 계산값을 [[Design Tokens]] §10-3/§10-4 표에 기재하고 값 변경 시 재계산 | 원본이 없어 "예쁜가"를 대조할 기준이 없다. **대비비가 유일하게 객관적인 합격선**이다 |

[[Scope]] Deferred **D-17**(다크 팔레트 확정)은 이 결정으로 **해소**된다.

### 5. 금지 사항 (리뷰 체크)

1. 컴포넌트 파일 안에서 **HEX 리터럴 선언 금지.** 색은 `className` 또는 `tokens.ts` import만.
2. 페이지 로컬 팔레트 상수(`const C = {...}`) **금지.** 원본 웹의 핵심 실패 모드다.
3. `className`을 런타임 문자열 결합으로 만들지 말 것 (`` `bg-${color}-500` `` 금지). 조건부는 완전한 클래스명을 분기로 나열.
4. 매직 넘버 spacing 금지. `spacing` 스케일 밖의 값이 필요하면 스케일을 늘릴지 먼저 논의.
5. **`dark:` variant로 색을 분기하는 것 금지** (`bg-white dark:bg-black`). 색은 CSS 변수가 이미 테마별로 갈리므로 의미론적 클래스 하나면 끝난다 — §4.
6. **RN의 `useColorScheme()`을 화면에서 직접 호출 금지.** 3택 오버라이드를 모르므로 `시스템 따름`이 아닌 사용자에게 틀린 값을 준다. `useTheme()` 또는 nativewind의 `useColorScheme()`만 사용하고, RN import는 ESLint `no-restricted-imports`로 차단한다 ([[Conventions]]).
7. **한 컴포넌트가 한 테마에서만 검수된 상태로 머지 금지.** Phase 1 갤러리 화면(`app/(dev)/gallery.tsx`)에서 두 테마 스크린샷을 PR에 첨부한다.

---

## 결과

### 긍정
1. 토큰이 `tokens.ts` 한 곳이라 색 하나를 바꾸면 앱 전체가 따라온다. 원본에서 가장 비쌌던 문제(팔레트 4벌 + 유형색 3벌)가 구조적으로 재발할 수 없다.
2. 웹 Tailwind 클래스 지식이 그대로 전이된다. 컴포넌트 13개의 클래스 문자열이 상당 부분 참고 가능하다.
3. 조건부 스타일이 짧아져 리스트 셀·칩·버튼처럼 상태가 많은 컴포넌트의 가독성이 좋다.
4. **다크모드가 "재작성"이 아니라 "값 한 벌 추가"로 끝난다.** CSS 변수 2벌 + `useTheme()` 구조 덕분에 컴포넌트 코드는 테마를 모른다 — 이 ADR이 대안들을 기각하며 지킨 단일 출처 원칙이 다크 편입(2026-07-27)에서 실제로 배당을 지급했다. 순수 `StyleSheet`를 택했다면 CMP 52종 전체에 수동 분기가 들어갔을 것이다.
5. Expo 관리형을 유지한다(네이티브 모듈 불필요) — Phase 0 APK 관통에 영향 없음.

### 부정
1. **런타임 파싱 오버헤드가 0은 아니다.** 긴 리스트에서 셀마다 복잡한 조건부 클래스를 계산하면 스크롤 성능에 영향이 있다. 완화: 리스트 셀은 `tailwind-variants`로 클래스 계산을 메모이즈하고, 셀 컴포넌트를 `React.memo`로 감싼다.
2. **타입 안전성이 약하다.** 오타 난 클래스는 조용히 무시된다. 완화: `eslint-plugin-tailwindcss` + VS Code Tailwind IntelliSense를 [[Conventions]]에 필수로 명시.
3. **RN에 없는 CSS 속성**(`box-shadow`, `backdrop-filter`, `position: sticky`, `object-fit` 등)을 웹 감각으로 쓰면 무시된다. 완화: 그림자는 `tokens.shadow`의 iOS/Android 이중 스펙을, 블러는 `expo-blur`를 쓰도록 [[Component Library]]에 대응표를 둔다.
4. 빌드 체인 의존이 하나 늘어난다(babel 플러그인, metro). Expo SDK 업그레이드 시 NativeWind 호환 버전을 함께 확인해야 한다. **Phase 0에서 이 비용이 실제로 발생했다** — `babel.config.js` 를 만든 직후 `Cannot find module 'babel-preset-expo'` 로 번들이 죽어 devDependency 명시가 필요했다(§1 제약 2). 그리고 **`tailwindcss` 버전이 NativeWind 4에 묶여 3.4.x에 고정된다**(§1 제약 1, [[Risks]] RSK-33).
5. 런타임 소비처(Reanimated, 네이티브 헤더 옵션, StatusBar)는 `className`을 못 쓰므로 `tokens.ts`를 직접 import한다 — **두 경로가 공존**한다. 완화: 같은 파일에서 나오므로 값이 어긋날 수 없다는 점을 규약으로 명시. 다크 편입 후에는 이 경로가 `useTheme()`을 반드시 통과해야 한다(모듈 최상단 import는 테마 변경에 반응하지 않는다).

**다크모드 편입(2026-07-27)이 새로 발생시킨 부정적 영향**

6. **Phase 1 작업량 ≈1.5배.** 토큰을 두 벌 정의하고 CSS 변수·`useTheme()`·`themeStore`를 배선한 뒤, **Phase 1 산출 CMP 21종(+ 테마 시스템 이전에 만든 Phase 0 소급 2종) = 23종을 두 테마에서 각각 눈으로 확인**해야 한다. 색이 하드코딩된 컴포넌트가 하나라도 남으면 다크에서 즉시 드러난다. 완화: `app/(dev)/gallery.tsx`에 테마 토글을 넣어 한 화면에서 그 페이즈 산출분을 동시 비교하고, 컴포넌트 PR마다 두 테마 스크린샷을 요구한다(§5 금지사항 7). **누적 52종은 한 페이즈에 몰지 않는다** — 검수는 산출 시점 검수이며 Phase 2~6이 나머지 29종을, Phase 7이 누적 완료 확인만 담당한다([[Requirements]] FR-128 · FR-112).
7. **Phase 7 QA 매트릭스 2배.** 화면 31개 × 2테마. 기기 매트릭스와는 곱하지 않는다(테마는 OS 버전·기기와 독립이라 1개 기기에서 두 테마를 돌리면 충분하다) — 케이스 정본은 [[QA Checklist]]. 추가로 "테마 전환 중 상태 유실 없음", "OS 테마 변경 즉시 반영", "재시작 후 선택 복원"이라는 **전환 자체의 회귀 케이스**가 새로 생긴다.
8. **다크 팔레트에 참조할 원본이 없다 — 디자인 리스크.** 원본 웹은 화이트 테마 전제이고 `globals.css`에 다크 변수가 존재하지 않으므로, 다크 값 전부(표면 8단·텍스트 5단·상태색 4쌍·문서 4종+마감)가 **신규 설계**다. 대비비는 계산으로 보증되지만 **"브랜드처럼 보이는가"는 실기기 확인 전까지 미검증**이다. 완화: (a) 브랜드 두 색의 hue를 고정 제약으로 삼아 자유도를 좁혔고, (b) 새 HEX를 최소화해 라이트 값의 역할을 재사용했고([[Design Tokens]] DK-09), (c) Phase 1 갤러리에서 **OLED 실기기 1회 검수**를 DoD에 넣는다. 어긋나면 고칠 지점은 `tokens.ts` 한 곳이다.
9. **테마와 무관하게 남는 국소 예외가 생긴다.** 스캔 리뷰 화면(SCR-12)은 흰 종이 문서 이미지가 화면 절반을 차지해, 다크에서도 **이미지 영역만 라이트 표면**을 유지한다([[Design Tokens]] §10-5). 즉 "모든 화면이 테마를 따른다"는 단순한 문장이 성립하지 않으며, 이 예외는 [[Screen Specs]]에 명시적으로 기록되어야 한다.

---

## 재검토 트리거

1. 보관함/검색 리스트 스크롤에서 **프레임 드랍이 클래스 계산에 기인함이 프로파일링으로 확인**될 때 → 해당 컴포넌트만 `StyleSheet`로 내리거나 Unistyles를 재평가.
2. ~~**다크 모드가 정식 요구사항**이 될 때 → 토큰을 semantic layer로 한 겹 추상화할지 결정.~~ **소진 — 2026-07-27 발생.** 결론: 추상화했다. 팔레트 이름(`slate100`)을 컴포넌트에서 완전히 걷어내고 의미론적 2계층(`bg.base`/`surface.alt`/`text.muted` …)으로 재편했으며, CSS 변수 2벌이 그 계층의 물리적 구현이다 — §4, [[Design Tokens]] §10-3.
3. Expo SDK 업그레이드에서 **NativeWind 호환이 장기간 깨질** 때.
4. 디자인 시스템이 커져 컴포넌트 variant 수가 관리 한계를 넘을 때 → Tamagui 같은 컴파일 타임 솔루션 재평가.
5. **`nativewind@5` 정식 릴리스 (Tailwind 4 지원)** → `tailwindcss` 를 4로 올릴지 결정한다([[Risks]] RSK-33). 판단 기준은 "우리가 Tailwind 4의 기능을 실제로 원하는가"이고 현재 답은 아니다 — 우리는 클래스명 어휘와 CSS 변수만 쓴다. **즉 이 고정은 기능 손실이 거의 없으므로 서둘러 올릴 이유가 없다.** preview 릴리스는 트리거가 아니다.
