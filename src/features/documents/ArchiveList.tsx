// src/features/documents/ArchiveList.tsx
//
// 보관함 허브(SCR-14)와 종별 화면 4개(SCR-15~18)가 **공유하는 목록 컨테이너**.
//
// 화면 5개가 각자 FlashList·무한스크롤·낙관적 삭제·4상태를 따로 구현하면 5벌이 어긋난다.
// 유형별로 진짜 다른 것은 (1) 어떤 종류를 조회하는가 (2) 어떻게 정렬/구획하는가
// (3) 행에 무엇을 덧붙이는가 뿐이라, 그 셋만 props 로 열어 두고 나머지는 전부 여기서 끝낸다.
//
// 화면이 소유하는 것(여기서 하지 않는 것): 헤더 문구·정렬 시트 열기·그룹 칩 레일·월 네비게이션.
// 헤더는 `ArchiveHeader` 로, 뷰 토글 상태는 `useArchiveView` 로 여기서 제공한다.
//
// ─────────────────────────────────────────────────────────────────────────────
// ★ '전체' 필터의 무한 스크롤 처리 방식 (SCR-14 — 4종 병렬 호출)
// ─────────────────────────────────────────────────────────────────────────────
// 서버에는 "모든 문서" 엔드포인트가 없다. 4종을 각각 `GET /api/{cards,tickets,posters,receipts}`
// 로 부르며 **페이지 커서가 종류마다 완전히 독립**이다(각자 `page` 0,1,2… + 각자 `last` 플래그).
// 따라서 전역 커서를 만들 수 없고, 다음 3가지를 규칙으로 못박는다.
//
//  1. `onEndReached` 는 **아직 다음 페이지가 남은 모든 종류에 대해 동시에** `fetchNextPage()` 를
//     부른다. 한 종류만 골라 당기면(예: 가장 오래된 항목의 종류) 해당 응답이 오기 전에는
//     다음 스크롤 이벤트에서 또 그 종류를 고르게 되어, 데이터가 적은 종류가 영영 안 실린다.
//  2. 화면에 보이는 순서는 **이미 받아온 항목 전체를 매 렌더 다시 정렬**해서 만든다. 그래서
//     새 페이지가 도착하면 항목이 리스트 '끝'이 아니라 **중간에 끼어들 수 있다.** 이는 4개의
//     독립 커서를 하나의 정렬 축(`createdAt`)으로 합치는 이상 피할 수 없는 성질이며,
//     끼어들기를 막으려면 서버에 통합 목록 API 가 필요하다([[Risks]] 백엔드 개선 항목).
//  3. 종료 판정은 **모든 활성 종류의 `hasNextPage` 가 false** 일 때다. 종별 종료는
//     Spring `Page.last` 만 본다(`useInfiniteDocuments` 가 이미 그렇게 한다).
//
// 부분 실패도 같은 이유로 별도 규칙이 필요하다: 4개 중 1개만 실패하면 나머지 3종을 감추지 않고
// 그대로 보여 주고 하단에 재시도 줄을 붙인다. 전멸했을 때만 전체 에러 카드로 전환한다.
import { FlashList, type FlashListRef, type ListRenderItemInfo } from '@shopify/flash-list';
import { useRouter, type Href } from 'expo-router';
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Alert, Modal, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';

import {
  DocumentGridCard,
  DocumentListItem,
  DocumentSkeleton,
  type SwipeAction,
} from '@/components/documents';
import { Button, EmptyState, IconButton, toast } from '@/components/ui';
import { isOffline, NETWORK_COPY, OfflineBanner } from '@/features/network';
import { haptics } from '@/lib/haptics';
import { storage } from '@/store/storage';
import { useTheme } from '@/theme/ThemeProvider';
import { spacing } from '@/theme/scale';

import { toDocumentSummary } from './mappers';
import { DOCUMENT_COPY, useDeleteDocument, useInfiniteDocuments } from './queries';
import {
  DOC_ROUTE_SEGMENT,
  DOCUMENT_TYPE_LABELS,
  type CardGroupFilter,
  type DocumentDeleteInput,
  type DocumentDetail,
  type DocumentType,
} from './types';

// ───────────────────────────────────────────────────────────── 레이아웃 상수

/** 화면 좌우 거터 (Design Tokens §6 `lg`). */
const GUTTER = spacing.lg; // 16
/** 그리드 2열 간격 (SCR-14/17 와이어프레임 `gap12`). */
const GRID_GAP = spacing.md; // 12
/** 명함 4:3 / 포스터 3:4 (SCR-17). */
export const GRID_ASPECT_CARD = 4 / 3;
export const GRID_ASPECT_POSTER = 3 / 4;

/**
 * `@shopify/flash-list` **v2 에는 `estimatedItemSize` 가 없다.**
 * v2 는 RecyclerView 기반으로 첫 렌더에서 실제 높이를 측정하므로 그 prop 이 제거됐고,
 * 넘기면 TS 초과 프로퍼티 오류가 난다(`FlashListProps` 에 키가 없다 — node_modules 확인함).
 * 위키 Offline and State §"estimatedItemSize 리스트 96 / 그리드 220" 은 v1 시절 값이며,
 * v2 에서 같은 목적(선렌더 거리)을 담당하는 것은 `drawDistance` 다. 행 높이 80dp 기준
 * 화면 밖 3행 분량을 미리 그린다.
 */
const DRAW_DISTANCE = 250;

// ───────────────────────────────────────────────────────────── 뷰 모드

export type ArchiveView = 'list' | 'grid';

/**
 * 뷰 토글 영속 (SCR-14 구성 요소 표: `mora_archive_view`).
 *
 * 위키는 AsyncStorage 를 적었지만 이 저장소의 비민감 영속은 MMKV 하나로 통일돼 있고
 * (`src/store/storage.ts`), 동기 읽기라 **첫 프레임부터 올바른 뷰**로 그려진다.
 * 키는 기존 MMKV 컨벤션(`search.lastDocType`)에 맞춰 점 네임스페이스를 쓴다.
 * `StorageKey` 상수 목록은 다른 담당의 파일이라 추가하지 않고 여기서 조립한다 —
 * 그 파일에 `archiveView` 가 생기면 이 상수를 지우고 갈아끼우면 된다.
 */
const VIEW_KEY_PREFIX = 'archive.view';

export function useArchiveView(scope: string, defaultView: ArchiveView = 'list') {
  const key = `${VIEW_KEY_PREFIX}.${scope}`;

  const [view, setViewState] = useState<ArchiveView>(() => {
    const stored = storage.getString(key);
    return stored === 'grid' || stored === 'list' ? stored : defaultView;
  });

  const setView = useCallback(
    (next: ArchiveView) => {
      setViewState(next);
      storage.set(key, next);
    },
    [key],
  );

  const toggleView = useCallback(() => {
    setView(view === 'list' ? 'grid' : 'list');
  }, [setView, view]);

  return { view, setView, toggleView };
}

// ───────────────────────────────────────────────────────────── 정렬

/**
 * 정렬 값. 라벨은 **원본 `<select>` 문구 그대로**다 (SCR-15/16/17/18 인터랙션 표).
 * 서버는 정렬 파라미터를 받지 않고 항상 `createdAt DESC` 를 준다 → 전부 클라이언트 정렬이다.
 */
export type ArchiveSort =
  | 'recent'
  | 'oldest'
  | 'departureDate'
  | 'eventDate'
  | 'purchaseDate'
  | 'amountDesc';

export const ARCHIVE_SORT_LABELS: Record<ArchiveSort, string> = {
  recent: '등록일 순',
  oldest: '오래된 순',
  departureDate: '출발일 순',
  eventDate: '행사일 순',
  purchaseDate: '구매일 순',
  amountDesc: '금액 높은 순',
};

export type ArchiveComparator = (a: DocumentDetail, b: DocumentDetail) => number;

/** 빈 문자열은 항상 뒤로 보낸다 — 날짜가 없는 문서가 목록 맨 앞을 차지하면 안 된다. */
function compareTextDesc(a: string, b: string): number {
  if (a === b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  return a < b ? 1 : -1;
}

function compareTextAsc(a: string, b: string): number {
  if (a === b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  return a < b ? -1 : 1;
}

/** 종별 '주 날짜'. 티켓=출발일, 포스터=행사 시작일, 영수증=구매일, 명함=등록일. */
export function primaryDateOf(doc: DocumentDetail): string {
  switch (doc.type) {
    case 'TICKET':
      return doc.departureDate;
    case 'POSTER':
      return doc.eventStartDate || doc.eventEndDate;
    case 'RECEIPT':
      return doc.purchaseDate;
    case 'BUSINESS_CARD':
      return (doc.createdAt ?? '').slice(0, 10);
  }
}

const createdAtOf = (doc: DocumentDetail) => doc.createdAt ?? '';

/** 정렬 값 → 비교 함수. 동률은 등록일 내림차순으로 안정화한다. */
export function archiveComparator(sort: ArchiveSort): ArchiveComparator {
  return (a, b) => {
    switch (sort) {
      case 'recent':
        return compareTextDesc(createdAtOf(a), createdAtOf(b));
      case 'oldest':
        return compareTextAsc(createdAtOf(a), createdAtOf(b));
      case 'amountDesc': {
        const amountA = a.type === 'RECEIPT' ? (a.totalAmount ?? -1) : -1;
        const amountB = b.type === 'RECEIPT' ? (b.totalAmount ?? -1) : -1;
        if (amountA !== amountB) return amountB - amountA;
        return compareTextDesc(createdAtOf(a), createdAtOf(b));
      }
      case 'departureDate':
      case 'eventDate':
      case 'purchaseDate': {
        const result = compareTextDesc(primaryDateOf(a), primaryDateOf(b));
        return result !== 0 ? result : compareTextDesc(createdAtOf(a), createdAtOf(b));
      }
    }
  };
}

/**
 * 티켓 전용 비교 (SCR-16 섹션 규칙 — 원본에는 없던 그룹핑).
 * `departureDate >= 오늘` → `다가오는 일정`(오름차순)이 먼저, 그 외 `지난 일정`(내림차순).
 * 원본은 `createdAt` 단일 정렬이라 지난 티켓이 상단을 점유하는 문제가 있었다.
 */
export function ticketComparator(today: string): ArchiveComparator {
  const upcoming = (doc: DocumentDetail) => primaryDateOf(doc) >= today;
  return (a, b) => {
    const upA = upcoming(a);
    const upB = upcoming(b);
    if (upA !== upB) return upA ? -1 : 1;
    return upA
      ? compareTextAsc(primaryDateOf(a), primaryDateOf(b))
      : compareTextDesc(primaryDateOf(a), primaryDateOf(b));
  };
}

// ───────────────────────────────────────────────────────────── 날짜 · D-day

/** 로컬 기준 `YYYY-MM-DD`. `toISOString()` 은 UTC 라 한국에서 하루가 밀린다. */
export function todayIso(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

const WEEKDAY_KO = ['일', '월', '화', '수', '목', '금', '토'] as const;

/** `2026-07-27` → `2026년 7월 27일` (SCR-15 날짜 섹션 헤더 — 원본은 ISO 원문을 그대로 노출했다). */
export function formatDateKo(iso: string): string {
  const parts = iso.split('-');
  const year = parts[0];
  const month = parts[1];
  const day = parts[2];
  if (!year || !month || !day) return iso;
  return `${year}년 ${Number(month)}월 ${Number(day)}일`;
}

/** `2026-07-27` → `07.27 (월)` (SCR-18 일자 섹션 헤더). */
export function formatDateShortKo(iso: string): string {
  const parts = iso.split('-');
  const month = parts[1];
  const day = parts[2];
  if (!month || !day) return iso;
  const weekday = WEEKDAY_KO[new Date(`${iso}T00:00:00`).getDay()] ?? '';
  return weekday ? `${month}.${day} (${weekday})` : `${month}.${day}`;
}

/**
 * 금액 표기 — 원본 `won()`(`'₩ ' + n.toLocaleString('en-US')`)을 계승한다.
 * `ko-KR` 로 바꿔도 3자리 구분은 동일하고, 앱 전역 로케일과 어긋나지 않는다.
 * 값이 없으면 `-` 다 (SCR-18 행 데이터 매핑 폴백).
 */
export const formatWon = (amount: number | null | undefined): string =>
  amount == null ? '₩ -' : `₩ ${amount.toLocaleString('ko-KR')}`;

/** 행 우측 지출 표기 `-₩12,500` (SCR-18). 영수증에는 수입 개념이 없으므로 항상 음수 기호다. */
const formatWonSigned = (amount: number | null): string =>
  amount === null ? '-' : `-₩${amount.toLocaleString('ko-KR')}`;

/** 두 `YYYY-MM-DD` 사이의 일수. 시각을 정오로 고정해 서머타임·타임존 경계 오차를 없앤다. */
function daysBetween(fromIso: string, toIso: string): number {
  const from = new Date(`${fromIso}T12:00:00`).getTime();
  const to = new Date(`${toIso}T12:00:00`).getTime();
  if (Number.isNaN(from) || Number.isNaN(to)) return 0;
  return Math.round((to - from) / 86_400_000);
}

/**
 * D-day 라벨 (SCR-16/17 카드 데이터 매핑).
 * 오늘 `D-DAY`, 미래 `D-6`, **과거는 `MM.DD` 날짜로 대체**한다(스펙 명시).
 */
export function ddayLabel(targetIso: string, today = todayIso()): string | null {
  if (!targetIso) return null;
  const diff = daysBetween(today, targetIso);
  if (diff === 0) return 'D-DAY';
  if (diff > 0) return `D-${diff}`;
  const parts = targetIso.split('-');
  return parts[1] && parts[2] ? `${parts[1]}.${parts[2]}` : null;
}

// ───────────────────────────────────────────────────────────── 라우팅

/**
 * typedRoutes 가 켜져 있어서(`app.config.js` §experiments) 문자열 라우트는 `Href` 로 좁혀야 한다.
 * `/doc/[type]/[id]`·`/viewer` 는 이제 실재하므로 타입은 생성돼 있지만, 여기서는 세그먼트를
 * 런타임에 조립하기 때문에(`/doc/${세그먼트}/${id}`) 리터럴 타입으로는 표현되지 않는다.
 * 그래서 조립 결과를 이 한 곳에서만 단언한다.
 *
 * **주의** — 이 단언은 오타를 컴파일 타임에 잡아 주지 못한다. 새 경로를 넣을 때는
 * `app/` 에 파일이 실제로 있는지 눈으로 확인해라.
 */
export const href = (path: string): Href => path as Href;

export const documentHref = (doc: DocumentDetail): Href =>
  href(`/doc/${DOC_ROUTE_SEGMENT[doc.type]}/${encodeURIComponent(String(doc.id))}`);

const documentEditHref = (doc: DocumentDetail): Href => href(`${String(documentHref(doc))}/edit`);

// ───────────────────────────────────────────────────────────── 아이콘

function BackIcon({ color }: { color: string }) {
  return (
    <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
      <Path
        d="M15 5L8 12L15 19"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/** `⇅` 정렬 */
function SortIcon({ color }: { color: string }) {
  return (
    <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
      <Path
        d="M7 3.5V20.5M7 20.5L3.5 17M7 20.5L10.5 17M17 20.5V3.5M17 3.5L13.5 7M17 3.5L20.5 7"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/** `⊞` 그리드 */
function GridIcon({ color }: { color: string }) {
  return (
    <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
      <Path
        d="M4 4H10.5V10.5H4V4ZM13.5 4H20V10.5H13.5V4ZM4 13.5H10.5V20H4V13.5ZM13.5 13.5H20V20H13.5V13.5Z"
        stroke={color}
        strokeWidth={1.8}
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/** `☰` 리스트 */
function ListIcon({ color }: { color: string }) {
  return (
    <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
      <Path
        d="M4 6.5H20M4 12H20M4 17.5H20"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
      />
    </Svg>
  );
}

// ───────────────────────────────────────────────────────────── 헤더

export interface ArchiveHeaderProps {
  title: string;
  /** 서버가 알려준 전체 건수. 제목 옆에 `명함 12` 로 붙는다 (SCR-15~18 헤더). */
  count?: number;
  onBack?: () => void;
  /** `⇅` — 정렬 시트 열기 */
  onSort?: () => void;
  /** 지정하면 `⊞`/`☰` 토글이 붙는다 */
  view?: ArchiveView;
  onToggleView?: () => void;
  /** 헤더 우측 커스텀 슬롯 (토글보다 오른쪽) */
  trailing?: ReactNode;
  /**
   * G-5 오프라인 배너를 헤더 바로 아래 붙인다. default true.
   * 배너 자체가 없는 화면(전체 화면 뷰어·카메라)에서만 false 로 끈다.
   */
  offlineBanner?: boolean;
  testID?: string;
}

/**
 * CMP-20 화면 헤더 56dp. 루트 Stack 이 `headerShown: false` 라 화면이 직접 그린다.
 *
 * G-5 오프라인 배너를 여기서 함께 그린다 — 이 헤더가 보관함 5화면·캘린더·알림·명함첩·설정 하위
 * 5화면의 공통 상단이라, 화면마다 배너를 붙이는 것보다 한 곳에서 끝내는 편이 어긋나지 않는다.
 * 루트에 절대배치 오버레이로 띄우지 않는 이유는 `OfflineBanner.tsx` 상단 주석을 보라(뒤로가기
 * 버튼을 덮는다).
 */
export function ArchiveHeader({
  title,
  count,
  onBack,
  onSort,
  view,
  onToggleView,
  trailing,
  offlineBanner = true,
  testID,
}: ArchiveHeaderProps) {
  const t = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <>
      <View
        testID={testID}
        className="flex-row items-center border-b border-bg-sunken bg-bg-base px-2"
        style={{ paddingTop: insets.top, height: 56 + insets.top }}
      >
        {onBack ? (
          <IconButton
            icon={<BackIcon color={t.text.primary} />}
            onPress={onBack}
            size="md"
            accessibilityLabel="뒤로"
            testID="archive-back"
          />
        ) : (
          <View className="w-2" />
        )}

        <Text
          className="ml-1 flex-1 text-h1 font-w700 text-text-primary"
          numberOfLines={1}
          accessibilityRole="header"
          maxFontSizeMultiplier={1.3}
        >
          {count === undefined ? title : `${title} ${count}`}
        </Text>

        {onSort ? (
          <IconButton
            icon={<SortIcon color={t.text.secondary} />}
            onPress={onSort}
            size="md"
            accessibilityLabel="정렬"
            testID="archive-sort"
          />
        ) : null}

        {view && onToggleView ? (
          <IconButton
            icon={
              view === 'list' ? (
                <GridIcon color={t.text.secondary} />
              ) : (
                <ListIcon color={t.text.secondary} />
              )
            }
            onPress={onToggleView}
            size="md"
            haptic
            accessibilityLabel={view === 'list' ? '그리드로 보기' : '리스트로 보기'}
            testID="archive-view-toggle"
          />
        ) : null}

        {trailing}
      </View>

      {/* G-5 — 오프라인일 때만 40dp 를 차지한다. 온라인에서는 아무것도 렌더하지 않는다. */}
      {offlineBanner ? <OfflineBanner /> : null}
    </>
  );
}

// ───────────────────────────────────────────────────────────── 액션 시트

export interface ArchiveSheetAction {
  label: string;
  onPress: () => void;
  /** 파괴적 액션은 danger 색 (SCR-14 롱프레스 ActionSheet `삭제`(destructive)) */
  destructive?: boolean;
}

interface ActionSheetProps {
  visible: boolean;
  title?: string;
  actions: ArchiveSheetAction[];
  onClose: () => void;
}

/**
 * 롱프레스 ActionSheet.
 *
 * RN `Alert` 를 쓰지 않는 이유: 안드로이드 Alert 는 버튼이 **최대 3개**인데 스펙의 항목은
 * `상세 보기 / 이미지 보기 / 수정 / 삭제 / 취소` 최대 5개다(SCR-17). `@gorhom/bottom-sheet`
 * 대신 순수 `Modal` 로 만든 이유는 이 시트에 제스처가 필요 없고(백드롭 탭·`취소`·안드로이드 백으로
 * 닫는다), `SortSheet` 처럼 `GestureHandlerRootView` 를 한 겹 더 쌓을 이유가 없어서다.
 */
function ActionSheet({ visible, title, actions, onClose }: ActionSheetProps) {
  const t = useTheme();
  const insets = useSafeAreaInsets();

  if (!visible) return null;

  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <Pressable
        className="flex-1 justify-end"
        style={{ backgroundColor: t.scrim }}
        accessibilityRole="button"
        accessibilityLabel="닫기"
        onPress={onClose}
      >
        {/* 시트 본체 탭이 백드롭으로 새어나가지 않게 한 겹 더 감싼다 */}
        <Pressable
          className="rounded-t-sheet bg-bg-elevated px-5 pt-4"
          style={{ paddingBottom: insets.bottom + spacing.md }}
          onPress={() => undefined}
        >
          {title ? (
            <Text
              className="pb-2 text-body-sm text-text-muted"
              numberOfLines={1}
              maxFontSizeMultiplier={1.2}
            >
              {title}
            </Text>
          ) : null}

          {actions.map((action) => (
            <Pressable
              key={action.label}
              accessibilityRole="button"
              accessibilityLabel={action.label}
              onPress={() => {
                onClose();
                action.onPress();
              }}
              className="h-14 justify-center"
              style={({ pressed }) => (pressed ? { opacity: 0.85 } : null)}
            >
              <Text
                className={`text-input font-w600 ${action.destructive ? 'text-danger' : 'text-text-primary'}`}
                maxFontSizeMultiplier={1.3}
              >
                {action.label}
              </Text>
            </Pressable>
          ))}

          <View className="mt-1 h-px bg-bg-sunken" />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="취소"
            onPress={onClose}
            className="h-14 items-center justify-center"
            style={({ pressed }) => (pressed ? { opacity: 0.85 } : null)}
          >
            <Text className="text-input font-w700 text-text-secondary" maxFontSizeMultiplier={1.3}>
              취소
            </Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ───────────────────────────────────────────────────────────── 삭제 확인

/** SCR-15 삭제 확인 다이얼로그 문구를 4종으로 확장한 것. 조사(을/를·은/는)가 달라 종별로 적는다. */
const DELETE_CONFIRM: Record<DocumentType, { title: string; message: string }> = {
  BUSINESS_CARD: { title: '이 명함을 삭제할까요?', message: '삭제한 명함은 복구할 수 없습니다.' },
  TICKET: { title: '이 티켓을 삭제할까요?', message: '삭제한 티켓은 복구할 수 없습니다.' },
  POSTER: { title: '이 포스터를 삭제할까요?', message: '삭제한 포스터는 복구할 수 없습니다.' },
  RECEIPT: { title: '이 영수증을 삭제할까요?', message: '삭제한 영수증은 복구할 수 없습니다.' },
};

/** 종류에 따라 id 타입이 갈리는 판별 유니온을 만든다 (명함만 UUID, 나머지는 Integer). */
function toDeleteInput(doc: DocumentDetail): DocumentDeleteInput {
  switch (doc.type) {
    case 'BUSINESS_CARD':
      return { type: 'BUSINESS_CARD', id: doc.id };
    case 'TICKET':
      return { type: 'TICKET', id: doc.id };
    case 'POSTER':
      return { type: 'POSTER', id: doc.id };
    case 'RECEIPT':
      return { type: 'RECEIPT', id: doc.id };
  }
}

// ───────────────────────────────────────────────────────────── 행 데이터

/**
 * 행/카드에 실제로 그릴 값. 제목·부제·썸네일은 `toDocumentSummary`(어댑터 계층 단일 규칙)를
 * 그대로 쓰고, **화면 스펙이 어댑터와 다른 부분만** 여기서 덮어쓴다.
 *  - 명함(SCR-15) : 3행에 `phone` (없으면 `email`)
 *  - 티켓(SCR-16) : 우측 상단 D-day
 *  - 포스터(SCR-17): 우측 상단 D-day (`eventEndDate ?? eventStartDate` 기준)
 *  - 영수증(SCR-18): 부제는 금액이 아니라 `purchaseTime`, 금액은 우측 정렬 강조
 */
type RowView = {
  title: string;
  subtitle: string;
  meta: string;
  thumbnailUrl: string | null;
  badge: string | null;
  amount: string | null;
};

function toRowView(doc: DocumentDetail, today: string): RowView {
  const summary = toDocumentSummary(doc);
  const base: RowView = {
    title: summary.title,
    subtitle: summary.subtitle,
    meta: '',
    thumbnailUrl: summary.thumbnailUrl,
    badge: null,
    amount: null,
  };

  switch (doc.type) {
    case 'BUSINESS_CARD':
      return { ...base, meta: doc.phone || doc.email };
    case 'TICKET':
      return {
        ...base,
        meta: doc.transportType,
        badge: ddayLabel(doc.departureDate, today),
      };
    case 'POSTER':
      return {
        ...base,
        meta: doc.organizerName,
        badge: ddayLabel(doc.eventEndDate || doc.eventStartDate, today),
      };
    case 'RECEIPT':
      return {
        ...base,
        subtitle: doc.purchaseTime,
        meta: doc.purchaseDate,
        amount: formatWonSigned(doc.totalAmount),
      };
  }
}

// ─────────────────────────────────────────────────── 셀 (FR-108 렌더 경로)

/**
 * 셀이 받는 콜백 3개. **호출자는 반드시 `useCallback` 으로 고정한다.**
 *
 * 이 셋과 `doc`·`today` 만 props 로 두는 것이 목적이다. `DocumentListItem`/`DocumentGridCard`
 * 는 `memo` 로 감싸져 있는데, 예전에는 `renderItem` 안에서 `onPress={() => openDoc(doc)}`,
 * `swipeActions=[{…}]`, `trailingTop={<Text/>}` 를 **매 렌더 새로 만들어** 넘겼다. memo 는
 * 얕은 비교라 그 순간 전부 무력화되고, 스크롤 한 번에 화면 안 모든 셀이 다시 그려졌다.
 * 파생값(`toRowView`·스와이프 액션·trailing 노드)을 셀 안쪽 `useMemo` 로 내려 참조를 고정한다.
 */
type ArchiveCellCallbacks = {
  onOpen: (doc: DocumentDetail) => void;
  onLongPress: (doc: DocumentDetail) => void;
  onDelete: (doc: DocumentDetail) => void;
};

type ArchiveCellProps = ArchiveCellCallbacks & {
  doc: DocumentDetail;
  /** 마운트 시점에 고정된 `YYYY-MM-DD`. D-day 계산이 렌더 중 `new Date()` 를 부르지 않게 한다. */
  today: string;
};

const ArchiveDocRow = memo(function ArchiveDocRow({
  doc,
  today,
  onOpen,
  onLongPress,
  onDelete,
}: ArchiveCellProps) {
  const row = useMemo(() => toRowView(doc, today), [doc, today]);

  const handlePress = useCallback(() => onOpen(doc), [doc, onOpen]);
  const handleLongPress = useCallback(() => onLongPress(doc), [doc, onLongPress]);

  const swipeActions = useMemo<SwipeAction[]>(
    () => [{ label: '삭제', tone: 'danger', onPress: () => onDelete(doc) }],
    [doc, onDelete],
  );

  /** 영수증은 금액(우측 강조), 티켓·포스터는 D-day 배지. 둘 다 없으면 `›` 셰브런을 남긴다. */
  const trailingTop = useMemo<ReactNode>(() => {
    if (row.amount) {
      return (
        <Text className="text-base font-w700 text-danger" maxFontSizeMultiplier={1.3}>
          {row.amount}
        </Text>
      );
    }
    if (row.badge) {
      return (
        <View className="rounded-full bg-surface-alt px-2 py-0.5">
          <Text className="text-micro font-w700 text-text-secondary">{row.badge}</Text>
        </View>
      );
    }
    return null;
  }, [row.amount, row.badge]);

  return (
    <DocumentListItem
      docType={doc.type}
      imageUri={row.thumbnailUrl}
      title={row.title}
      {...(row.subtitle ? { subtitle: row.subtitle } : {})}
      {...(row.meta ? { meta: row.meta } : {})}
      {...(trailingTop ? { trailingTop, showChevron: false } : {})}
      onPress={handlePress}
      onLongPress={handleLongPress}
      swipeActions={swipeActions}
      testID={`archive-row-${doc.type}-${doc.id}`}
    />
  );
});

const ArchiveDocCard = memo(function ArchiveDocCard({
  doc,
  today,
  aspectRatio,
  onOpen,
  onLongPress,
}: Omit<ArchiveCellProps, 'onDelete'> & { aspectRatio: number }) {
  const row = useMemo(() => toRowView(doc, today), [doc, today]);

  const handlePress = useCallback(() => onOpen(doc), [doc, onOpen]);
  const handleLongPress = useCallback(() => onLongPress(doc), [doc, onLongPress]);

  /* SCR-17 — D-day 는 이미지 우상단 오버레이(`bg rgba(0,0,0,.6)`).
     여기만 `text-text-inverse` 를 쓰지 않는다: inverse 는 다크에서 어두운 색이 되는데(#0F1621)
     이 배지는 **양 테마 모두 검은 반투명** 위에 얹힌다. `IconButton` 의 `overlay` variant
     (`bg-black/40`)와 같은 예외이며 HEX 가 아니라 tailwind 기본 팔레트 유틸이다
     (Component Library §3-0 예외 6). */
  const overlay = useMemo<ReactNode>(
    () =>
      row.badge ? (
        <View className="rounded-full bg-black/60 px-2 py-0.5">
          <Text className="text-micro font-w700 text-white">{row.badge}</Text>
        </View>
      ) : null,
    [row.badge],
  );

  return (
    <View style={{ paddingHorizontal: GRID_GAP / 2, paddingBottom: GRID_GAP }}>
      <DocumentGridCard
        docType={doc.type}
        imageUri={row.thumbnailUrl}
        title={row.title}
        {...(row.subtitle ? { subtitle: row.subtitle } : {})}
        aspectRatio={aspectRatio}
        onPress={handlePress}
        onLongPress={handleLongPress}
        {...(overlay ? { overlay } : {})}
        testID={`archive-card-${doc.type}-${doc.id}`}
      />
    </View>
  );
});

/** 섹션 헤더 셀. 문자열 2개만 받으므로 memo 가 거의 항상 적중한다. */
const ArchiveSectionRow = memo(function ArchiveSectionRow({
  title,
  trailing,
}: {
  title: string;
  trailing: string | null;
}) {
  return (
    <View className="flex-row items-center justify-between bg-bg-base px-4 py-2">
      <Text
        className="text-body-sm font-w700 text-text-secondary"
        accessibilityRole="header"
        maxFontSizeMultiplier={1.3}
      >
        {title}
      </Text>
      {trailing ? (
        <Text className="text-body-sm font-w700 text-text-muted" maxFontSizeMultiplier={1.3}>
          {trailing}
        </Text>
      ) : null}
    </View>
  );
});

// ───────────────────────────────────────────────────────────── 섹션

export interface ArchiveSectionSpec {
  /** 문서 → 섹션 키. 같은 키가 연속하면 한 묶음이 된다 (정렬 결과 순서를 그대로 신뢰한다). */
  of: (doc: DocumentDetail) => string;
  /** 섹션 키 → 헤더 제목 */
  title: (key: string) => string;
  /** 헤더 우측 값 (SCR-18 일자 소계). 그 섹션의 문서 전체를 받는다. */
  trailing?: (docs: DocumentDetail[]) => string;
}

type ArchiveItem =
  | { kind: 'section'; key: string; title: string; trailing: string | null }
  | { kind: 'doc'; key: string; doc: DocumentDetail };

// ───────────────────────────────────────────────────────────── 상태 표시

/**
 * 로딩 3초 초과 시 `불러오는 중...` (SCR-14~18 상태 표 공통).
 *
 * `active` 가 꺼질 때 상태를 되돌리지 않는 이유: 이 플래그를 읽는 자리는 로딩 화면 안뿐이고,
 * 로딩이 끝나면 그 화면 자체가 사라진다. 되돌리려고 이펙트 본문에서 setState 를 부르면
 * 불필요한 연쇄 렌더가 생긴다. 다음 로딩은 `active` 가 다시 참이 되는 순간 타이머부터 새로 돈다.
 */
function useSlowFlag(active: boolean, delayMs = 3000): boolean {
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    if (!active) return undefined;
    const timer = setTimeout(() => setSlow(true), delayMs);
    return () => clearTimeout(timer);
  }, [active, delayMs]);

  return active && slow;
}

function ErrorCard({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <View className="m-4 items-center gap-3 rounded-card border border-danger-border bg-danger-container p-5">
      <Text className="text-center text-base font-w600 text-danger" maxFontSizeMultiplier={1.3}>
        {message}
      </Text>
      <Button label="다시 시도" onPress={onRetry} variant="secondary" size="sm" />
    </View>
  );
}

// ───────────────────────────────────────────────────────────── 본체

export interface ArchiveEmptyCopy {
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
}

export interface ArchiveListProps {
  /** 조회 대상 종류. 길이 1 = 종별 화면(SCR-15~18), 길이 4 = 허브 `전체`(SCR-14). */
  types: readonly DocumentType[];
  view: ArchiveView;
  /** 기본 정렬. `compare` 를 주면 무시된다. */
  sort?: ArchiveSort;
  /** 커스텀 비교 함수 (티켓의 다가오는/지난 정렬 등). */
  compare?: ArchiveComparator;
  /** 명함 전용 그룹 필터 (`all` / `ungrouped` / 그룹 UUID). */
  group?: CardGroupFilter;
  /** 클라이언트 추가 필터 (영수증 월 필터 — 서버에 기간 파라미터가 없다). */
  filter?: (doc: DocumentDetail) => boolean;
  /** 리스트 모드 섹션 구획. 그리드에서는 무시한다. */
  section?: ArchiveSectionSpec;
  /** 데이터가 0건일 때 (필터 이전) */
  empty: ArchiveEmptyCopy;
  /** `filter` 로 전부 걸러졌을 때의 인라인 문구 (SCR-18 `해당 조건의 거래가 없습니다`) */
  filteredEmptyText?: string;
  /** 전멸 시 에러 카드 문구. 미지정이면 종별 정본 문구(`DOCUMENT_COPY.listFailed`)를 쓴다. */
  errorMessage?: string;
  /** 리스트와 함께 스크롤되는 상단 영역 (영수증 KPI·월 네비게이션 등) */
  header?: ReactNode;
  /** 그리드 카드 이미지 비율. 명함 4:3 / 포스터 3:4 */
  gridAspectRatio?: number;
  /** 스크롤 콘텐츠 하단 여백 (탭바 + 제스처바). `tabScrollBottomPadding()` 결과를 넘긴다. */
  bottomPadding: number;
  /**
   * 로드된 데이터를 화면에 올려 준다 — 헤더 건수·영수증 KPI·필터 칩 개수가 이걸 쓴다.
   * 이 컨테이너의 이펙트 의존성이므로 **반드시 `useCallback` 으로 고정**한다. 인라인 화살표를
   * 넘기면 매 렌더 새 함수가 되어 이펙트가 끝없이 재실행된다.
   */
  onDataChange?: (state: {
    /** 필터·정렬까지 끝난 문서. 화면이 그대로 집계에 쓸 수 있다. */
    docs: DocumentDetail[];
    /** 서버가 알려준 전체 건수 합계(`totalElements`). 아직 안 받아온 페이지도 포함한다. */
    total: number;
    /** 종별 전체 건수. 허브의 유형 칩 개수(`명함 12`)가 쓴다. */
    totals: Partial<Record<DocumentType, number>>;
    /** 아직 안 받아온 페이지가 남았는가 (영수증 `최근 100건 기준` 캡션 판정). */
    hasMore: boolean;
  }) => void;
  /**
   * 진입 즉시 이 페이지 수까지 자동으로 더 받아 온다 (SCR-18 결정: 최대 5페이지 = 100건).
   * 월 소계를 클라이언트가 계산해야 하는 영수증 전용 장치다. 다른 화면은 쓰지 않는다.
   */
  autoLoadPages?: number;
  testID?: string;
}

export function ArchiveList({
  types,
  view,
  sort = 'recent',
  compare,
  group,
  filter,
  section,
  empty,
  filteredEmptyText,
  errorMessage,
  header,
  gridAspectRatio = GRID_ASPECT_CARD,
  bottomPadding,
  onDataChange,
  autoLoadPages,
  testID,
}: ArchiveListProps) {
  const router = useRouter();
  const listRef = useRef<FlashListRef<ArchiveItem>>(null);
  const today = useMemo(() => todayIso(), []);

  /* 메모하지 않는다 — 호출부가 `types={['TICKET']}` 처럼 인라인 배열을 넘기므로 어차피 매 렌더
     새 값이다. 여기서 뽑아내는 것은 원시 불리언 4개뿐이고, 메모가 필요한 것은 그 불리언을
     의존성으로 쓰는 아래쪽이다. */
  const wants = (type: DocumentType) => types.includes(type);

  /* 훅은 **항상 4개를 같은 순서로** 부른다. `types` 에 없는 종류는 `enabled: false` 라
     네트워크를 타지 않고, 조건부 호출이 아니므로 훅 순서 규칙도 깨지지 않는다. */
  const cards = useInfiniteDocuments('BUSINESS_CARD', {
    enabled: wants('BUSINESS_CARD'),
    ...(group === undefined ? {} : { group }),
  });
  const tickets = useInfiniteDocuments('TICKET', { enabled: wants('TICKET') });
  const posters = useInfiniteDocuments('POSTER', { enabled: wants('POSTER') });
  const receipts = useInfiniteDocuments('RECEIPT', { enabled: wants('RECEIPT') });

  /* 활성 쿼리 목록. **메모하지 않는다** — 쿼리 객체는 매 렌더 새로 만들어져 메모해도 무의미하고,
     이 배열을 다른 `useMemo` 의 의존성으로 쓰면 그 메모가 전부 무력화된다. 실제로 안정성이
     필요한 값(`docs` / `totals`)은 아래에서 **원시값과 안정된 배열만** 의존성으로 잡는다. */
  const active = (
    [
      ['BUSINESS_CARD', cards],
      ['TICKET', tickets],
      ['POSTER', posters],
      ['RECEIPT', receipts],
    ] as const
  ).filter(([type]) => wants(type));

  // ── 상태 종합 ───────────────────────────────────────────────────────────
  // `isLoading` = `isPending && isFetching` 이라 비활성 쿼리(fetchStatus 'idle')는 끼지 않는다.
  const isInitialLoading = active.some(([, q]) => q.isLoading);
  const failed = active.filter(([, q]) => q.isError);
  const allFailed = active.length > 0 && failed.length === active.length;
  const someFailed = failed.length > 0 && !allFailed;
  const isRefreshing = active.some(([, q]) => q.isRefetching);
  const isFetchingNextPage = active.some(([, q]) => q.isFetchingNextPage);
  const hasMore = active.some(([, q]) => q.hasNextPage === true);
  const total = active.reduce((sum, [, q]) => sum + q.total, 0);
  const loadedPages = active.reduce((sum, [, q]) => sum + (q.data?.pages.length ?? 0), 0);

  const slowLoading = useSlowFlag(isInitialLoading);

  // ── 정렬 · 필터 · 섹션 ──────────────────────────────────────────────────
  /* `q.documents` 는 `useInfiniteDocuments` 안에서 이미 메모돼 있어 데이터가 안 바뀌면 같은
     배열이다. 그 4개와 원시 불리언만 의존성으로 잡아야 `docs` → `items` → FlashList `data` 가
     렌더마다 새 배열이 되는 것을 막을 수 있다(가상 리스트는 data 동일성으로 diff 를 건너뛴다). */
  const useCards = wants('BUSINESS_CARD');
  const useTickets = wants('TICKET');
  const usePosters = wants('POSTER');
  const useReceipts = wants('RECEIPT');

  const docs = useMemo(() => {
    const merged: DocumentDetail[] = [];
    if (useCards) merged.push(...cards.documents);
    if (useTickets) merged.push(...tickets.documents);
    if (usePosters) merged.push(...posters.documents);
    if (useReceipts) merged.push(...receipts.documents);
    const filtered = filter ? merged.filter(filter) : merged;
    return filtered.sort(compare ?? archiveComparator(sort));
  }, [
    cards.documents,
    compare,
    filter,
    posters.documents,
    receipts.documents,
    sort,
    tickets.documents,
    useCards,
    usePosters,
    useReceipts,
    useTickets,
  ]);

  /** 필터 이전 원본 건수 — 빈 상태를 `정말 0건` 과 `필터 결과 0건` 으로 나누는 기준. */
  const rawCount = active.reduce((sum, [, q]) => sum + q.documents.length, 0);

  const { items, stickyIndices } = useMemo(() => {
    // 그리드에는 섹션 헤더를 넣지 않는다 — 2열 셀 사이에 전폭 헤더가 끼면 열이 어긋난다.
    if (!section || view === 'grid') {
      return {
        items: docs.map<ArchiveItem>((doc) => ({
          kind: 'doc',
          key: `${doc.type}:${doc.id}`,
          doc,
        })),
        stickyIndices: [] as number[],
      };
    }

    // 1패스: 연속 구간을 버킷으로 묶는다(정렬 결과 순서를 그대로 신뢰한다).
    const buckets: { key: string; docs: DocumentDetail[] }[] = [];
    for (const doc of docs) {
      const key = section.of(doc);
      const last = buckets[buckets.length - 1];
      if (last && last.key === key) last.docs.push(doc);
      else buckets.push({ key, docs: [doc] });
    }

    // 2패스: 헤더 + 항목으로 평탄화하고 sticky 인덱스를 모은다.
    const flat: ArchiveItem[] = [];
    const sticky: number[] = [];
    for (const bucket of buckets) {
      sticky.push(flat.length);
      flat.push({
        kind: 'section',
        key: `section:${bucket.key}`,
        title: section.title(bucket.key),
        trailing: section.trailing ? section.trailing(bucket.docs) : null,
      });
      for (const doc of bucket.docs) {
        flat.push({ kind: 'doc', key: `${doc.type}:${doc.id}`, doc });
      }
    }
    return { items: flat, stickyIndices: sticky };
  }, [docs, section, view]);

  // ── 화면으로 데이터 올려 보내기 (헤더 건수 · 칩 개수 · 영수증 KPI) ──────
  const totals = useMemo(() => {
    const map: Partial<Record<DocumentType, number>> = {};
    if (useCards) map.BUSINESS_CARD = cards.total;
    if (useTickets) map.TICKET = tickets.total;
    if (usePosters) map.POSTER = posters.total;
    if (useReceipts) map.RECEIPT = receipts.total;
    return map;
  }, [
    cards.total,
    posters.total,
    receipts.total,
    tickets.total,
    useCards,
    usePosters,
    useReceipts,
    useTickets,
  ]);

  useEffect(() => {
    onDataChange?.({ docs, total, totals, hasMore });
  }, [docs, hasMore, onDataChange, total, totals]);

  // ── 페이지네이션 ────────────────────────────────────────────────────────
  /* `active` 는 매 렌더 새 배열이라 콜백 의존성에 넣을 수 없다(넣으면 `onEndReached`·`onRefresh`
     가 렌더마다 새 함수가 되어 FlashList 전체가 다시 그려지고, 이펙트에 넣으면 무한 루프다).
     커밋 직후 ref 에 최신 배열을 꽂아 두고 콜백은 **영구 고정**한다. 콜백이 실행되는 시점
     (스크롤·당겨서 새로고침·버튼 탭)에는 이미 그 렌더가 커밋된 뒤라 항상 최신 값을 본다. */
  const activeRef = useRef(active);
  useEffect(() => {
    // 렌더 중 ref 쓰기는 금지(react-hooks/refs)라 커밋 직후에 동기화한다. **아래 이펙트들보다
    // 먼저 선언되어야** 같은 커밋에서 프리페치 이펙트가 최신 배열을 본다.
    activeRef.current = active;
  });

  /** 파일 상단 주석 ①: 남은 종류 **전부**를 한 번에 한 페이지씩 당긴다. */
  const loadMore = useCallback(() => {
    for (const [, query] of activeRef.current) {
      if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage();
    }
  }, []);

  /* SCR-18 전용 프리페치. `loadedPages` 가 늘 때마다 다시 판정하므로 상한에 닿으면 자연히 멈춘다. */
  useEffect(() => {
    if (autoLoadPages === undefined) return;
    if (isInitialLoading || isFetchingNextPage) return;
    if (loadedPages >= autoLoadPages) return;
    loadMore();
  }, [autoLoadPages, isFetchingNextPage, isInitialLoading, loadMore, loadedPages]);

  const refresh = useCallback(() => {
    /* OFF-03 — 오프라인에서는 스피너를 돌리지 않고 토스트로 끝낸다. `networkMode:'online'` 이라
       요청은 어차피 `paused` 로 잡히는데, 그 사이 새로고침 인디케이터만 계속 도는 것이 더 나쁘다. */
    if (isOffline()) {
      toast.info(NETWORK_COPY.refreshBlocked);
      return;
    }
    haptics.impact('light'); // HAP-05 — pull-to-refresh 임계 도달
    for (const [, query] of activeRef.current) void query.refetch();
  }, []);

  /** 실패한 종류만 다시 부른다 — 멀쩡한 종류까지 재요청하면 Hikari pool 3 을 헛되이 먹는다. */
  const retry = useCallback(() => {
    for (const [, query] of activeRef.current) {
      if (query.isError) void query.refetch();
    }
  }, []);

  // ── 삭제 (OPT-01 낙관적 제거) ───────────────────────────────────────────
  const deleteMutation = useDeleteDocument();
  /* `deleteMutation` 객체 자체는 렌더마다 새로 만들어진다. 그것을 의존성으로 잡으면
     `confirmDelete` → `renderItem` → 모든 셀이 렌더마다 무효화된다. React Query v5 의
     `mutate` 는 observer 에 바인딩된 **안정 참조**라 이것만 잡으면 된다. */
  const deleteDocument = deleteMutation.mutate;

  const confirmDelete = useCallback(
    (doc: DocumentDetail) => {
      const copy = DELETE_CONFIRM[doc.type];
      Alert.alert(copy.title, copy.message, [
        { text: '취소', style: 'cancel' },
        {
          text: '삭제',
          style: 'destructive',
          onPress: () => {
            // HAP-04 — 파괴적 액션 확정
            haptics.warning();
            deleteDocument(toDeleteInput(doc), {
              onSuccess: () => toast.success(DOCUMENT_COPY.deleted[doc.type]),
              // `DocumentError.message` 는 이미 완성된 한국어 문구다(서버 문장을 쓰지 않는다).
              // 오프라인이면 `useDeleteDocument` 가 시도 전에 OFF-05 문구로 실패시킨다.
              onError: (error) => toast.error(error.message),
            });
          },
        },
      ]);
    },
    [deleteDocument],
  );

  // ── 롱프레스 액션 시트 ──────────────────────────────────────────────────
  const [sheetDoc, setSheetDoc] = useState<DocumentDetail | null>(null);

  const sheetActions = useMemo<ArchiveSheetAction[]>(() => {
    if (!sheetDoc) return [];
    const actions: ArchiveSheetAction[] = [
      { label: '상세 보기', onPress: () => router.push(documentHref(sheetDoc)) },
    ];
    // SCR-17 — 포스터는 이미지 자체가 정보다. 이미지가 없으면 항목을 감춘다(빈 뷰어로 보내지 않는다).
    if (sheetDoc.type === 'POSTER' && sheetDoc.imageUrl) {
      actions.push({
        label: '이미지 보기',
        onPress: () =>
          router.push(href(`/viewer?uri=${encodeURIComponent(sheetDoc.imageUrl ?? '')}`)),
      });
    }
    actions.push({ label: '수정', onPress: () => router.push(documentEditHref(sheetDoc)) });
    actions.push({ label: '삭제', destructive: true, onPress: () => confirmDelete(sheetDoc) });
    return actions;
  }, [confirmDelete, router, sheetDoc]);

  // ── 렌더 ────────────────────────────────────────────────────────────────
  const openDoc = useCallback(
    (doc: DocumentDetail) => {
      router.push(documentHref(doc));
    },
    [router],
  );

  const openSheet = useCallback((doc: DocumentDetail) => {
    haptics.impact('medium'); // SCR-14 롱프레스
    setSheetDoc(doc);
  }, []);

  /* 셀은 전부 `memo` 컴포넌트다. 여기서는 **원시값과 고정된 콜백만** 넘긴다 — 인라인 화살표나
     인라인 JSX 를 하나라도 넘기면 얕은 비교가 깨져 memo 가 전부 무력화된다. */
  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<ArchiveItem>) => {
      if (item.kind === 'section') {
        return <ArchiveSectionRow title={item.title} trailing={item.trailing} />;
      }
      if (view === 'grid') {
        return (
          <ArchiveDocCard
            doc={item.doc}
            today={today}
            aspectRatio={gridAspectRatio}
            onOpen={openDoc}
            onLongPress={openSheet}
          />
        );
      }
      return (
        <ArchiveDocRow
          doc={item.doc}
          today={today}
          onOpen={openDoc}
          onLongPress={openSheet}
          onDelete={confirmDelete}
        />
      );
    },
    [confirmDelete, gridAspectRatio, openDoc, openSheet, today, view],
  );

  // ① 최초 로딩 — 캐시가 없을 때만. 재진입은 캐시가 먼저 그려진다(로딩 위계 0).
  if (isInitialLoading) {
    return (
      <View className="flex-1" testID={testID}>
        {header}
        <DocumentSkeleton
          variant={view}
          count={view === 'grid' ? 4 : 5}
          aspectRatio={gridAspectRatio}
        />
        {slowLoading ? (
          <Text className="mt-2 text-center text-body-sm text-text-muted">불러오는 중...</Text>
        ) : null}
      </View>
    );
  }

  // ② 전멸 — 보여 줄 캐시가 아예 없을 때만 에러 카드로 화면을 덮는다.
  if (allFailed) {
    const first = failed[0];
    const message =
      errorMessage ??
      first?.[1].error?.message ??
      DOCUMENT_COPY.listFailed[first?.[0] ?? 'BUSINESS_CARD'];
    return (
      <View className="flex-1" testID={testID}>
        {header}
        <ErrorCard message={message} onRetry={retry} />
      </View>
    );
  }

  return (
    <View className="flex-1" testID={testID}>
      <FlashList
        ref={listRef}
        // 열 수가 바뀌면 레이아웃 캐시를 통째로 버려야 한다 — 토글 시 리마운트시킨다.
        key={view}
        data={items}
        renderItem={renderItem}
        keyExtractor={(item) => item.key}
        // 섹션 헤더와 문서 행은 높이·구조가 완전히 달라 재활용 풀을 분리한다.
        getItemType={(item) => item.kind}
        {...(view === 'grid' ? { numColumns: 2 } : {})}
        {...(stickyIndices.length > 0 ? { stickyHeaderIndices: stickyIndices } : {})}
        drawDistance={DRAW_DISTANCE}
        onEndReached={loadMore}
        onEndReachedThreshold={0.5}
        /* `isRefetching`(= isFetching && !isPending)은 **다음 페이지 로딩 중에도 참**이다.
           그대로 넘기면 무한 스크롤 때마다 상단 새로고침 스피너가 같이 돈다 → 명시적으로 뺀다. */
        refreshing={isRefreshing && !isFetchingNextPage}
        onRefresh={refresh}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          // 그리드는 셀마다 gap/2 를 물고 있으므로 바깥 거터에서 그만큼 뺀다 → 실제 거터 16 · 간격 12
          paddingHorizontal: view === 'grid' ? GUTTER - GRID_GAP / 2 : 0,
          paddingBottom: bottomPadding,
        }}
        ListHeaderComponent={header ? <>{header}</> : null}
        ListEmptyComponent={
          // 필터로 0건이 된 것과 원래 0건인 것은 전혀 다른 상태다 (SCR-18 빈(해당 월) vs 빈(전체)).
          rawCount > 0 && filteredEmptyText ? (
            <View className="items-center py-10">
              <Text className="text-body-sm text-text-muted">{filteredEmptyText}</Text>
            </View>
          ) : (
            <View className="pt-6">
              <ArchiveEmptyState {...empty} />
            </View>
          )
        }
        ListFooterComponent={
          <ArchiveFooter
            loading={isFetchingNextPage}
            partialError={someFailed}
            onRetry={retry}
            hasItems={items.length > 0}
          />
        }
      />

      <ActionSheet
        visible={sheetDoc !== null}
        {...(sheetDoc ? { title: DOCUMENT_TYPE_LABELS[sheetDoc.type] } : {})}
        actions={sheetActions}
        onClose={() => setSheetDoc(null)}
      />
    </View>
  );
}

// ───────────────────────────────────────────────────────────── 보조 컴포넌트

/** CMP-14 를 그대로 쓰되 목록 안에서 필요한 좌우 거터만 덧입힌다. */
function ArchiveEmptyState({ title, description, actionLabel, onAction }: ArchiveEmptyCopy) {
  return (
    <View className="px-4">
      <EmptyState
        title={title}
        {...(description ? { description } : {})}
        {...(actionLabel && onAction ? { actionLabel, onAction } : {})}
      />
    </View>
  );
}

function ArchiveFooter({
  loading,
  partialError,
  onRetry,
  hasItems,
}: {
  loading: boolean;
  partialError: boolean;
  onRetry: () => void;
  hasItems: boolean;
}) {
  if (partialError) {
    return (
      <View className="items-center gap-2 py-4">
        <Text className="text-body-sm text-text-muted">일부 문서를 불러오지 못했습니다.</Text>
        <Button label="다시 시도" onPress={onRetry} variant="ghost" size="sm" />
      </View>
    );
  }
  if (loading && hasItems) {
    return (
      <View className="py-4">
        <DocumentSkeleton variant="list" count={1} />
      </View>
    );
  }
  return <View style={{ height: spacing.sm }} />;
}
