// assets/legal/index.ts — 약관·개인정보·라이선스·앱정보 레지스트리 (SCR-30)
//
// 화면(`app/settings/legal/[doc].tsx`)은 이 파일만 import 한다. 문서를 하나 더 늘릴 때
// 화면 코드를 고칠 일이 없도록 **문서 목록·제목·시행일·본문**을 여기서 한 벌로 준다.
//
// 인증이 **불필요한** 화면이다 — 스토어 심사 도구가 비로그인으로 접근할 수 있어야 한다
// (Screen Specs SCR-30 표). 그래서 이 모듈은 세션·네트워크에 전혀 의존하지 않는다.

import { aboutKo, type AboutContext } from './about.ko';
import { LICENSES_KO } from './licenses.ko';
import { PRIVACY_KO } from './privacy.ko';
import { TERMS_KO } from './terms.ko';

export type { AboutContext };

/** Navigation Map §7 딥링크 표: `doc ∈ terms | privacy | licenses | about`. */
export const LEGAL_DOCS = ['terms', 'privacy', 'licenses', 'about'] as const;
export type LegalDoc = (typeof LEGAL_DOCS)[number];

export function isLegalDoc(value: unknown): value is LegalDoc {
  return typeof value === 'string' && (LEGAL_DOCS as readonly string[]).includes(value);
}

/** SCR-30 문서별 헤더 타이틀 원문. */
export const LEGAL_DOC_TITLE: Record<LegalDoc, string> = {
  terms: '이용약관',
  privacy: '개인정보 처리방침',
  licenses: '오픈소스 라이선스',
  about: '앱 정보',
};

/**
 * 상단 `시행일 {날짜}` 캡션.
 *
 * 라이선스 목록과 앱 정보는 "시행"하는 문서가 아니므로 날짜를 붙이지 않는다 —
 * 시행일이 있는 문서(약관·개인정보)만 값을 갖는다.
 */
export const LEGAL_EFFECTIVE_DATE: Record<LegalDoc, string | null> = {
  terms: '2026년 7월 27일',
  privacy: '2026년 7월 27일',
  licenses: null,
  about: null,
};

/** 문서 본문(Markdown). `about` 만 런타임 값이 필요해 컨텍스트를 받는다. */
export function legalDocumentBody(doc: LegalDoc, about: AboutContext): string {
  switch (doc) {
    case 'terms':
      return TERMS_KO;
    case 'privacy':
      return PRIVACY_KO;
    case 'licenses':
      return LICENSES_KO;
    case 'about':
      return aboutKo(about);
  }
}
