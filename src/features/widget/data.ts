/**
 * 안드로이드 홈 위젯 데이터 브리지 — RN 이 쓰고 Kotlin 이 읽는 JSON 한 장.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  경로 매핑 — **실측으로 확인했다**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `Paths.document`(구 `documentDirectory`) 는 안드로이드에서 `context.filesDir` 와
 * **정확히 같은 디렉토리**다. node_modules 원본을 따라가 확인한 사슬:
 *
 *   expo-file-system/android/.../FileSystemModule.kt
 *     Constant("documentDirectory") { Uri.fromFile(filesDirectory) + "/" }
 *     private val filesDirectory get() = appContext.persistentFilesDirectory
 *   expo-modules-core/.../AppContext.kt:203
 *     val persistentFilesDirectory get() = appDirectories.persistentFilesDirectory
 *   expo-modules-core/.../services/AppDirectoriesService.kt:19
 *     open val persistentFilesDirectory: File get() = context.filesDir   ← 종점
 *
 * `AppDirectoriesService` 는 `open` 이지만 **이 프로젝트의 node_modules 어디에도 서브클래스가
 * 없다**(expo-updates/dev-client 포함 전수 검색). 즉 개발·preview·production 전부 같다.
 * → Kotlin 은 `File(context.filesDir, "widget-data.json")` 으로 읽으면 된다. 경로 상수 불필요.
 *
 * 변형별 실제 경로 (applicationId 를 따라간다 — 위젯도 같은 앱 프로세스라 자동으로 맞는다):
 *   development : /data/user/0/com.mora.app.dev/files/widget-data.json
 *   preview·prod: /data/user/0/com.mora.app/files/widget-data.json
 *
 * ⚠ `AndroidManifest.xml` 의 `android:allowBackup="true"` 때문에 이 파일은 구글 백업 대상이다.
 *   일정 제목·장소가 백업에 실려 나간다. 민감하다고 판단되면 `dataExtractionRules` 에
 *   `<exclude domain="file" path="widget-data.json"/>` 를 추가해야 한다(앱 매니페스트 소관).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  스키마는 고정이다
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * 위젯 Kotlin 이 이 구조를 파싱한다. 키 이름·타입을 바꾸면 위젯이 조용히 빈 화면이 된다.
 * 필드를 **추가**하는 것은 안전하다(Kotlin 은 모르는 키를 무시한다).
 *
 * 원안에 없던 **추가 필드 2개**(`deepLink`, `time`)가 있다. 둘 다 이유가 있다.
 *
 * `time` — 원천의 티켓 출발 시각을 버리지 않기 위해서다. `subtitle` 에 이미 `18:00 · SRT`
 * 형태로 녹여 두었지만, 시각을 별도 배지로 그리고 싶을 수 있어 원자값도 함께 넘긴다.
 *
 * `deepLink` —
 * `type` → URL 세그먼트 변환이 기계적 소문자화가 **아니다**.
 *   BUSINESS_CARD → card  (business_card 가 아니다!)
 * `features/documents/types.ts` 의 `DOC_ROUTE_SEGMENT` 가 정본이고, 그 매핑을 Kotlin 에
 * 복제하면 언젠가 갈라진다. 그래서 완성된 URI 를 여기서 만들어 넘긴다 —
 * Kotlin 은 문자열을 그대로 `Intent.parseUri` 하면 된다.
 */

import { File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';

import { todayString, type Dashboard } from '@/features/dashboard/api';
import type { CalendarEvent } from '@/features/dashboard/calendar';
import { DOC_ROUTE_SEGMENT, type DocumentType } from '@/features/documents/types';

// ───────────────────────────────────────────────────────────── 상수

/** Kotlin 쪽 파일명과 반드시 같아야 한다. */
export const WIDGET_DATA_FILENAME = 'widget-data.json';

/** 스키마 버전. Kotlin 이 모르는 버전이면 위젯은 빈 상태를 그린다. */
export const WIDGET_PAYLOAD_VERSION = 1;

/** 대형(4×4) 위젯이 5개까지 그린다. 중형(4×2)은 앞 3개만 쓴다. */
export const WIDGET_UPCOMING_LIMIT = 5;

/** `monthMarks` 가 담는 월 범위 — 현재 월 ±1. 위젯 월 이동이 네트워크 없이 한 칸 움직인다. */
export const WIDGET_MONTH_RADIUS = 1;

// ───────────────────────────────────────────────────────────── 스키마

/** 위젯이 아는 문서 종류. 실제로 날짜 축이 있는 건 TICKET·POSTER 뿐이지만 어휘는 4종을 유지한다. */
export type WidgetDocumentType = DocumentType;

/** 다가오는 일정 1건. */
export type WidgetUpcomingItem = {
  /** 문서 PK 의 문자열 표현. 티켓·포스터는 정수지만 JSON 에서는 문자열로 통일한다. */
  id: string;
  type: WidgetDocumentType;
  /** 티켓 = `출발지 → 도착지`, 포스터 = 제목. */
  title: string;
  /**
   * 표시용 부제 — **그대로 `setTextViewText` 하면 된다.**
   * 시각이 있으면 `18:00 · SRT` 처럼 앞에 붙는다. 없으면 상세만(`MORA HALL`).
   * 둘 다 없으면 빈 문자열이다(키는 항상 존재한다).
   */
  subtitle: string;
  /**
   * `HH:MM` 또는 빈 문자열. `subtitle` 에 이미 포함돼 있지만, 시각을 별도 뷰(배지 등)로
   * 그리고 싶을 때 쓰도록 분리해 둔다. 포스터는 항상 빈 문자열이다(서버가 시각을 주지 않는다).
   */
  time: string;
  /** `YYYY-MM-DD` — 시작일. */
  date: string;
  /** 오늘 기준 남은 일수. 오늘 = 0. **음수는 만들지 않는다**(진행 중인 기간 일정은 0). */
  dday: number;
  /**
   * 완성된 딥링크(`mora://doc/<segment>/<id>`). Kotlin 은 그대로 쓴다 — 위 헤더 주석 참조.
   *
   * ⚠ 키 이름은 **camelCase `deepLink`** 다. `WidgetData.kt` 의 파서가
   * `str(raw, "deepLink", "link", "url")` 로 읽기 때문이다(전부 소문자 `deeplink` 는 못 읽는다).
   */
  deepLink: string;
};

/** `widget-data.json` 전문. */
export type WidgetPayload = {
  version: number;
  /** ISO8601 UTC. 위젯 하단 "N분 전 갱신" 표기에 쓸 수 있다. */
  updatedAt: string;
  /** `YYYY-MM-DD` — 기기 로컬 오늘. 위젯의 "오늘 강조"는 이 값이 아니라 자기 시계를 써야 한다(30분 지연). */
  today: string;
  upcoming: WidgetUpcomingItem[];
  /** `YYYY-MM` → 그 달에 일정이 있는 `YYYY-MM-DD` 목록(오름차순, 중복 없음). */
  monthMarks: Record<string, string[]>;
};

/**
 * 페이로드 입력.
 *
 * 둘 다 **선택**이다. 훅이 React Query 캐시에서 있는 것만 긁어 넘기기 때문이다.
 *  - `events` 가 있으면 그것만 쓴다(기간 정보가 있어 `monthMarks` 가 정확하다).
 *  - 없으면 `dashboard` 로 대체한다(단일 날짜라 기간 일정이 하루로 축약된다).
 */
export type WidgetPayloadInput = {
  events?: readonly CalendarEvent[] | undefined;
  dashboard?: Dashboard | undefined;
  /** `YYYY-MM-DD`. 테스트 주입용. 기본값은 기기 로컬 오늘. */
  today?: string | undefined;
  /** `updatedAt` 주입용. 기본값 `new Date()`. */
  now?: Date | undefined;
};

// ─────────────────────────────────────────────────── 내부 정규화 모델

/** 두 입력 소스를 하나로 합치기 위한 중간 표현. */
type DatedEntry = {
  type: WidgetDocumentType;
  id: string;
  title: string;
  subtitle: string;
  /** `YYYY-MM-DD` */
  startDate: string;
  /** `YYYY-MM-DD`. 하루짜리면 startDate 와 같다. */
  endDate: string;
  /** `HH:MM` 또는 빈 문자열. 같은 날 정렬에만 쓴다. */
  time: string;
};

/** 기간 일정 전개 상한. 이상 데이터로 루프가 폭주하는 것을 막는다(calendar.ts 와 같은 값). */
const MAX_EVENT_SPAN_DAYS = 366;

// ───────────────────────────────────────────────────────── 날짜 유틸
//
// 전부 **기기 로컬 자정** 기준이다. `new Date('YYYY-MM-DD')` 는 UTC 로 해석돼 KST 에서
// 하루 밀리므로 쓰지 않는다 — 반드시 `new Date(y, m - 1, d)` 로 만든다.

function parseLocalDate(iso: string): Date | null {
  const parts = iso.split('-');
  if (parts.length !== 3) return null;
  const year = Number(parts[0]);
  const month = Number(parts[1]);
  const day = Number(parts[2]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  const date = new Date(year, month - 1, day);
  // 2026-02-31 같은 값이 3월로 굴러가는 것을 걸러낸다.
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return date;
}

function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** `to - from` 을 일수로. 둘 다 로컬 자정이라 DST 없는 KST 에서는 정확하다. */
function diffDays(fromIso: string, toIso: string): number {
  const from = parseLocalDate(fromIso);
  const to = parseLocalDate(toIso);
  if (!from || !to) return 0;
  return Math.round((to.getTime() - from.getTime()) / 86_400_000);
}

/** `YYYY-MM-DD` → `YYYY-MM`. 문자열 자르기로 충분하다. */
function monthKeyOf(iso: string): string {
  return iso.slice(0, 7);
}

/** 관심 월 키 목록 — 현재 월 ±`WIDGET_MONTH_RADIUS`. */
function monthWindow(todayIso: string): string[] {
  const today = parseLocalDate(todayIso);
  if (!today) return [monthKeyOf(todayIso)];
  const keys: string[] = [];
  for (let delta = -WIDGET_MONTH_RADIUS; delta <= WIDGET_MONTH_RADIUS; delta += 1) {
    // 1일로 고정해 월 산술이 말일에서 굴러가지 않게 한다(3/31 + 1개월 = 5/1 사고 방지).
    const cursor = new Date(today.getFullYear(), today.getMonth() + delta, 1);
    keys.push(formatLocalDate(cursor).slice(0, 7));
  }
  return keys;
}

// ─────────────────────────────────────────────── 입력 → DatedEntry

function fromCalendarEvents(events: readonly CalendarEvent[]): DatedEntry[] {
  // `toCalendarEvents()` 가 이미 중복 제거·정렬을 끝냈으므로 형태만 바꾼다.
  return events.map((event) => ({
    type: event.type,
    id: String(event.id),
    title: event.title,
    subtitle: event.subtitle,
    startDate: event.startDate,
    endDate: event.endDate,
    time: event.time,
  }));
}

/**
 * 대시보드 요약 폴백.
 *
 * `todaySchedules` 와 `upcomingDeadlines` 는 **겹칠 수 있다**(오늘 마감인 항목은 양쪽에 온다).
 * `${type}:${rawId}` 로 합친다. 단일 날짜뿐이라 기간 포스터는 시작일 하루로 축약된다 —
 * 캘린더 화면을 한 번이라도 열면 `events` 쪽이 이 값을 대체한다.
 */
function fromDashboard(dashboard: Dashboard): DatedEntry[] {
  const seen = new Set<string>();
  const entries: DatedEntry[] = [];

  const push = (
    type: DatedEntry['type'],
    rawId: string,
    documentId: number | null,
    title: string,
    subtitle: string,
    date: string,
    time: string,
  ) => {
    // documentId 가 null 이면 딥링크를 만들 수 없어 위젯에서 탭이 죽는다 → 애초에 넣지 않는다.
    if (documentId === null || date === '') return;
    const key = `${type}:${rawId}`;
    if (seen.has(key)) return;
    seen.add(key);
    entries.push({ type, id: String(documentId), title, subtitle, startDate: date, endDate: date, time });
  };

  for (const item of dashboard.todaySchedules) {
    push(item.type, item.rawId, item.documentId, item.title, '', item.date, item.time);
  }
  for (const item of dashboard.upcomingDeadlines) {
    push(item.type, item.rawId, item.documentId, item.title, item.subtitle, item.date, '');
  }

  return entries;
}

// ───────────────────────────────────────────────────────── 페이로드 조립

/**
 * 딥링크 생성. `DOC_ROUTE_SEGMENT` 를 통과시키는 것이 규약이다
 * (`documents/types.ts`: "링크를 만들 때는 **반드시** 이걸 통과시킨다").
 */
function docDeeplink(type: WidgetDocumentType, id: string): string {
  return `mora://doc/${DOC_ROUTE_SEGMENT[type]}/${encodeURIComponent(id)}`;
}

/**
 * 다가오는 일정 최대 5건 + 월간 일정 날짜 목록을 뽑는다.
 *
 * "다가오는"의 정의: **종료일이 오늘 이후**인 것. 시작일 기준이 아니다 —
 * 3일째 진행 중인 전시회를 "지났다"고 숨기면 사용자가 위젯을 신뢰하지 않는다.
 * 그런 항목의 `dday` 는 0(= 오늘 진행 중)으로 눌러 둔다.
 */
export function buildWidgetPayload(input: WidgetPayloadInput = {}): WidgetPayload {
  const today = input.today ?? todayString();
  const now = input.now ?? new Date();

  const entries =
    input.events !== undefined && input.events.length > 0
      ? fromCalendarEvents(input.events)
      : input.dashboard !== undefined
        ? fromDashboard(input.dashboard)
        : [];

  const valid = entries.filter((entry) => parseLocalDate(entry.startDate) !== null);

  // ── 다가오는 일정
  const upcoming: WidgetUpcomingItem[] = valid
    .filter((entry) => entry.endDate >= today)
    .sort(compareEntries)
    .slice(0, WIDGET_UPCOMING_LIMIT)
    .map((entry) => ({
      id: entry.id,
      type: entry.type,
      title: entry.title,
      subtitle: composeSubtitle(entry),
      time: entry.time,
      date: entry.startDate,
      // 이미 시작한 기간 일정은 음수가 아니라 0 이다.
      dday: Math.max(0, diffDays(today, entry.startDate)),
      deepLink: docDeeplink(entry.type, entry.id),
    }));

  // ── 월간 마크
  const window = monthWindow(today);
  const marks: Record<string, Set<string>> = {};
  for (const key of window) marks[key] = new Set<string>();

  for (const entry of valid) {
    // 관심 창 밖은 전개조차 하지 않는다.
    const firstMonth = window[0];
    const lastMonth = window[window.length - 1];
    if (firstMonth === undefined || lastMonth === undefined) break;
    if (monthKeyOf(entry.endDate) < firstMonth || monthKeyOf(entry.startDate) > lastMonth) continue;

    const cursor = parseLocalDate(entry.startDate);
    if (!cursor) continue;
    for (let step = 0; step < MAX_EVENT_SPAN_DAYS; step += 1) {
      const iso = formatLocalDate(cursor);
      const bucket = marks[monthKeyOf(iso)];
      if (bucket !== undefined) bucket.add(iso);
      if (iso >= entry.endDate) break;
      cursor.setDate(cursor.getDate() + 1);
    }
  }

  const monthMarks: Record<string, string[]> = {};
  for (const key of window) {
    const bucket = marks[key];
    monthMarks[key] = bucket === undefined ? [] : [...bucket].sort();
  }

  return {
    version: WIDGET_PAYLOAD_VERSION,
    updatedAt: now.toISOString(),
    today,
    upcoming,
    monthMarks,
  };
}

/**
 * 표시용 부제 조립 — `시각 · 상세`.
 *
 * 원천이 주는 값은 티켓 = `transportType`(KTX/SRT), 포스터 = `organizerName` 이다.
 * 어느 쪽도 "장소"가 아니므로 `@` 같은 장소 기호를 붙이지 않는다 — 주최자 이름에 `@` 를
 * 붙이면 장소로 오독된다. 대신 티켓이 가진 **출발 시각을 살려** 부제에 넣는다.
 * (`CalendarEvent.time` 은 티켓만 채워지고 포스터는 항상 빈 문자열이다.)
 */
function composeSubtitle(entry: DatedEntry): string {
  if (entry.time === '') return entry.subtitle;
  if (entry.subtitle === '') return entry.time;
  return `${entry.time} · ${entry.subtitle}`;
}

/** 날짜 → 시각 → 제목. 시각 없는 포스터가 같은 날 티켓보다 뒤로 가도록 빈 값을 뒤로 민다. */
function compareEntries(a: DatedEntry, b: DatedEntry): number {
  if (a.startDate !== b.startDate) return a.startDate < b.startDate ? -1 : 1;
  const at = a.time || '99:99';
  const bt = b.time || '99:99';
  if (at !== bt) return at < bt ? -1 : 1;
  return a.title.localeCompare(b.title, 'ko');
}

// ───────────────────────────────────────────────────────────── 파일 I/O
//
// `File.write()` / `.delete()` 는 SDK 57 신 API 에서 **동기**다(Promise 아님).
// 페이로드가 수 KB 라 JS 스레드를 붙잡을 시간이 아니고, 동기라 부동 프라미스가 생기지 않는다.
//
// 안드로이드 전용으로 게이트한다. 위젯 자체가 안드로이드 기능이고, 웹 번들(`expo export
// --platform web`)에서 `Paths.document` 접근이 예외를 던지는 것을 피한다.

/** 위젯 JSON 의 `file://` URI. 진단 화면·로그용. */
export function widgetDataUri(): string {
  return new File(Paths.document, WIDGET_DATA_FILENAME).uri;
}

/**
 * 페이로드를 `documentDirectory/widget-data.json` 에 쓴다.
 *
 * 성공 여부를 boolean 으로 돌려주고 **던지지 않는다** — 위젯 갱신 실패가 앱 동작을 막아선 안 된다.
 */
export function writeWidgetData(payload: WidgetPayload): boolean {
  if (Platform.OS !== 'android') return false;
  try {
    // 부모 디렉토리(filesDir)는 항상 존재하므로 write 만으로 파일이 생성된다.
    new File(Paths.document, WIDGET_DATA_FILENAME).write(JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
}

/**
 * 위젯 JSON 을 지운다. **로그아웃·탈퇴 시 필수다.**
 *
 * 위젯은 런처 프로세스에 남아 있고 세션과 무관하게 마지막 데이터를 계속 보여 준다.
 * 이 파일을 지우지 않으면 로그아웃한 뒤에도, 심지어 다른 사람이 폰을 쥐어도 홈 화면에
 * 이전 사용자의 일정 제목·장소가 그대로 노출된다.
 *
 * 파일이 없으면 조용히 성공으로 본다(멱등).
 */
export function clearWidgetData(): boolean {
  if (Platform.OS !== 'android') return false;
  try {
    const file = new File(Paths.document, WIDGET_DATA_FILENAME);
    if (file.exists) file.delete();
    return true;
  } catch {
    return false;
  }
}
