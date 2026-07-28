// src/i18n/index.ts
//
// FR-111 — 다국어 준비. **번역기가 아니라 키 추출 구조다.**
// v1 의 로케일은 `ko` 하나뿐이고 런타임 로케일 전환도 없다. 실제 번역은 v2(Scope D-13).
//
//   import { t } from '@/i18n';
//   t('archive.empty.title')                 // 문자열
//   t('auth.socialSuccess', { provider: 'Google' })   // {provider} 치환
//   tList('chat.help.items')                 // 문자열 배열
//
// ── 왜 이 모양인가 ────────────────────────────────────────────────────────
// * **런타임 비용 0에 가깝다.** 카탈로그는 정적 객체 하나이고 `t` 는 점 경로를 훑는 순수 함수다.
//   Provider·Context·번들 분할이 없다 → 콜드스타트(NFR-001)에 영향을 주지 않는다.
// * **키가 타입이다.** `TranslationKey` 는 카탈로그에서 유도되므로 오타·삭제된 키는
//   `npm run typecheck` 에서 잡힌다. i18next 처럼 문자열이 뚫려 있지 않다.
// * **의존성 방향이 한쪽이다.** i18n → (아무것도 import 하지 않음). 화면이 i18n 을 import 한다.
//   반대 방향을 만들면 순환 참조가 된다.
import { ko } from './ko';

export { ko } from './ko';
export type { KoCatalog } from './ko';

/** v1 은 단일 로케일이다. en 을 추가할 때 이 유니온과 `CATALOGS` 만 늘리면 된다. */
export type Locale = 'ko';
export const DEFAULT_LOCALE: Locale = 'ko';

// ─────────────────────────────────────────────────────── 키 타입 유도

type Join<P extends string, K extends string> = P extends '' ? K : `${P}.${K}`;

/** 값이 문자열인 잎의 점 경로. */
type StringLeaves<T, P extends string = ''> = {
  [K in Extract<keyof T, string>]: T[K] extends string
    ? Join<P, K>
    : T[K] extends readonly string[]
      ? never
      : StringLeaves<T[K], Join<P, K>>;
}[Extract<keyof T, string>];

/** 값이 문자열 배열인 잎의 점 경로 (안내 문구 목록 등). */
type ListLeaves<T, P extends string = ''> = {
  [K in Extract<keyof T, string>]: T[K] extends string
    ? never
    : T[K] extends readonly string[]
      ? Join<P, K>
      : ListLeaves<T[K], Join<P, K>>;
}[Extract<keyof T, string>];

/** `t()` 에 넣을 수 있는 모든 키. 오타는 컴파일 에러가 된다. */
export type TranslationKey = StringLeaves<typeof ko>;
/** `tList()` 에 넣을 수 있는 모든 키. */
export type TranslationListKey = ListLeaves<typeof ko>;

/** `{name}` 자리에 넣을 값. 숫자를 그대로 넘길 수 있어야 카운트 문구가 편하다. */
export type TranslationParams = Readonly<Record<string, string | number>>;

// ─────────────────────────────────────────────────────── 조회 · 치환

function lookup(key: string): unknown {
  let node: unknown = ko;
  for (const segment of key.split('.')) {
    if (typeof node !== 'object' || node === null) return undefined;
    node = (node as Record<string, unknown>)[segment];
  }
  return node;
}

/**
 * `{name}` 을 params 값으로 바꾼다. 대응하는 값이 없으면 **자리표시자를 그대로 남긴다** —
 * 화면에 `undefined` 가 찍히는 것보다 `{count}` 가 찍히는 편이 원인을 바로 알려준다.
 */
function interpolate(template: string, params: TranslationParams): string {
  return template.replace(/\{(\w+)\}/g, (placeholder, name: string) => {
    const value = params[name];
    return value === undefined ? placeholder : String(value);
  });
}

/**
 * 문구 한 줄을 가져온다.
 *
 * 키가 유효하지 않으면(캐스팅으로 타입을 우회한 경우뿐이다) **키 문자열 자체**를 돌려준다.
 * 빈 문자열을 돌려주면 레이아웃이 조용히 무너지지만, 키가 보이면 QA 가 즉시 잡는다.
 */
export function t(key: TranslationKey, params?: TranslationParams): string {
  const value = lookup(key);
  if (typeof value !== 'string') return key;
  return params === undefined ? value : interpolate(value, params);
}

/** 목록형 문구(예: 챗봇 이용 안내 5줄). 키가 유효하지 않으면 빈 배열. */
export function tList(key: TranslationListKey): readonly string[] {
  const value = lookup(key);
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

// ═══════════════════════════════════════════════════════════════════════
// 마이그레이션 가이드 (FR-111 — 나머지 화면을 옮기는 사람에게)
// ═══════════════════════════════════════════════════════════════════════
//
// 지금 상태: 구조 + 이미 상수 파일로 모여 있던 카피(auth · chat · search · notifications ·
// documents · account)만 `ko.ts` 에 들어와 있다. 화면 파일에 인라인으로 박힌 문자열은
// **일부러 손대지 않았다.** 22개 화면을 한 번에 치환하는 것이 이 페이즈에서 가장 위험한 작업이다.
//
// 1) 순서 — 위험이 낮은 것부터. 상수 파일 → 컴포넌트 → 화면.
//    a. `src/features/**/…` 의 `*_COPY` 상수를 **본문 대신 재수출**로 바꾼다:
//         export const AUTH_COPY = { loginFailed: t('auth.loginFailed'), … } as const;
//       ↑ 이렇게 하면 화면 코드를 한 줄도 건드리지 않고 문구 출처만 i18n 으로 넘어간다.
//       (`ko.ts` 값이 이미 원본과 글자 단위로 같다는 것은 `./parity.ts` 가 보증한다.)
//    b. 그다음 화면에서 `AUTH_COPY.loginFailed` → `t('auth.loginFailed')` 로 바꾼다.
//       이 단계는 **화면 하나씩** 하고, 화면마다 실기기로 확인한다.
//
// 2) 새 네임스페이스는 화면 단위로 판다. 키는 `<화면>.<영역>.<역할>` — 예: `archive.empty.title`.
//    값은 반드시 위키(Screen Specs / Mobile UX Guide §7-2)에 있는 문구여야 한다. 지어내지 않는다.
//
// 3) 문장을 만드는 **함수**(`socialSuccessMessage`, `markAllReadMessage`, `deadlineDaysCaption` …)는
//    `{name}` 템플릿으로 옮겼다. 이 템플릿들은 원본이 함수라 parity 가드가 걸리지 않으므로,
//    원본 함수를 고치면 `ko.ts` 도 같이 고쳐야 한다. 함수 자체를 i18n 으로 옮기는 것이 최종형이다:
//         export const markAllReadMessage = (count: number) => t('notifications.markAllRead', { count });
//
// 4) 중복 문구(`취소` · `다시 시도` · `확인` 이 네임스페이스마다 있다)는 **지금 합치지 않는다.**
//    현재 코드가 네임스페이스별로 따로 들고 있으므로 parity 가드를 유지하려면 그대로 두어야 한다.
//    전 화면 이관이 끝난 뒤 `common.*` 으로 접는 것이 마지막 단계다.
//
// 5) en 을 추가할 때: `src/i18n/en.ts` 를 `Record<TranslationKey, string>` 이 아니라
//    **`KoCatalog` 와 같은 모양의 객체**로 만들고(`satisfies KoCatalog` 로 누락 키를 컴파일 타임에 잡는다),
//    `lookup` 이 현재 로케일 카탈로그를 고르게 바꾼다. 그 시점까지 로케일 상태는 만들지 않는다 — YAGNI.
