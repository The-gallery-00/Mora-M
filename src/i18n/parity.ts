// src/i18n/parity.ts
//
// **삭제 금지. 런타임에서 아무도 import 하지 않는 것이 정상이다.**
//
// `ko.ts` 는 기존 `*_COPY` 상수의 값을 리터럴로 복사해 갖고 있다(그래야 카탈로그가 features 를
// import 하지 않는다 — ko.ts 머리말 규칙 2). 복사본은 언젠가 원본과 어긋난다. 이 파일이 그
// 어긋남을 **컴파일 타임에** 터뜨린다: 원본 상수의 문구를 한 글자라도 고치고 `ko.ts` 를 안 고치면
// `npm run typecheck` 가 실패한다.
//
// 런타임 비용은 0이다. Metro 는 진입점에서 require 를 따라가며 번들을 만드는데 이 모듈은
// 아무도 require 하지 않으므로 번들에 들어가지 않는다. 반면 tsc 는 `**/*.ts` 를 전부 보므로
// 검사는 항상 돈다. (그래서 여기서만 features 를 import 해도 순환 참조가 생기지 않는다.)
//
// 이관이 끝나 `*_COPY` 가 `t()` 재수출로 바뀌면(index.ts 가이드 1-a) 이 파일은 통째로 지운다.
import { NOTIFICATION_SETTINGS_COPY, DANGER_ZONE_COPY, PASSWORD_FORM_COPY } from '@/features/account/schema';
import { AUTH_COPY } from '@/features/auth/messages';
import { CHAT_COPY } from '@/features/chat/store';
import { NOTIFICATION_COPY } from '@/features/notifications/api';
import { TYPE_LABELS } from '@/features/scan/types';
import { SEARCH_COPY } from '@/features/search/queries';

import { ko } from './ko';

/** A 와 B 가 **정확히** 같은 타입일 때만 `true`, 아니면 `never`. `never` 에 true 를 대입하면 에러다. */
type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;

/**
 * 원본 상수와 카탈로그의 **공통 키 부분**이 글자 단위로 같은지 본다.
 * `Pick` 이라서 카탈로그 쪽에 키를 더 추가하는 것(템플릿 문구 등)은 허용되고,
 * 원본 키가 카탈로그에 없으면 `Pick` 제약 위반으로 그 자리에서 에러가 난다.
 */
type Mirrors<Legacy, Catalog extends Record<keyof Legacy, unknown>> = Exact<
  Legacy,
  Pick<Catalog, keyof Legacy>
>;

export const AUTH_COPY_IN_SYNC: Mirrors<typeof AUTH_COPY, typeof ko.auth> = true;
export const CHAT_COPY_IN_SYNC: Mirrors<typeof CHAT_COPY, typeof ko.chat> = true;
export const SEARCH_COPY_IN_SYNC: Mirrors<typeof SEARCH_COPY, typeof ko.search> = true;
/**
 * `typeLabel` 만 빼고 본다. 원본이 `{…} satisfies Record<NotificationType, string>` 이라
 * 문맥 타입이 값을 `string` 으로 넓혀 버려서(바깥 `as const` 도 이를 되돌리지 못한다)
 * 값 단위 비교가 성립하지 않는다. 대신 바로 아래에서 키만 본다.
 */
export const NOTIFICATION_COPY_IN_SYNC: Mirrors<
  Omit<typeof NOTIFICATION_COPY, 'typeLabel'>,
  typeof ko.notifications
> = true;

export const NOTIFICATION_TYPE_KEYS_IN_SYNC: Exact<
  keyof (typeof NOTIFICATION_COPY)['typeLabel'],
  keyof (typeof ko.notifications)['typeLabel']
> = true;
export const PASSWORD_FORM_COPY_IN_SYNC: Mirrors<
  typeof PASSWORD_FORM_COPY,
  typeof ko.account.password
> = true;
export const DANGER_ZONE_COPY_IN_SYNC: Mirrors<
  typeof DANGER_ZONE_COPY,
  typeof ko.account.dangerZone
> = true;
export const NOTIFICATION_SETTINGS_COPY_IN_SYNC: Mirrors<
  typeof NOTIFICATION_SETTINGS_COPY,
  typeof ko.account.notificationSettings
> = true;

/**
 * `TYPE_LABELS` 는 `Record<DocumentType, string>` 이라 값이 리터럴 타입이 아니다 →
 * 값 비교는 불가능하고 **키 누락/추가만** 잡는다. 문서 유형이 늘거나 줄면 여기서 걸린다.
 * (카탈로그 쪽 `ALL` 은 검색 칩 전용이라 원본에 없는 것이 정상 — 그래서 한쪽 방향만 본다.)
 */
export const DOCUMENT_TYPE_KEYS_IN_SYNC: [keyof typeof TYPE_LABELS] extends [
  keyof typeof ko.documents.typeLabel,
]
  ? true
  : never = true;
