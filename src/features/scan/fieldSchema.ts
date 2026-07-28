import type { KeyboardTypeOptions } from 'react-native';
import { z } from 'zod';

import {
  type DocumentType,
  type ParsedFields,
  type ReceiptItemInput,
  type SavableDocumentType,
} from './types';

/**
 * 문서 4종 × 필드 정의 표를 **데이터로** 표현한다. 편집 화면(SCR-12)은 이 표를 순회해 폼을 그린다.
 *
 * 정본:
 *  - wiki/tech/Data Model.md §2 (필드 키 × 라벨 × 입력타입 × 검증 × 저장필드)
 *  - wiki/tech/Camera and Scan.md §10 (FLD-01~09, 입력 컴포넌트 매핑, 정규화 게이트)
 *  - ocr/src/classifier/field_schema.py (DOCUMENT_FIELDS / FIELD_LABELS_KO)
 *  - frontend/lib/api.ts saveCard (필드키 → Spring 바디 키 매핑)
 *
 * 라벨 정책: 서버 `/api/scan` 응답의 `fields` 가 1순위(FLD-01)이고, 여기 적힌 라벨은 폴백이다.
 * 폴백 문구는 **원본 웹 `DOCUMENT_FIELD_SCHEMAS` 원문**을 그대로 쓴다
 * (서버 FIELD_LABELS_KO 와 두 곳이 다르다 — `office_phone` 유선 전화/사무실 전화,
 *  `store_name` 업체 이름/가게 이름. 서버 값이 오면 서버 값이 이긴다).
 *
 * 필수 필드는 **정의하지 않는다** (Camera and Scan §10-3 결정: 서버 DTO 에 @NotNull 이 없고
 * 이름 하나 못 읽은 명함도 원문만으로 가치가 있다). 대신 대표 필드가 비면 소프트 경고를 띄운다.
 */

// ───────────────────────────────────────────────────────────── 값 정규화 유틸

/** `'₩12,300원'` → `12300`. 숫자를 못 찾으면 null. 원본 `api.ts parseMoney` 와 동일 동작. */
export function parseMoney(value?: string | null): number | null {
  if (!value) return null;
  const normalized = String(value).replace(/[^\d.-]/g, '');
  if (!normalized) return null;
  const amount = Number(normalized);
  return Number.isFinite(amount) ? amount : null;
}

/** `12300` → `'12,300'` (입력 필드 표시용). */
export function formatMoney(amount?: number | null): string {
  return amount == null ? '' : amount.toLocaleString('ko-KR');
}

/** `12300` → `'12,300원'` (읽기 전용 표시). */
export function formatMoneyKo(amount?: number | null): string {
  return amount == null ? '' : `${amount.toLocaleString('ko-KR')}원`;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

const isLeapYear = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

/** `YYYY-MM-DD` 형식 + 실제 달력 유효성까지 확인한다. */
export function isIsoDate(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const year = Number(m[1] ?? '');
  const month = Number(m[2] ?? '');
  const day = Number(m[3] ?? '');
  if (!Number.isFinite(year) || month < 1 || month > 12) return false;
  const base = DAYS_IN_MONTH[month - 1] ?? 31;
  const max = month === 2 && isLeapYear(year) ? 29 : base;
  return day >= 1 && day <= max;
}

/** `HH:MM` (00–23 / 00–59). */
export function isIsoTime(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

/**
 * OCR 원문 날짜를 ISO(`YYYY-MM-DD`)로 정규화한다.
 *
 * 서버 파서는 ISO 를 보장하지 않는다 — `purchase_date` 는 `'06-02 21:13'`,
 * `departure_date` 는 `'2026.05.16'`/`'05.16'` 형태로 온다. 이 값을 그대로 `/save` 에 보내면
 * 서버가 조용히 null 을 넣거나 올해로 채워 **무성 실패**가 된다 (Data Model §4-1).
 *
 * @returns 빈 입력이면 `''`, 정규화 성공이면 ISO 문자열, 실패면 `null`(원문을 지우지 말고 유지할 신호).
 */
export function toIsoDate(raw: string, referenceYear = new Date().getFullYear()): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return '';

  // 8자리 붙여쓰기: '20260516'
  const packed = /^(\d{4})(\d{2})(\d{2})$/.exec(trimmed);
  if (packed) {
    const iso = `${packed[1]}-${packed[2]}-${packed[3]}`;
    return isIsoDate(iso) ? iso : null;
  }

  let s = trimmed
    .replace(/\([^)]*\)/g, ' ') // '(토)' 요일 괄호 제거
    .replace(/[년월]/g, '-')
    .replace(/일/g, ' ')
    .replace(/[./]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/\s*-\s*/g, '-');
  s = s.replace(/^-+/, '');

  const m = /(\d{2,4})-(\d{1,2})(?:-(\d{1,2}))?/.exec(s);
  if (!m) return null;

  const g1 = Number(m[1] ?? '');
  const g2 = Number(m[2] ?? '');
  const g3raw = m[3];

  let year: number;
  let month: number;
  let day: number;

  if (g3raw !== undefined) {
    year = g1 < 100 ? 2000 + g1 : g1;
    month = g2;
    day = Number(g3raw);
  } else {
    // 연도가 없는 'MM-DD' → 오늘 연도를 채운다. 화면은 `연도를 확인하세요` 힌트를 띄운다.
    year = referenceYear;
    month = g1;
    day = g2;
  }

  const iso = `${year}-${pad2(month)}-${pad2(day)}`;
  return isIsoDate(iso) ? iso : null;
}

/**
 * OCR 원문 시각을 `HH:MM` 으로 정규화한다. `오전/오후`, `H시 M분`, `H:MM:SS` 를 모두 흡수한다.
 * @returns 빈 입력이면 `''`, 성공이면 `HH:MM`, 실패면 `null`.
 */
export function toIsoTime(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return '';

  const isPm = /오후|p\.?m\.?/i.test(trimmed);
  const isAm = /오전|a\.?m\.?/i.test(trimmed);

  let hour: number;
  let minute: number;

  const hm = /(\d{1,2})\s*[:시]\s*(\d{1,2})/.exec(trimmed);
  if (hm) {
    hour = Number(hm[1] ?? '');
    minute = Number(hm[2] ?? '');
  } else {
    const hOnly = /(\d{1,2})\s*시/.exec(trimmed);
    if (!hOnly) return null;
    hour = Number(hOnly[1] ?? '');
    minute = 0;
  }

  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  if (isPm && hour < 12) hour += 12;
  if (isAm && hour === 12) hour = 0;
  if (hour > 23 || minute > 59) return null;

  return `${pad2(hour)}:${pad2(minute)}`;
}

/** `'+82 10-1234-5678'` → `'010-1234-5678'`. OCR 의 `_normalize_phone` 과 같은 의도. */
export function normalizePhone(value?: string | null): string {
  if (!value) return '';
  const s = String(value).trim().replace(/^\+82[-.\s]?/, '0');
  const digits = s.replace(/\D/g, '');
  if (/^01[016789]\d{7,8}$/.test(digits)) {
    return digits.replace(/^(\d{3})(\d{3,4})(\d{4})$/, '$1-$2-$3');
  }
  if (/^0\d{8,10}$/.test(digits)) {
    return digits.replace(/^(0\d{1,2})(\d{3,4})(\d{4})$/, '$1-$2-$3');
  }
  return s;
}

// ───────────────────────────────────────────────────────────── 필드 정의 타입

export type FieldInputType =
  | 'text'
  | 'multiline'
  | 'phone'
  | 'email'
  | 'url'
  | 'date'
  | 'time'
  | 'money'
  | 'select';

export type FieldDef = {
  /** 서버가 주는 OCR snake_case 키. 저장 직전까지 이 이름만 쓴다 (FLD-04). */
  key: string;
  /** 한국어 라벨 (폴백). 서버 `fields` 값이 오면 덮어쓴다. */
  label: string;
  inputType: FieldInputType;
  keyboardType: KeyboardTypeOptions;
  /** 항상 false — 문서 필드에 필수는 없다 (§10-3). 스키마 형태를 지키기 위해 남긴다. */
  required: boolean;
  /** DB 컬럼 상한 기준 선차단 값 (Data Model §4-4). */
  maxLength?: number;
  /** multiline 최소 행수. */
  rows?: number;
  autoCapitalize?: 'none' | 'sentences';
  autoCorrect?: boolean;
  /** select 프리셋. 자유 입력도 허용한다. */
  options?: readonly string[];
  /** 초기값 (OCR 미추출 필드의 서버 기본값 등). */
  defaultValue?: string;
  /** OCR 파서가 값을 채우는 필드인지. false 면 항상 빈 값으로 시작한다. */
  ocrExtracted: boolean;
  /** 저장 시 실제 DB 컬럼에 들어가는지. false 면 `저장 안 됨` 배지를 단다 (Data Model §2-1 결정). */
  persisted: boolean;
  /** 비면 소프트 경고를 띄우는 대표 필드 (§10-3). */
  primary?: boolean;
  placeholder: string;
};

const PLACEHOLDER_OCR = '인식되지 않음 · 직접 입력';
const PLACEHOLDER_MANUAL = '직접 입력';

type FieldSpec = Omit<FieldDef, 'required' | 'placeholder' | 'ocrExtracted' | 'persisted'> & {
  ocrExtracted?: boolean;
  persisted?: boolean;
};

function def(spec: FieldSpec): FieldDef {
  const ocrExtracted = spec.ocrExtracted ?? true;
  return {
    ...spec,
    ocrExtracted,
    persisted: spec.persisted ?? true,
    required: false,
    placeholder: ocrExtracted ? PLACEHOLDER_OCR : PLACEHOLDER_MANUAL,
  };
}

// ───────────────────────────────────────────────────────────── select 프리셋

/** 서버 `TRANSPORT_NORMALIZE` 의 최종값 6종 (원본: ocr/src/classifier/rule_based.py). */
export const TRANSPORT_TYPE_OPTIONS = ['KTX', 'SRT', 'ITX', '무궁화', '고속버스', '비행기'] as const;

/** OCR 미추출. Data Model §2-3 이 지정한 4택. */
export const PAYMENT_METHOD_OPTIONS = ['카드', '현금', '간편결제', '기타'] as const;

/** 서버 자바 기본값이 `"KRW"` 다. */
export const CURRENCY_CODE_OPTIONS = ['KRW', 'USD', 'JPY', 'EUR'] as const;

// ───────────────────────────────────────────────────────────── 문서 4종 필드표

const BUSINESS_CARD_FIELDS: readonly FieldDef[] = [
  def({ key: 'name', label: '이름', inputType: 'text', keyboardType: 'default', maxLength: 40, primary: true }),
  // 명함 12필드 중 DB 컬럼이 있는 것은 5개뿐이다. 나머지는 rawOcrText 에만 남는다.
  def({ key: 'english_name', label: '영문 이름', inputType: 'text', keyboardType: 'default', maxLength: 60, autoCapitalize: 'none', persisted: false }),
  def({ key: 'company_name', label: '회사명', inputType: 'text', keyboardType: 'default', maxLength: 100 }),
  def({ key: 'department', label: '부서', inputType: 'text', keyboardType: 'default', maxLength: 60, persisted: false }),
  def({ key: 'job_title', label: '직책', inputType: 'text', keyboardType: 'default', maxLength: 60 }),
  def({ key: 'mobile_phone', label: '휴대폰', inputType: 'phone', keyboardType: 'phone-pad', maxLength: 50 }),
  def({ key: 'office_phone', label: '유선 전화', inputType: 'phone', keyboardType: 'phone-pad', maxLength: 50, persisted: false }),
  def({ key: 'fax', label: '팩스', inputType: 'phone', keyboardType: 'phone-pad', maxLength: 50, persisted: false }),
  def({ key: 'email', label: '이메일', inputType: 'email', keyboardType: 'email-address', maxLength: 150, autoCapitalize: 'none', autoCorrect: false }),
  def({ key: 'address', label: '주소', inputType: 'multiline', keyboardType: 'default', maxLength: 200, rows: 3, persisted: false }),
  def({ key: 'website', label: '웹사이트', inputType: 'url', keyboardType: 'url', maxLength: 255, autoCapitalize: 'none', autoCorrect: false, persisted: false }),
  def({ key: 'zip_code', label: '우편번호', inputType: 'text', keyboardType: 'number-pad', maxLength: 5, persisted: false }),
];

const POSTER_FIELDS: readonly FieldDef[] = [
  // `title` 은 multiline: SCR-12 입력 타입 표가 `address, title` 을 3줄 multiline 으로 지정한다.
  def({ key: 'title', label: '제목', inputType: 'multiline', keyboardType: 'default', maxLength: 255, rows: 2, primary: true }),
  def({ key: 'organizer_name', label: '주최자', inputType: 'text', keyboardType: 'default', maxLength: 150 }),
  def({ key: 'event_start_date', label: '행사 시작일', inputType: 'date', keyboardType: 'default' }),
  def({ key: 'event_end_date', label: '행사 종료일', inputType: 'date', keyboardType: 'default' }),
  def({ key: 'contact_phone', label: '연락처 전화', inputType: 'phone', keyboardType: 'phone-pad', maxLength: 50 }),
  def({ key: 'contact_email', label: '연락처 이메일', inputType: 'email', keyboardType: 'email-address', maxLength: 150, autoCapitalize: 'none', autoCorrect: false }),
  def({ key: 'location', label: '장소', inputType: 'text', keyboardType: 'default', maxLength: 255 }),
  def({ key: 'website_url', label: '웹사이트 URL', inputType: 'url', keyboardType: 'url', maxLength: 500, autoCapitalize: 'none', autoCorrect: false }),
  // ↓ OCR 미추출. 서버 컬럼은 존재하므로 수기 입력값은 정상 저장된다 (Data Model §1-3).
  def({ key: 'fee', label: '참가비', inputType: 'text', keyboardType: 'default', maxLength: 100, ocrExtracted: false }),
  def({ key: 'description', label: '설명', inputType: 'multiline', keyboardType: 'default', maxLength: 1000, rows: 3, ocrExtracted: false }),
];

const RECEIPT_FIELDS: readonly FieldDef[] = [
  def({ key: 'store_name', label: '업체 이름', inputType: 'text', keyboardType: 'default', maxLength: 255 }),
  def({ key: 'purchase_date', label: '구매일자', inputType: 'date', keyboardType: 'default' }),
  def({ key: 'total_amount', label: '합계금액', inputType: 'money', keyboardType: 'numeric', primary: true }),
  // ↓ OCR 미추출. 서버 컬럼 존재.
  def({ key: 'merchant_address', label: '주소', inputType: 'multiline', keyboardType: 'default', maxLength: 500, rows: 3, ocrExtracted: false }),
  def({ key: 'purchase_time', label: '구매시각', inputType: 'time', keyboardType: 'default', ocrExtracted: false }),
  def({ key: 'payment_method', label: '결제수단', inputType: 'select', keyboardType: 'default', maxLength: 50, options: PAYMENT_METHOD_OPTIONS, ocrExtracted: false }),
  def({ key: 'card_company', label: '카드사', inputType: 'text', keyboardType: 'default', maxLength: 100, ocrExtracted: false }),
  def({ key: 'currency_code', label: '통화', inputType: 'select', keyboardType: 'default', maxLength: 10, options: CURRENCY_CODE_OPTIONS, defaultValue: 'KRW', ocrExtracted: false }),
];

const TICKET_FIELDS: readonly FieldDef[] = [
  def({ key: 'transport_type', label: '교통수단', inputType: 'select', keyboardType: 'default', maxLength: 50, options: TRANSPORT_TYPE_OPTIONS }),
  def({ key: 'departure_location', label: '출발지', inputType: 'text', keyboardType: 'default', maxLength: 255, primary: true }),
  def({ key: 'departure_date', label: '출발일', inputType: 'date', keyboardType: 'default' }),
  def({ key: 'departure_time', label: '출발 시간', inputType: 'time', keyboardType: 'default' }),
  def({ key: 'arrival_location', label: '도착지', inputType: 'text', keyboardType: 'default', maxLength: 255, primary: true }),
  def({ key: 'arrival_date', label: '도착일', inputType: 'date', keyboardType: 'default' }),
  def({ key: 'arrival_time', label: '도착 시간', inputType: 'time', keyboardType: 'default' }),
];

/** `DOCUMENT_FIELDS["ETC"] = {}` — 필드가 없고 저장 경로도 없다 (CLS-04). */
export const DOCUMENT_FIELD_DEFS: Record<DocumentType, readonly FieldDef[]> = {
  BUSINESS_CARD: BUSINESS_CARD_FIELDS,
  POSTER: POSTER_FIELDS,
  RECEIPT: RECEIPT_FIELDS,
  TICKET: TICKET_FIELDS,
  ETC: [],
};

/**
 * 원본 웹 `DOCUMENT_FIELD_SCHEMAS` 와 1:1 로 일치하는 `{키: 라벨}` 폴백 맵.
 * OCR 추출 대상 필드만 포함한다(= 서버 `fields` 와 키 집합이 같다).
 */
export const DOCUMENT_FIELD_SCHEMAS: Record<DocumentType, Record<string, string>> = (() => {
  const out = {} as Record<DocumentType, Record<string, string>>;
  for (const [type, defs] of Object.entries(DOCUMENT_FIELD_DEFS) as [DocumentType, readonly FieldDef[]][]) {
    const map: Record<string, string> = {};
    for (const d of defs) if (d.ocrExtracted) map[d.key] = d.label;
    out[type] = map;
  }
  return out;
})();

/** 유형 변경 시 값 승계 별칭 (원본 `COMMON_FIELD_MAP` 그대로). */
export const COMMON_FIELD_MAP: Record<string, readonly string[]> = {
  mobile_phone: ['contact_phone', 'office_phone'],
  contact_phone: ['mobile_phone', 'office_phone'],
  office_phone: ['mobile_phone', 'contact_phone'],
  email: ['contact_email'],
  contact_email: ['email'],
  website: ['website_url'],
  website_url: ['website'],
};

// ───────────────────────────────────────────────────────────── 폼 조립 (FLD-01/02/03)

const byKey = (defs: readonly FieldDef[]): Map<string, FieldDef> =>
  new Map(defs.map((d) => [d.key, d]));

/** 서버가 알려주지 않은 키가 오면 키 이름 패턴으로 입력 타입을 추론한다 (§10-2). */
export function inferFieldDef(key: string, label: string): FieldDef {
  if (key.endsWith('_date')) {
    return def({ key, label, inputType: 'date', keyboardType: 'default', persisted: false });
  }
  if (key.endsWith('_time')) {
    return def({ key, label, inputType: 'time', keyboardType: 'default', persisted: false });
  }
  if (key === 'total_amount' || key.endsWith('_amount') || key.endsWith('_price')) {
    return def({ key, label, inputType: 'money', keyboardType: 'numeric', persisted: false });
  }
  if (key.includes('phone') || key === 'fax' || key.endsWith('_fax')) {
    return def({ key, label, inputType: 'phone', keyboardType: 'phone-pad', maxLength: 50, persisted: false });
  }
  if (key.includes('email')) {
    return def({ key, label, inputType: 'email', keyboardType: 'email-address', maxLength: 150, autoCapitalize: 'none', autoCorrect: false, persisted: false });
  }
  if (key.includes('website') || key.endsWith('_url')) {
    return def({ key, label, inputType: 'url', keyboardType: 'url', maxLength: 500, autoCapitalize: 'none', autoCorrect: false, persisted: false });
  }
  if (key === 'zip_code') {
    return def({ key, label, inputType: 'text', keyboardType: 'number-pad', maxLength: 5, persisted: false });
  }
  if (key === 'address' || key === 'description' || key === 'title' || key.endsWith('_address')) {
    return def({ key, label, inputType: 'multiline', keyboardType: 'default', maxLength: 500, rows: 3, persisted: false });
  }
  return def({ key, label, inputType: 'text', keyboardType: 'default', maxLength: 255, persisted: false });
}

/**
 * FLD-01 + FLD-02: 라벨 소스는 서버 `fields` 가 1순위, 렌더 순서는 **선언(삽입) 순서**를 보존한다.
 *
 * - 서버 `fields` 가 비어 있으면 앱 내장 스키마를 그대로 쓴다.
 * - 서버 `fields` 가 있으면 그 키 순서를 따르고, 라벨만 서버 값으로 덮는다.
 * - 서버 `fields` 에 없는 **OCR 미추출 수기 필드**(참가비/설명/구매시각 등)는 뒤에 이어 붙인다.
 *   서버는 OCR 대상 필드만 내려주지만 DB 컬럼은 존재하므로 앱이 입력 경로를 제공한다.
 */
export function buildFieldDefs(
  type: DocumentType,
  serverFields?: Record<string, string> | null,
): FieldDef[] {
  const base = DOCUMENT_FIELD_DEFS[type];
  const labels = serverFields ?? {};
  const serverKeys = Object.keys(labels);
  if (serverKeys.length === 0) return [...base];

  const index = byKey(base);
  const out: FieldDef[] = [];
  const used = new Set<string>();

  for (const key of serverKeys) {
    const label = labels[key] ?? key;
    const known = index.get(key);
    out.push(known ? { ...known, label } : inferFieldDef(key, label));
    used.add(key);
  }
  for (const d of base) {
    if (!used.has(d.key)) out.push(d);
  }
  return out;
}

/** FLD-03: 초기값은 `parsed[key] ?? defaultValue ?? ''`. 값이 없는 필드도 숨기지 않는다(FLD-07). */
export function initialFieldValues(defs: readonly FieldDef[], parsed: ParsedFields): ParsedFields {
  const out: ParsedFields = {};
  for (const d of defs) {
    const raw = parsed[d.key];
    out[d.key] = raw !== undefined && raw !== '' ? raw : (d.defaultValue ?? '');
  }
  return out;
}

/**
 * §9-3 유형 변경 시 값 승계 (원본 `handleTypeChange` 로직 그대로).
 * 우선순위: ① 현재 입력값 유지 ② `COMMON_FIELD_MAP` 별칭에서 승계 ③ OCR `parsed` 값 ④ `''`
 */
export function inheritFieldValues(
  nextDefs: readonly FieldDef[],
  currentValues: ParsedFields,
  parsed: ParsedFields,
): ParsedFields {
  const out: ParsedFields = {};
  for (const d of nextDefs) {
    const own = currentValues[d.key];
    if (own !== undefined && own !== '') {
      out[d.key] = own;
      continue;
    }
    const aliases = COMMON_FIELD_MAP[d.key];
    if (aliases) {
      const sourceKey = aliases.find((k) => {
        const v = currentValues[k];
        return v !== undefined && v !== '';
      });
      if (sourceKey !== undefined) {
        out[d.key] = currentValues[sourceKey] ?? '';
        continue;
      }
    }
    const fromParsed = parsed[d.key];
    out[d.key] = fromParsed !== undefined && fromParsed !== '' ? fromParsed : (d.defaultValue ?? '');
  }
  return out;
}

// ───────────────────────────────────────────────────────────── 검증 (FLD-06)

const schemaCache = new Map<string, z.ZodType<string>>();

/**
 * 필드 1개의 zod 스키마 (A등급 = 저장 차단).
 * 날짜/시각/금액만 형식을 강제한다 — 서버가 `LocalDate`/`LocalTime`/`BigDecimal` 로 변환하는데
 * 파싱 실패 시 예외가 아니라 조용히 null 을 넣기 때문이다 (Data Model §4-1).
 */
export function fieldZodSchema(field: FieldDef): z.ZodType<string> {
  const cacheKey = `${field.inputType}:${field.maxLength ?? '-'}`;
  const cached = schemaCache.get(cacheKey);
  if (cached) return cached;

  let base = z.string();
  if (field.maxLength !== undefined) {
    base = base.max(field.maxLength, `${field.maxLength}자 이하로 입력해 주세요.`);
  }

  let schema: z.ZodType<string>;
  switch (field.inputType) {
    case 'date':
      schema = base.refine((v) => v === '' || isIsoDate(v), '날짜는 YYYY-MM-DD 형식이어야 합니다.');
      break;
    case 'time':
      schema = base.refine((v) => v === '' || isIsoTime(v), '시간은 HH:MM 형식이어야 합니다.');
      break;
    case 'money':
      schema = base.refine(
        (v) => v.trim() === '' || parseMoney(v) !== null,
        '숫자로 인식할 수 있는 금액을 입력해 주세요.',
      );
      break;
    default:
      schema = base;
  }

  schemaCache.set(cacheKey, schema);
  return schema;
}

/** A등급 검증 1건. 통과하면 null. */
export function validateFieldValue(field: FieldDef, value: string): string | null {
  const result = fieldZodSchema(field).safeParse(value);
  if (result.success) return null;
  return result.error.issues[0]?.message ?? '입력값을 확인해 주세요.';
}

/**
 * B등급 경고 1건 (저장 차단 안 함).
 * OCR 원문이 형식을 벗어나도 사람에게는 유효한 정보인 경우가 많아 차단하지 않는다 (§10-4).
 */
export function warnFieldValue(field: FieldDef, value: string): string | null {
  const v = value.trim();
  if (!v) return null;

  switch (field.inputType) {
    case 'email': {
      const at = v.indexOf('@');
      const domain = at >= 0 ? v.slice(at + 1) : '';
      if (at <= 0 || !domain.includes('.')) return '이메일 형식이 아닌 것 같습니다.';
      return null;
    }
    case 'phone':
      if (v.replace(/\D/g, '').length < 8) return '전화번호 자릿수가 적습니다.';
      return null;
    case 'url':
      if (!/^https?:\/\//i.test(v) && !v.includes('.')) return '주소 형식이 아닌 것 같습니다.';
      return null;
    case 'date':
      // 연도가 없는 OCR 원문은 올해로 채워지므로 연말/연초에 오답이 된다 (Data Model §2-2).
      return null;
    default:
      if (field.key === 'zip_code' && !/^\d{5}$/.test(v)) return '우편번호는 숫자 5자리입니다.';
      return null;
  }
}

export type FieldValidation = {
  ok: boolean;
  /** 저장 차단 사유 (A등급). */
  errors: Record<string, string>;
  /** 노란 힌트만 (B등급). */
  warnings: Record<string, string>;
};

/** 날짜 쌍 순서 등 필드 간 경고. Camera and Scan §10-4 A등급 목록에 없으므로 **차단하지 않는다**. */
function crossFieldWarnings(values: ParsedFields): Record<string, string> {
  const out: Record<string, string> = {};
  const pairs: [string, string][] = [
    ['event_start_date', 'event_end_date'],
    ['departure_date', 'arrival_date'],
  ];
  for (const [startKey, endKey] of pairs) {
    const start = values[startKey] ?? '';
    const end = values[endKey] ?? '';
    if (isIsoDate(start) && isIsoDate(end) && end < start) {
      out[endKey] = '시작일보다 이전 날짜입니다. 확인해 주세요.';
    }
  }
  return out;
}

/** 폼 전체 검증. 저장 버튼은 `ok === false` 일 때 눌려도 저장하지 않는다. */
export function validateFields(defs: readonly FieldDef[], values: ParsedFields): FieldValidation {
  const errors: Record<string, string> = {};
  const warnings: Record<string, string> = {};

  for (const d of defs) {
    const value = values[d.key] ?? '';
    const error = validateFieldValue(d, value);
    if (error) errors[d.key] = error;
    const warning = warnFieldValue(d, value);
    if (warning) warnings[d.key] = warning;
  }
  Object.assign(warnings, crossFieldWarnings(values));

  return { ok: Object.keys(errors).length === 0, errors, warnings };
}

/** react-hook-form `zodResolver` 에 그대로 넘길 수 있는 문서 단위 스키마. */
export function buildDocumentZodSchema(defs: readonly FieldDef[]): z.ZodType<Record<string, string>> {
  return z.record(z.string(), z.string()).superRefine((values: Record<string, string>, ctx) => {
    for (const d of defs) {
      const value = values[d.key] ?? '';
      const message = validateFieldValue(d, value);
      if (message) ctx.addIssue({ code: 'custom', message, path: [d.key], input: value });
    }
  });
}

/** 영수증 품목 1행. `itemName` 만 필수다 (Data Model §2-3). */
export const receiptItemSchema: z.ZodType<ReceiptItemInput> = z.object({
  itemName: z.string().min(1, '품목명을 입력해 주세요.').max(255, '255자 이하로 입력해 주세요.'),
  quantity: z.number().min(0, '0 이상이어야 합니다.').nullable().optional(),
  unitPrice: z.number().min(0, '0 이상이어야 합니다.').nullable().optional(),
  totalPrice: z.number().min(0, '0 이상이어야 합니다.').nullable().optional(),
  category: z.string().max(100, '100자 이하로 입력해 주세요.').nullable().optional(),
});

// ───────────────────────────────────────────────────────────── 소프트 경고 / 요약

/** §10-3 소프트 경고 문구 — **저장을 차단하지 않는다.** */
export function softWarningFor(type: DocumentType, values: ParsedFields): string | null {
  const get = (key: string) => (values[key] ?? '').trim();
  switch (type) {
    case 'BUSINESS_CARD':
      return get('name') ? null : '이름이 비어 있습니다. 그대로 저장할까요?';
    case 'POSTER':
      return get('title') ? null : '제목이 비어 있습니다. 그대로 저장할까요?';
    case 'RECEIPT':
      return get('total_amount') ? null : '합계금액이 비어 있습니다. 그대로 저장할까요?';
    case 'TICKET':
      return get('departure_location') || get('arrival_location')
        ? null
        : '출발지·도착지가 비어 있습니다. 그대로 저장할까요?';
    default:
      return null;
  }
}

/** 폼 상단 요약 칩용 집계 (§10-3). */
export function recognitionSummary(
  defs: readonly FieldDef[],
  values: ParsedFields,
): { total: number; recognized: number; empty: number } {
  const total = defs.length;
  let recognized = 0;
  for (const d of defs) {
    if ((values[d.key] ?? '').trim() !== '') recognized += 1;
  }
  return { total, recognized, empty: total - recognized };
}

/**
 * 저장 시 실제 DB 컬럼으로 들어가는 필드 키 (Data Model §2 "저장 필드" 열).
 * 명함만 12필드 중 5개다 — 나머지는 편집해도 사라지므로 화면이 `저장 안 됨` 배지를 단다.
 */
export const PERSISTED_FIELD_KEYS: Record<SavableDocumentType, readonly string[]> = {
  BUSINESS_CARD: ['name', 'company_name', 'job_title', 'mobile_phone', 'email'],
  POSTER: [
    'title',
    'organizer_name',
    'event_start_date',
    'event_end_date',
    'contact_phone',
    'contact_email',
    'location',
    'website_url',
    'fee',
    'description',
  ],
  RECEIPT: [
    'store_name',
    'purchase_date',
    'total_amount',
    'merchant_address',
    'purchase_time',
    'payment_method',
    'card_company',
    'currency_code',
  ],
  TICKET: [
    'transport_type',
    'departure_location',
    'departure_date',
    'departure_time',
    'arrival_location',
    'arrival_date',
    'arrival_time',
  ],
};
