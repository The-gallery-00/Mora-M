// app/doc/[type]/[id].tsx — SCR-19 · 문서 상세
//
// 정본: wiki/design/Screen Specs.md SCR-19 (유형별 필드 표 · 필드 탭 액션 표 · 상태표 · 인터랙션표)
//       wiki/design/Mobile UX Guide.md UX-09 (표현 분기) · UX-15(파괴적 확인은 Alert) · §7-2 문구표
//
// ── 표현이 유형별로 갈리는 이유 (UX-09) ────────────────────────────────────────
// 필드 3~7개(티켓·영수증) → **바텀시트** `snapPoints ['55%','92%']`
// 필드 10개 이상 + 큰 이미지(명함·포스터) → **풀스크린 상세 화면**
// 둘은 본문(`DetailContent`)을 공유하고 껍데기만 다르다. 두 벌로 나누면 라벨·순서가 반드시 어긋난다.
//
// ── 라우트 옵션을 `<Stack.Screen>` 으로 거는 이유 ────────────────────────────
// `app/doc/_layout.tsx` 는 이 작업의 담당 범위 밖이고 루트 Stack 은 `headerShown:false` 뿐이다.
// 그래서 시트 모드에 필요한 `transparentModal` 을 화면 자신이 선언한다. 나중에 셸 담당이
// `app/doc/_layout.tsx` 를 만들면 이 옵션을 그쪽으로 옮기면 된다.
// 시트 자체는 `SortSheet` 와 같은 이유로 RN `Modal` 안에서 그린다 — 루트에
// `BottomSheetModalProvider` 가 없기 때문이다(루트 파일도 담당 범위 밖).
//
// ── 없는 패키지에 의존하지 않는다 (패키지 설치 금지) ────────────────────────
// `⋯` 메뉴의 `연락처에 저장`(expo-contacts) · `캘린더에 추가`(expo-calendar)는 패키지가 없어
// 이번 범위에서 제외한다. `공유`는 RN 내장 `Share` 로 구현했다.
import BottomSheet, {
  BottomSheetBackdrop,
  BottomSheetScrollView,
  useBottomSheetSpringConfigs,
  type BottomSheetBackdropProps,
} from '@gorhom/bottom-sheet';
import NetInfo from '@react-native-community/netinfo';
import * as Clipboard from 'expo-clipboard';
import { Image } from 'expo-image';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentRef,
  type ReactNode,
  type Ref,
} from 'react';
import { Alert, Linking, Modal, Pressable, ScrollView, Share, Text, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Path } from 'react-native-svg';

import { DocPlaceholderIcon, FieldRow, type FieldAction } from '@/components/documents';
import { Button, IconButton, Skeleton, toast } from '@/components/ui';
import {
  CARD_GROUP_FIXED_LABELS,
  DOC_ROUTE_SEGMENT,
  DOCUMENT_COPY,
  DOCUMENT_TYPE_LABELS,
  documentTypeFromSegment,
  useCardGroups,
  useDeleteDocument,
  useDocument,
  useMoveCardToGroup,
  type DocumentDeleteInput,
  type DocumentDetail,
  type DocumentType,
  type ReceiptItem,
  type Uuid,
} from '@/features/documents';
import { formatMoneyKo } from '@/features/scan/fieldSchema';
import { haptics } from '@/lib/haptics';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, spacing } from '@/theme/scale';

/** 상단 썸네일 고정 높이 (SCR-19 와이어프레임 `이미지 200dp`). */
const IMAGE_HEIGHT = 200;
/** 이미지가 없을 때의 회색 박스 최소 높이 (상태표 `빈(이미지 없음)`). */
const IMAGE_EMPTY_MIN_HEIGHT = 160;

/** UX-09 — 필드가 적은 두 종류만 시트로 띄운다. */
const SHEET_TYPES: readonly DocumentType[] = ['TICKET', 'RECEIPT'];

/**
 * 삭제 확인 다이얼로그 문구.
 * 명함 문구가 위키 원문(SCR-15)이고 나머지 3종은 그 형태를 유형 이름만 바꿔 따른다.
 */
const DELETE_CONFIRM: Record<DocumentType, { title: string; body: string }> = {
  BUSINESS_CARD: { title: '이 명함을 삭제할까요?', body: '삭제한 명함은 복구할 수 없습니다.' },
  TICKET: { title: '이 티켓을 삭제할까요?', body: '삭제한 티켓은 복구할 수 없습니다.' },
  POSTER: { title: '이 포스터를 삭제할까요?', body: '삭제한 포스터는 복구할 수 없습니다.' },
  RECEIPT: { title: '이 영수증을 삭제할까요?', body: '삭제한 영수증은 복구할 수 없습니다.' },
};

/** 화면 문구 — 전부 SCR-19 상태표/인터랙션표 원문이다. 여기서 새로 짓지 않는다. */
const COPY = {
  imageEmpty: '이미지가 없습니다',
  itemsEmpty: '인식된 구매 항목이 없습니다.',
  offline: '오프라인입니다. 수정·삭제는 연결 후 가능합니다.',
  notFound: '문서를 찾을 수 없습니다.',
  noApp: '실행할 수 있는 앱이 없습니다.',
  copied: '복사했습니다.',
  retry: '다시 시도',
} as const;

/* ── 아이콘 (lucide 미설치 → react-native-svg 로 20dp 규격을 맞춘다) ───────── */

function PencilIcon({ color }: { color: string }) {
  return (
    <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
      <Path
        d="M4 20h4L19 9a2.1 2.1 0 10-3-3L5 17v3z"
        stroke={color}
        strokeWidth={1.8}
        strokeLinejoin="round"
      />
    </Svg>
  );
}

function MoreIcon({ color }: { color: string }) {
  return (
    <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
      <Circle cx={5} cy={12} r={1.7} fill={color} />
      <Circle cx={12} cy={12} r={1.7} fill={color} />
      <Circle cx={19} cy={12} r={1.7} fill={color} />
    </Svg>
  );
}

function CloseIcon({ color }: { color: string }) {
  return (
    <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
      <Path
        d="M6 6L18 18M18 6L6 18"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
      />
    </Svg>
  );
}

function ZoomIcon({ color }: { color: string }) {
  return (
    <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
      <Circle cx={11} cy={11} r={6.5} stroke={color} strokeWidth={2} />
      <Path d="M16 16L21 21M8.5 11h5M11 8.5v5" stroke={color} strokeWidth={2} strokeLinecap="round" />
    </Svg>
  );
}

/* ── 값 포맷 ──────────────────────────────────────────────────────────────── */

/** `useLocalSearchParams` 값은 `string | string[]` 다. 첫 값만 쓴다. */
function first(raw: string | string[] | undefined): string {
  if (typeof raw === 'string') return raw;
  if (Array.isArray(raw)) return raw[0] ?? '';
  return '';
}

/**
 * `2026-07-27T14:30:15` → `2026. 7. 27.` (SCR-19 와이어프레임 표기).
 * `toLocaleDateString` 을 쓰지 않는다 — Hermes 의 Intl 데이터 유무에 결과가 좌우된다.
 */
function formatSavedAt(iso?: string): string {
  if (!iso) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  return `${m[1] ?? ''}. ${Number(m[2] ?? '0')}. ${Number(m[3] ?? '0')}.`;
}

/** 스킴이 없는 주소를 https 로 보정한다. OCR 값에는 `www.` 로 시작하는 것이 흔하다. */
function withScheme(url: string): string {
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

/* ── 유형별 필드 구성 (SCR-19 `유형별 필드 구성` 표 · 라벨 원문) ───────────── */

type DetailRow = {
  key: string;
  label: string;
  value?: string;
  /** 우측 탭 액션 아이콘. `copy` 는 FieldRow 가 직접 처리한다. */
  actions?: FieldAction[];
  /** 값이 수백 자인 OCR 원문 — `더 보기`/`접기` */
  collapsible?: boolean;
  /** 우측 `›` + 탭 (명함 그룹). 액션 아이콘과 함께 쓰지 않는다. */
  onPress?: () => void;
  /** FieldRow 대신 그릴 본문 (영수증 구매 항목). */
  custom?: ReactNode;
};

function buildRows(
  doc: DocumentDetail,
  ctx: { groupName: string; onPickGroup: () => void },
): DetailRow[] {
  const savedAt = { key: 'createdAt', label: '저장일', value: formatSavedAt(doc.createdAt) };

  switch (doc.type) {
    case 'BUSINESS_CARD':
      return [
        { key: 'name', label: '이름', value: doc.name, actions: ['copy'] },
        { key: 'company', label: '회사명', value: doc.company, actions: ['copy'] },
        { key: 'position', label: '직책', value: doc.position, actions: ['copy'] },
        { key: 'phone', label: '전화번호', value: doc.phone, actions: ['call', 'sms', 'copy'] },
        { key: 'email', label: '이메일', value: doc.email, actions: ['email', 'copy'] },
        // 명함 전용. 값이 비어도 `미분류` 가 들어가므로 항상 탭할 수 있다.
        { key: 'groupId', label: '명함 그룹', value: ctx.groupName, onPress: ctx.onPickGroup },
        savedAt,
        { key: 'rawOcrText', label: 'OCR 원문', value: doc.rawOcrText, actions: ['copy'], collapsible: true },
      ];

    case 'TICKET':
      return [
        { key: 'transportType', label: '교통수단', value: doc.transportType, actions: ['copy'] },
        { key: 'departureLocation', label: '출발지', value: doc.departureLocation, actions: ['map', 'copy'] },
        { key: 'departureDate', label: '출발일', value: doc.departureDate, actions: ['copy'] },
        { key: 'departureTime', label: '출발 시간', value: doc.departureTime, actions: ['copy'] },
        { key: 'arrivalLocation', label: '도착지', value: doc.arrivalLocation, actions: ['map', 'copy'] },
        { key: 'arrivalDate', label: '도착일', value: doc.arrivalDate, actions: ['copy'] },
        { key: 'arrivalTime', label: '도착 시간', value: doc.arrivalTime, actions: ['copy'] },
        savedAt,
        { key: 'rawText', label: 'OCR 원문', value: doc.rawText, actions: ['copy'], collapsible: true },
      ];

    case 'POSTER':
      return [
        { key: 'title', label: '제목', value: doc.title, actions: ['copy'] },
        { key: 'organizerName', label: '주최자', value: doc.organizerName, actions: ['copy'] },
        { key: 'eventStartDate', label: '행사 시작일', value: doc.eventStartDate, actions: ['copy'] },
        { key: 'eventEndDate', label: '행사 종료일', value: doc.eventEndDate, actions: ['copy'] },
        { key: 'location', label: '장소', value: doc.location, actions: ['map', 'copy'] },
        { key: 'contactPhone', label: '연락처', value: doc.contactPhone, actions: ['call', 'copy'] },
        { key: 'contactEmail', label: '이메일', value: doc.contactEmail, actions: ['email', 'copy'] },
        { key: 'fee', label: '참가비', value: doc.fee, actions: ['copy'] },
        { key: 'websiteUrl', label: '웹사이트', value: doc.websiteUrl, actions: ['web', 'copy'] },
        { key: 'description', label: '설명', value: doc.description, actions: ['copy'], collapsible: true },
        savedAt,
        { key: 'rawText', label: 'OCR 원문', value: doc.rawText, actions: ['copy'], collapsible: true },
      ];

    case 'RECEIPT':
      return [
        { key: 'merchantName', label: '상호명', value: doc.merchantName, actions: ['copy'] },
        { key: 'merchantAddress', label: '주소', value: doc.merchantAddress, actions: ['map', 'copy'] },
        { key: 'purchaseDate', label: '구매일', value: doc.purchaseDate, actions: ['copy'] },
        { key: 'purchaseTime', label: '구매시간', value: doc.purchaseTime, actions: ['copy'] },
        { key: 'paymentMethod', label: '결제수단', value: doc.paymentMethod, actions: ['copy'] },
        { key: 'cardCompany', label: '카드사', value: doc.cardCompany, actions: ['copy'] },
        { key: 'totalAmount', label: '총액', value: formatMoneyKo(doc.totalAmount), actions: ['copy'] },
        { key: 'currencyCode', label: '통화', value: doc.currencyCode, actions: ['copy'] },
        { key: 'items', label: '구매 항목', custom: <ReceiptItemList items={doc.items} /> },
        savedAt,
        { key: 'rawText', label: 'OCR 원문', value: doc.rawText, actions: ['copy'], collapsible: true },
      ];
  }
}

/**
 * 상세 모델 → 삭제 입력.
 * PK 타입이 종류에 종속(명함 UUID / 나머지 Integer)이라 한 줄로 합칠 수 없다 — 종류별로 분기한다.
 */
function toDeleteInput(doc: DocumentDetail): DocumentDeleteInput {
  switch (doc.type) {
    case 'BUSINESS_CARD':
      return { type: 'BUSINESS_CARD', id: doc.id };
    case 'POSTER':
      return { type: 'POSTER', id: doc.id };
    case 'TICKET':
      return { type: 'TICKET', id: doc.id };
    case 'RECEIPT':
      return { type: 'RECEIPT', id: doc.id };
  }
}

/** 공유 본문. OCR 원문은 길어서 뺀다. */
function buildShareText(doc: DocumentDetail, rows: DetailRow[]): string {
  const head = `[MORA] ${DOCUMENT_TYPE_LABELS[doc.type]}`;
  const lines = rows
    .filter((row) => !row.custom && row.key !== 'rawText' && row.key !== 'rawOcrText')
    .filter((row) => (row.value ?? '').trim() !== '')
    .map((row) => `${row.label}: ${(row.value ?? '').trim()}`);
  return [head, ...lines].join('\n');
}

/* ── 영수증 구매 항목 ─────────────────────────────────────────────────────── */

function ReceiptItemList({ items }: { items: ReceiptItem[] }) {
  if (items.length === 0) {
    // 상태표 `빈(구매 항목)` 인라인 문구
    return <Text className="mt-0.5 text-base text-text-disabled">{COPY.itemsEmpty}</Text>;
  }
  return (
    <View className="mt-0.5 gap-1">
      {items.map((item, index) => (
        <View key={`${item.id ?? index}-${item.itemName}`} className="flex-row items-center justify-between">
          <Text className="flex-1 text-base text-text-primary" maxFontSizeMultiplier={1.4}>
            {item.itemName || '-'}
            {item.quantity != null && item.quantity > 0 ? ` × ${item.quantity}` : ''}
          </Text>
          <Text className="ml-3 text-base text-text-secondary" maxFontSizeMultiplier={1.4}>
            {formatMoneyKo(item.totalPrice ?? item.unitPrice) || '-'}
          </Text>
        </View>
      ))}
    </View>
  );
}

/* ── 본문 (시트/풀스크린 공용) ────────────────────────────────────────────── */

type DetailContentProps = {
  doc: DocumentDetail;
  rows: DetailRow[];
  imageUri: string | null;
  offline: boolean;
  onOpenImage: () => void;
  onImageError: () => void;
  onAction: (action: FieldAction, value: string) => void;
};

function DetailContent({
  doc,
  rows,
  imageUri,
  offline,
  onOpenImage,
  onImageError,
  onAction,
}: DetailContentProps) {
  const t = useTheme();

  return (
    <View>
      {offline ? (
        <View
          className="mb-3 border border-warn-border bg-warn-container px-4 py-3"
          style={{ borderRadius: radius.card }}
          accessibilityLiveRegion="polite"
        >
          <Text className="text-body-sm text-warn">{COPY.offline}</Text>
        </View>
      ) : null}

      {/* ── 썸네일. 탭 → SCR-21 이미지 뷰어 ───────────────────────────────── */}
      <Pressable
        accessibilityRole="imagebutton"
        accessibilityLabel={`${DOCUMENT_TYPE_LABELS[doc.type]} 이미지 크게 보기`}
        onPress={onOpenImage}
        style={({ pressed }) => (pressed ? { opacity: 0.9 } : null)}
      >
        <View
          className="overflow-hidden border border-border-subtle bg-surface-alt"
          style={{
            height: imageUri ? IMAGE_HEIGHT : IMAGE_EMPTY_MIN_HEIGHT,
            borderRadius: radius.card,
          }}
        >
          {imageUri ? (
            <>
              <Image
                source={{ uri: imageUri }}
                contentFit="contain"
                transition={160}
                style={{ width: '100%', height: '100%' }}
                // 서버 이미지가 404 일 수 있다 — 실패하면 폴백 박스로 교체한다 (UX-23)
                onError={onImageError}
                accessibilityLabel={`${DOCUMENT_TYPE_LABELS[doc.type]} 이미지`}
              />
              <View className="absolute bottom-2 right-2 h-8 w-8 items-center justify-center rounded-full bg-black/40">
                <ZoomIcon color={t.text.inverse} />
              </View>
            </>
          ) : (
            <View className="flex-1 items-center justify-center gap-2">
              <DocPlaceholderIcon color={t.text.disabled} size={28} />
              <Text className="text-body-sm text-text-muted">{COPY.imageEmpty}</Text>
            </View>
          )}
        </View>
      </Pressable>

      {/* ── 필드 목록 ─────────────────────────────────────────────────────── */}
      <View className="mt-4">
        {rows.map((row, index) => {
          const last = index === rows.length - 1;
          if (row.custom) {
            return (
              <View
                key={row.key}
                className={`py-2.5 ${last ? '' : 'border-b border-bg-sunken'}`}
              >
                <Text className="text-caption text-text-disabled" maxFontSizeMultiplier={1.3}>
                  {row.label}
                </Text>
                {row.custom}
              </View>
            );
          }
          return (
            <FieldRow
              key={row.key}
              label={row.label}
              value={row.value ?? ''}
              {...(row.actions ? { actions: row.actions } : {})}
              {...(row.onPress ? { onPress: row.onPress } : {})}
              {...(row.collapsible ? { collapsible: true, multiline: true } : {})}
              onAction={onAction}
              showDivider={!last}
              testID={`doc-field-${row.key}`}
            />
          );
        })}
      </View>
    </View>
  );
}

/* ── 로딩 / 에러 ──────────────────────────────────────────────────────────── */

function DetailLoading() {
  // 상태표 `로딩` — 이미지 스켈레톤 + 필드 스켈레톤 4행
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Skeleton width="100%" height={IMAGE_HEIGHT} radius={radius.card} />
      <View className="mt-5 gap-4">
        {[0, 1, 2, 3].map((i) => (
          <View key={i} className="gap-1.5">
            <Skeleton width="24%" height={11} radius={4} />
            <Skeleton width="62%" height={16} radius={4} />
          </View>
        ))}
      </View>
    </View>
  );
}

function DetailError({
  message,
  actionLabel = COPY.retry,
  onAction,
}: {
  message: string;
  actionLabel?: string;
  onAction: () => void;
}) {
  return (
    <View
      className="items-start border border-danger-border bg-danger-container px-4 py-4"
      style={{ borderRadius: radius.card }}
      accessibilityLiveRegion="polite"
    >
      <Text className="text-body-sm font-w700 text-danger">{message}</Text>
      <Button
        label={actionLabel}
        onPress={onAction}
        variant="ghost"
        size="sm"
        style={{ marginTop: spacing.sm }}
      />
    </View>
  );
}

/* ── 하단 액션바 ──────────────────────────────────────────────────────────── */

/**
 * `삭제` 는 와이어프레임이 **danger-ghost** 를 지정하는데 CMP-01 Button 에는 그 조합이 없고
 * `src/components/ui/Button.tsx` 는 담당 범위 밖이라 고칠 수 없다. 그래서 이 화면 안에서
 * danger 토큰만으로 같은 시각을 만든다(색은 전부 토큰 className, HEX 없음).
 */
function DangerGhostButton({ label, onPress, disabled }: { label: string; onPress: () => void; disabled: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      className="h-[52px] items-center justify-center rounded-card border border-danger-border bg-transparent px-5"
      style={({ pressed }) => [{ opacity: disabled ? 0.5 : pressed ? 0.7 : 1 }, { flex: 1 }]}
    >
      <Text className="text-button font-w700 text-danger" maxFontSizeMultiplier={1.3}>
        {label}
      </Text>
    </Pressable>
  );
}

function ActionBar({
  onDelete,
  onEdit,
  disabled,
  paddingBottom,
}: {
  onDelete: () => void;
  onEdit: () => void;
  disabled: boolean;
  paddingBottom: number;
}) {
  return (
    <View
      className="flex-row gap-3 border-t border-border-subtle bg-bg-elevated px-4 pt-3"
      style={{ paddingBottom }}
    >
      <DangerGhostButton label="삭제" onPress={onDelete} disabled={disabled} />
      <Button
        label="수정"
        onPress={onEdit}
        variant="primary"
        size="lg"
        disabled={disabled}
        haptic="selection"
        style={{ flex: 1.4 }}
      />
    </View>
  );
}

/* ── 헤더 ─────────────────────────────────────────────────────────────────── */

function DetailHeader({
  title,
  onEdit,
  onMore,
  onClose,
  disabled,
}: {
  title: string;
  onEdit: () => void;
  onMore: () => void;
  onClose: () => void;
  disabled: boolean;
}) {
  const t = useTheme();
  return (
    <View className="h-14 flex-row items-center justify-between px-4">
      <Text className="flex-1 text-h3 font-w700 text-text-primary" accessibilityRole="header" maxFontSizeMultiplier={1.3}>
        {title}
      </Text>
      <View className="flex-row items-center gap-1">
        <IconButton
          icon={<PencilIcon color={t.text.secondary} />}
          onPress={onEdit}
          accessibilityLabel="수정"
          disabled={disabled}
        />
        <IconButton icon={<MoreIcon color={t.text.secondary} />} onPress={onMore} accessibilityLabel="더 보기" />
        <IconButton icon={<CloseIcon color={t.text.secondary} />} onPress={onClose} accessibilityLabel="닫기" />
      </View>
    </View>
  );
}

/* ── 명함 그룹 선택 시트 ──────────────────────────────────────────────────── */

function GroupPicker({
  visible,
  groups,
  selectedId,
  onSelect,
  onClose,
}: {
  visible: boolean;
  groups: { id: Uuid; name: string }[];
  selectedId: Uuid | null;
  onSelect: (groupId: Uuid | null, name: string) => void;
  onClose: () => void;
}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  if (!visible) return null;

  const options: { id: Uuid | null; name: string }[] = [
    { id: null, name: CARD_GROUP_FIXED_LABELS.ungrouped },
    ...groups.map((group) => ({ id: group.id as Uuid | null, name: group.name })),
  ];

  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="닫기"
        onPress={onClose}
        style={{ flex: 1, backgroundColor: t.scrim, justifyContent: 'flex-end' }}
      >
        {/* 시트 본체 탭이 백드롭으로 전파되지 않도록 Pressable 로 한 겹 막는다 */}
        <Pressable
          accessible={false}
          onPress={() => undefined}
          className="bg-bg-elevated px-5 pt-4"
          style={{
            borderTopLeftRadius: radius.sheet,
            borderTopRightRadius: radius.sheet,
            paddingBottom: insets.bottom + spacing.lg,
          }}
        >
          <Text className="pb-2 text-h3 font-w700 text-text-primary" accessibilityRole="header">
            명함 그룹
          </Text>
          <ScrollView style={{ maxHeight: 320 }}>
            <View accessibilityRole="radiogroup">
              {options.map((option) => {
                const selected = (option.id ?? null) === selectedId;
                return (
                  <Pressable
                    key={option.id ?? 'ungrouped'}
                    accessibilityRole="radio"
                    accessibilityState={{ selected, checked: selected }}
                    accessibilityLabel={option.name}
                    onPress={() => onSelect(option.id, option.name)}
                    className="h-14 justify-center"
                    style={({ pressed }) => (pressed ? { opacity: 0.85 } : null)}
                  >
                    <Text
                      className={`text-input ${selected ? 'font-w700 text-action' : 'font-w500 text-text-primary'}`}
                      maxFontSizeMultiplier={1.3}
                    >
                      {option.name}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/* ── 화면 ─────────────────────────────────────────────────────────────────── */

export default function DocumentDetailScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const t = useTheme();
  const params = useLocalSearchParams<{ type?: string; id?: string }>();

  const rawType = first(params.type);
  // URL 세그먼트는 소문자(`card`/`ticket`/…)다 — Navigation Map §7. 대문자 `DocumentType` 으로
  // 직접 비교하면 보관함에서 넘어온 모든 링크가 "잘못된 주소" 로 떨어진다.
  const docType: DocumentType | null = documentTypeFromSegment(rawType);
  const id = first(params.id);
  const sheetMode = docType !== null && SHEET_TYPES.includes(docType);

  /* ── 데이터 ─────────────────────────────────────────────────────────────── */
  // 훅은 조건부로 부를 수 없다. 파라미터가 잘못되면 `id: undefined` 로 쿼리를 꺼 둔다.
  const query = useDocument(docType ?? 'BUSINESS_CARD', docType && id ? id : undefined);
  const doc = query.data;

  const groupsQuery = useCardGroups({ enabled: docType === 'BUSINESS_CARD' });
  const moveGroup = useMoveCardToGroup();
  const remove = useDeleteDocument();

  /* ── 로컬 상태 ──────────────────────────────────────────────────────────── */
  const [offline, setOffline] = useState(false);
  /** 로드에 실패한 이미지 URL. 불리언이 아니라 URL 을 담아 두면 재검증으로 URL 이 바뀔 때 자동으로 풀린다. */
  const [failedImageUrl, setFailedImageUrl] = useState<string | null>(null);
  const [groupPickerOpen, setGroupPickerOpen] = useState(false);
  const closing = useRef(false);
  const sheetRef = useRef<ComponentRef<typeof BottomSheet>>(null);

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => setOffline(state.isConnected === false));
    return unsubscribe;
  }, []);

  const imageUrl = doc?.imageUrl ?? null;
  const imageFailed = imageUrl !== null && failedImageUrl === imageUrl;

  /* ── 닫기 ───────────────────────────────────────────────────────────────── */
  const close = useCallback(() => {
    if (closing.current) return;
    closing.current = true;
    if (router.canGoBack()) router.back();
    else router.replace({ pathname: '/(tabs)/archive', params: docType ? { type: docType } : {} });
  }, [docType, router]);

  /** 시트는 애니메이션을 마친 뒤 pop 한다. `onClose` 가 `close()` 를 부른다. */
  const requestClose = useCallback(() => {
    if (sheetMode) sheetRef.current?.close();
    else close();
  }, [close, sheetMode]);

  /* ── 액션 ───────────────────────────────────────────────────────────────── */

  /**
   * 외부 앱 열기.
   * `canOpenURL` 을 먼저 부르지 않는다 — Android 11+ 는 매니페스트 `queries` 없이는
   * `tel:`/`mailto:` 에도 false 를 돌려주어 멀쩡한 링크가 막힌다. 실패를 catch 로 잡는다.
   */
  const openExternal = useCallback(async (url: string) => {
    try {
      await Linking.openURL(url);
    } catch {
      toast.error(COPY.noApp);
    }
  }, []);

  const handleFieldAction = useCallback(
    (action: FieldAction, value: string) => {
      const v = value.trim();
      if (!v) return;
      switch (action) {
        case 'call':
          void openExternal(`tel:${v.replace(/[^\d+*#]/g, '')}`);
          break;
        case 'sms':
          void openExternal(`sms:${v.replace(/[^\d+*#]/g, '')}`);
          break;
        case 'email':
          void openExternal(`mailto:${v}`);
          break;
        case 'map':
          // 지도 앱 공통 스킴. 한글 주소가 들어가므로 반드시 인코딩한다.
          void openExternal(`geo:0,0?q=${encodeURIComponent(v)}`);
          break;
        case 'web':
          void WebBrowser.openBrowserAsync(withScheme(v)).catch(() => toast.error(COPY.noApp));
          break;
        case 'copy':
          // FieldRow 는 `onAction` 이 있으면 복사도 위임한다(내부 처리 안 함) — 여기서 끝낸다.
          void Clipboard.setStringAsync(v).then(() => toast.success(COPY.copied));
          break;
        case 'calendar':
          // expo-calendar 미설치라 이번 범위 밖이다(패키지 설치 금지).
          break;
      }
    },
    [openExternal],
  );

  const openViewer = useCallback(() => {
    if (!doc) return;
    if (!imageUrl || imageFailed) {
      toast.info(COPY.imageEmpty);
      return;
    }
    router.push({
      pathname: '/viewer',
      params: {
        uri: imageUrl,
        title: `${DOCUMENT_TYPE_LABELS[doc.type]} 이미지`,
        docType: doc.type,
      },
    });
  }, [doc, imageFailed, imageUrl, router]);

  const goEdit = useCallback(() => {
    if (!docType || !id) return;
    // 내보낼 때는 항상 소문자 세그먼트로 되돌린다.
    router.push({ pathname: '/doc/[type]/[id]/edit', params: { type: DOC_ROUTE_SEGMENT[docType], id } });
  }, [docType, id, router]);

  const rows = useMemo<DetailRow[]>(() => {
    if (!doc) return [];
    const groupName =
      doc.type === 'BUSINESS_CARD'
        ? (groupsQuery.data?.find((group) => group.id === doc.groupId)?.name ??
          CARD_GROUP_FIXED_LABELS.ungrouped)
        : '';
    return buildRows(doc, { groupName, onPickGroup: () => setGroupPickerOpen(true) });
  }, [doc, groupsQuery.data]);

  const share = useCallback(() => {
    if (!doc) return;
    void Share.share({ message: buildShareText(doc, rows) }).catch(() => undefined);
  }, [doc, rows]);

  /** `⋯` — Android Alert 는 버튼 3개가 상한이라 정확히 3개로 구성한다. */
  const openMore = useCallback(() => {
    if (!doc) return;
    Alert.alert(`${DOCUMENT_TYPE_LABELS[doc.type]} 상세`, undefined, [
      { text: '이미지 보기', onPress: openViewer },
      { text: '공유', onPress: share },
      { text: '취소', style: 'cancel' },
    ]);
  }, [doc, openViewer, share]);

  const confirmDelete = useCallback(() => {
    if (!docType || !doc) return;
    const copy = DELETE_CONFIRM[docType];
    haptics.warning(); // G-6
    Alert.alert(copy.title, copy.body, [
      { text: '취소', style: 'cancel' },
      {
        text: '삭제',
        style: 'destructive',
        onPress: () => {
          // 낙관적 제거는 훅이 담당한다. 화면은 즉시 닫고 결과만 토스트로 알린다.
          requestClose();
          remove
            .mutateAsync(toDeleteInput(doc))
            .then(() => toast.success(DOCUMENT_COPY.deleted[docType]))
            // 롤백은 훅이 하고(조용한 롤백 금지 규칙) 화면은 사유만 알린다.
            .catch((error: unknown) =>
              toast.error(error instanceof Error ? error.message : DOCUMENT_COPY.deleteFailed),
            );
        },
      },
    ]);
  }, [doc, docType, remove, requestClose]);

  const pickGroup = useCallback(
    (groupId: Uuid | null, name: string) => {
      setGroupPickerOpen(false);
      if (!doc || doc.type !== 'BUSINESS_CARD') return;
      if ((doc.groupId ?? null) === groupId) return;
      haptics.selection();
      moveGroup
        .mutateAsync({ cardId: doc.id, groupId })
        .then(() => toast.success(`${name}(으)로 옮겼습니다.`))
        .catch((error: unknown) =>
          toast.error(error instanceof Error ? error.message : '그룹 이동에 실패했습니다.'),
        );
    },
    [doc, moveGroup],
  );

  /* ── 본문 조립 ──────────────────────────────────────────────────────────── */

  const title = docType ? `${DOCUMENT_TYPE_LABELS[docType]} 상세` : '문서 상세';
  const actionsDisabled = !doc || offline;

  const body = (() => {
    if (!docType || !id) {
      return <DetailError message={COPY.notFound} actionLabel="닫기" onAction={close} />;
    }
    if (query.isPending && !doc) return <DetailLoading />;
    if (query.isError && !doc) {
      return (
        <DetailError
          message={query.error?.message ?? DOCUMENT_COPY.detailFailed}
          onAction={() => void query.refetch()}
        />
      );
    }
    if (!doc) return <DetailError message={COPY.notFound} actionLabel="닫기" onAction={close} />;

    return (
      <DetailContent
        doc={doc}
        rows={rows}
        imageUri={imageFailed ? null : imageUrl}
        offline={offline}
        onOpenImage={openViewer}
        onImageError={() => setFailedImageUrl(imageUrl)}
        onAction={handleFieldAction}
      />
    );
  })();

  const groupPicker =
    doc?.type === 'BUSINESS_CARD' ? (
      <GroupPicker
        visible={groupPickerOpen}
        groups={groupsQuery.data ?? []}
        selectedId={doc.groupId}
        onSelect={pickGroup}
        onClose={() => setGroupPickerOpen(false)}
      />
    ) : null;

  /* ── ① 바텀시트 (티켓 · 영수증) ─────────────────────────────────────────── */

  if (sheetMode) {
    return (
      <>
        <Stack.Screen
          options={{
            presentation: 'transparentModal',
            animation: 'fade',
            contentStyle: { backgroundColor: 'transparent' },
          }}
        />
        <DocumentDetailSheet
          ref={sheetRef}
          title={title}
          onClosed={close}
          onRequestClose={requestClose}
          onEdit={goEdit}
          onMore={openMore}
          onDelete={confirmDelete}
          disabled={actionsDisabled}
          paddingBottom={insets.bottom + spacing.md}
          scrim={t.scrim}
        >
          {body}
        </DocumentDetailSheet>
        {groupPicker}
      </>
    );
  }

  /* ── ② 풀스크린 (명함 · 포스터) ─────────────────────────────────────────── */

  return (
    <View className="flex-1 bg-bg-base">
      <Stack.Screen options={{ animation: 'slide_from_right' }} />
      <View style={{ paddingTop: insets.top }}>
        <DetailHeader
          title={title}
          onEdit={goEdit}
          onMore={openMore}
          onClose={close}
          disabled={actionsDisabled}
        />
      </View>

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl }}
        keyboardShouldPersistTaps="handled"
      >
        {body}
      </ScrollView>

      {doc ? (
        <ActionBar
          onDelete={confirmDelete}
          onEdit={goEdit}
          disabled={actionsDisabled}
          paddingBottom={insets.bottom + spacing.md}
        />
      ) : null}

      {groupPicker}
    </View>
  );
}

/* ── 바텀시트 껍데기 ──────────────────────────────────────────────────────── */

type SheetProps = {
  title: string;
  children: ReactNode;
  /** 시트 애니메이션이 끝난 뒤(= 실제 닫힘) 라우트를 pop 한다. */
  onClosed: () => void;
  onRequestClose: () => void;
  onEdit: () => void;
  onMore: () => void;
  onDelete: () => void;
  disabled: boolean;
  paddingBottom: number;
  scrim: string;
};

/**
 * `ref` 로 `close()` 를 받아야 하므로 별도 컴포넌트로 뺐다.
 * React 19 라 `forwardRef` 없이 `ref` 를 prop 으로 받는다.
 */
function DocumentDetailSheet({
  ref,
  title,
  children,
  onClosed,
  onRequestClose,
  onEdit,
  onMore,
  onDelete,
  disabled,
  paddingBottom,
  scrim,
}: SheetProps & { ref: Ref<ComponentRef<typeof BottomSheet>> }) {
  const snapPoints = useMemo(() => ['55%', '92%'], []);

  // MOT-03 — 시트 스프링. SCR-19 는 `damping 20 / stiffness 200` 을 지정한다.
  const animationConfigs = useBottomSheetSpringConfigs({ damping: 20, stiffness: 200, mass: 1 });

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop
        {...props}
        appearsOnIndex={0}
        disappearsOnIndex={-1}
        opacity={1}
        pressBehavior="close"
        style={[props.style, { backgroundColor: scrim }]}
      />
    ),
    [scrim],
  );

  return (
    <Modal visible transparent animationType="none" statusBarTranslucent onRequestClose={onRequestClose}>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <BottomSheet
          ref={ref}
          index={0}
          snapPoints={snapPoints}
          // v5 기본값이 true 라 명시적으로 끈다 — 켜져 있으면 snapPoints 가 무시된다.
          enableDynamicSizing={false}
          enablePanDownToClose
          animationConfigs={animationConfigs}
          backdropComponent={renderBackdrop}
          onClose={onClosed}
          // 55% ↔ 92% 스냅 시 selection 햅틱 (SCR-19 인터랙션표)
          onChange={(index) => {
            if (index >= 0) haptics.selection();
          }}
          backgroundStyle={{ borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet }}
          handleIndicatorStyle={{ width: 36 }}
        >
          <SheetShell
            title={title}
            onEdit={onEdit}
            onMore={onMore}
            onClose={onRequestClose}
            onDelete={onDelete}
            disabled={disabled}
            paddingBottom={paddingBottom}
          >
            {children}
          </SheetShell>
        </BottomSheet>
      </GestureHandlerRootView>
    </Modal>
  );
}

/**
 * 시트 내부 구조: 고정 헤더 + 스크롤 본문 + 고정 액션바.
 * 색은 `BottomSheet` 의 `backgroundStyle` 이 아니라 여기서 className 으로 준다 — 토큰 사용 규칙(§3-0).
 */
function SheetShell({
  title,
  children,
  onEdit,
  onMore,
  onClose,
  onDelete,
  disabled,
  paddingBottom,
}: {
  title: string;
  children: ReactNode;
  onEdit: () => void;
  onMore: () => void;
  onClose: () => void;
  onDelete: () => void;
  disabled: boolean;
  paddingBottom: number;
}) {
  return (
    <View className="flex-1 bg-bg-elevated">
      <DetailHeader title={title} onEdit={onEdit} onMore={onMore} onClose={onClose} disabled={disabled} />
      <BottomSheetScrollView
        contentContainerStyle={{ paddingHorizontal: spacing.xl, paddingBottom: spacing.xl }}
      >
        {children}
      </BottomSheetScrollView>
      <ActionBar onDelete={onDelete} onEdit={onEdit} disabled={disabled} paddingBottom={paddingBottom} />
    </View>
  );
}
