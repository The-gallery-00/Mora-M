// app/doc/[type]/[id]/edit.tsx — SCR-20 · 문서 편집
//
// 정본: wiki/design/Screen Specs.md SCR-20 (편집 가능 필드 표 · 상태표 · 인터랙션표 · 이탈 확인 문구)
//       wiki/tech/Camera and Scan.md §10 (FLD-01~09 폼 조립 · 검증 등급)
//       src/features/scan/fieldSchema.ts (입력 타입 · 키보드 · maxLength · zod 검증 — **여기서 새로 만들지 않는다**)
//
// ── 키가 두 벌인 이유 ────────────────────────────────────────────────────────
// `fieldSchema` 의 키는 OCR snake_case(`company_name`)이고, 보관함 모델·수정 API 의 키는
// Spring camelCase(`company`)다. 둘은 이름이 서로 다르므로(회사명=company_name↔company,
// 직책=job_title↔position, 휴대폰=mobile_phone↔phone, 업체=store_name↔merchantName …)
// 아래 `EDITABLE` 표 하나가 유일한 변환 지점이다. 여기 없는 필드는 편집 대상이 아니다
// (SCR-20 `편집 가능 필드` = 원본 `EDITABLE_KEYS` 그대로).
//
// ── 라벨 우선순위 (FR-045) ──────────────────────────────────────────────────
// ① 서버 `fields` — 단건 조회 응답에는 없다(엔티티 DTO 뿐이라 스캔 응답과 달리 라벨을 안 준다)
// ② 위키 SCR-19/20 라벨 표 — 상세와 편집이 반드시 같은 이름을 써야 한다(원본은 보관함 `직책` /
//    검색 `직함` 으로 갈려 있었다). 그래서 `EDITABLE` 표가 라벨을 들고 있다.
// ③ `fieldSchema` 의 라벨 — ②에 없는 키의 폴백.
//
// ── 입력 컴포넌트로 FieldRow(편집 모드)를 쓰지 않는 이유 ────────────────────
// CMP-27 FieldRow 의 편집 모드는 `onBlur` / `clearable` / `returnKeyType` 을 노출하지 않아
// SCR-20 인터랙션표의 `✕ 값 비우기`, 키보드 `다음` 포커스 이동, 블러 시 날짜/시간 ISO 정규화를
// 구현할 수 없다. 그래서 SCR-12(스캔 결과 편집)와 **같은 방식**으로 CMP-03 TextField 를 직접 쓴다.
// 라벨·순서가 상세 화면과 어긋나는 위험은 이 파일의 `EDITABLE` 표 하나로 막는다.
import { zodResolver } from '@hookform/resolvers/zod';
import NetInfo from '@react-native-community/netinfo';
import { Image } from 'expo-image';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Controller, useForm, type Resolver } from 'react-hook-form';
import {
  Alert,
  BackHandler,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { z } from 'zod';

import { DocPlaceholderIcon } from '@/components/documents';
import { Button, Chip, Skeleton, TextField, toast } from '@/components/ui';
import {
  DOC_ROUTE_SEGMENT,
  DOCUMENT_COPY,
  DOCUMENT_TYPE_LABELS,
  documentTypeFromSegment,
  useDocument,
  useUpdateDocument,
  type DocumentDetail,
  type DocumentType,
  type DocumentUpdateInput,
} from '@/features/documents';
import {
  buildFieldDefs,
  fieldZodSchema,
  formatMoney,
  parseMoney,
  toIsoDate,
  toIsoTime,
  warnFieldValue,
  type FieldDef,
} from '@/features/scan/fieldSchema';
import { haptics } from '@/lib/haptics';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, spacing } from '@/theme/scale';

/** 상단 읽기 전용 이미지 높이 (SCR-20 와이어프레임 `이미지 120dp`). */
const IMAGE_HEIGHT = 120;

/** 화면 문구 — 전부 SCR-20 상태표/이탈 확인 원문이다. */
const COPY = {
  imageEmpty: '이미지가 없습니다',
  requiredEmpty: '필수 항목을 입력해 주세요.',
  formatInvalid: '날짜·시간·금액 형식을 확인해 주세요.',
  offline: '오프라인입니다. 연결되면 저장할 수 있어요.',
  rawLabel: 'OCR 원문 (읽기 전용)',
  leaveTitle: '변경 사항을 저장하지 않고 나갈까요?',
  leaveBody: '수정한 내용이 사라집니다.',
  leaveConfirm: '나가기',
  leaveCancel: '계속 수정',
  saving: '저장 중...',
  retry: '다시 시도',
} as const;

/* ── 편집 가능 필드 (SCR-20 표 = 원본 `EDITABLE_KEYS`) ────────────────────── */

type EditableField = {
  /** `fieldSchema.ts` 의 `FieldDef.key` (OCR snake_case) */
  schemaKey: string;
  /** `DocumentDetail` / `*UpdateInput` 의 키 (Spring camelCase) */
  modelKey: string;
  /** SCR-19/20 라벨 표 원문 */
  label: string;
};

const EDITABLE: Record<DocumentType, readonly EditableField[]> = {
  BUSINESS_CARD: [
    { schemaKey: 'name', modelKey: 'name', label: '이름' },
    { schemaKey: 'company_name', modelKey: 'company', label: '회사명' },
    { schemaKey: 'job_title', modelKey: 'position', label: '직책' },
    { schemaKey: 'mobile_phone', modelKey: 'phone', label: '전화번호' },
    { schemaKey: 'email', modelKey: 'email', label: '이메일' },
  ],
  TICKET: [
    { schemaKey: 'transport_type', modelKey: 'transportType', label: '교통수단' },
    { schemaKey: 'departure_location', modelKey: 'departureLocation', label: '출발지' },
    { schemaKey: 'departure_date', modelKey: 'departureDate', label: '출발일' },
    { schemaKey: 'departure_time', modelKey: 'departureTime', label: '출발 시간' },
    { schemaKey: 'arrival_location', modelKey: 'arrivalLocation', label: '도착지' },
    { schemaKey: 'arrival_date', modelKey: 'arrivalDate', label: '도착일' },
    { schemaKey: 'arrival_time', modelKey: 'arrivalTime', label: '도착 시간' },
  ],
  POSTER: [
    { schemaKey: 'title', modelKey: 'title', label: '제목' },
    { schemaKey: 'organizer_name', modelKey: 'organizerName', label: '주최자' },
    { schemaKey: 'event_start_date', modelKey: 'eventStartDate', label: '행사 시작일' },
    { schemaKey: 'event_end_date', modelKey: 'eventEndDate', label: '행사 종료일' },
    { schemaKey: 'location', modelKey: 'location', label: '장소' },
    { schemaKey: 'contact_phone', modelKey: 'contactPhone', label: '연락처' },
    { schemaKey: 'contact_email', modelKey: 'contactEmail', label: '이메일' },
    { schemaKey: 'fee', modelKey: 'fee', label: '참가비' },
    { schemaKey: 'website_url', modelKey: 'websiteUrl', label: '웹사이트' },
    { schemaKey: 'description', modelKey: 'description', label: '설명' },
  ],
  RECEIPT: [
    { schemaKey: 'store_name', modelKey: 'merchantName', label: '상호명' },
    { schemaKey: 'merchant_address', modelKey: 'merchantAddress', label: '주소' },
    { schemaKey: 'purchase_date', modelKey: 'purchaseDate', label: '구매일' },
    { schemaKey: 'purchase_time', modelKey: 'purchaseTime', label: '구매시간' },
    { schemaKey: 'payment_method', modelKey: 'paymentMethod', label: '결제수단' },
    { schemaKey: 'card_company', modelKey: 'cardCompany', label: '카드사' },
    { schemaKey: 'total_amount', modelKey: 'totalAmount', label: '총액' },
    { schemaKey: 'currency_code', modelKey: 'currencyCode', label: '통화' },
  ],
};

/**
 * 비면 저장을 차단하는 필드 (SCR-20 상태표 `빈`).
 * `fieldSchema` 는 필수를 정의하지 않으므로(문서 필드에 필수 없음 — Camera and Scan §10-3)
 * **편집 화면 한정 규칙**으로 여기에만 둔다. 티켓은 지정된 필수 필드가 없다.
 */
const REQUIRED_SCHEMA_KEY: Record<DocumentType, string | null> = {
  BUSINESS_CARD: 'name',
  POSTER: 'title',
  RECEIPT: 'store_name',
  TICKET: null,
};

/** OCR 원문의 모델 키 — 명함만 컬럼 이름이 다르다. */
const RAW_TEXT_KEY: Record<DocumentType, 'rawOcrText' | 'rawText'> = {
  BUSINESS_CARD: 'rawOcrText',
  POSTER: 'rawText',
  TICKET: 'rawText',
  RECEIPT: 'rawText',
};

/* ── 값 변환 ──────────────────────────────────────────────────────────────── */

function first(raw: string | string[] | undefined): string {
  if (typeof raw === 'string') return raw;
  if (Array.isArray(raw)) return raw[0] ?? '';
  return '';
}

const readModel = (doc: DocumentDetail, key: string): unknown =>
  (doc as unknown as Record<string, unknown>)[key];

/** 상세 모델 → 폼 값(항상 문자열). 금액만 `12,500` 표기로 바꿔 넣는다. */
function toFormValues(doc: DocumentDetail, fields: readonly EditableField[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const field of fields) {
    const raw = readModel(doc, field.modelKey);
    if (field.modelKey === 'totalAmount') {
      out[field.schemaKey] = formatMoney(typeof raw === 'number' ? raw : null);
      continue;
    }
    out[field.schemaKey] = typeof raw === 'string' ? raw : '';
  }
  return out;
}

/**
 * 폼 값 → 수정 요청.
 *
 * 편집 가능 필드는 **전부** 싣는다 — 명함 PUT 이 부분 수정이 아니기 때문이다(SCR-20 데이터 표).
 * `parsedJson`/`rawText`/`rawJson` 을 빼는 판단은 `features/documents/api.ts` 가 이미 하고 있으므로
 * 여기서는 값만 넘긴다.
 */
function toUpdateInput(
  doc: DocumentDetail,
  values: Record<string, string>,
  fields: readonly EditableField[],
): DocumentUpdateInput {
  const get = (schemaKey: string) => (values[schemaKey] ?? '').trim();
  const body: Record<string, string> = {};
  for (const field of fields) body[field.modelKey] = get(field.schemaKey);

  switch (doc.type) {
    case 'BUSINESS_CARD':
      return {
        type: 'BUSINESS_CARD',
        id: doc.id,
        values: {
          name: body.name ?? '',
          company: body.company ?? '',
          position: body.position ?? '',
          phone: body.phone ?? '',
          email: body.email ?? '',
        },
      };
    case 'TICKET':
      return {
        type: 'TICKET',
        id: doc.id,
        values: {
          transportType: body.transportType ?? '',
          departureLocation: body.departureLocation ?? '',
          departureDate: body.departureDate ?? '',
          departureTime: body.departureTime ?? '',
          arrivalLocation: body.arrivalLocation ?? '',
          arrivalDate: body.arrivalDate ?? '',
          arrivalTime: body.arrivalTime ?? '',
        },
      };
    case 'POSTER':
      return {
        type: 'POSTER',
        id: doc.id,
        values: {
          title: body.title ?? '',
          organizerName: body.organizerName ?? '',
          eventStartDate: body.eventStartDate ?? '',
          eventEndDate: body.eventEndDate ?? '',
          contactPhone: body.contactPhone ?? '',
          contactEmail: body.contactEmail ?? '',
          location: body.location ?? '',
          fee: body.fee ?? '',
          websiteUrl: body.websiteUrl ?? '',
          description: body.description ?? '',
        },
      };
    case 'RECEIPT':
      return {
        type: 'RECEIPT',
        id: doc.id,
        values: {
          merchantName: body.merchantName ?? '',
          merchantAddress: body.merchantAddress ?? '',
          purchaseDate: body.purchaseDate ?? '',
          purchaseTime: body.purchaseTime ?? '',
          paymentMethod: body.paymentMethod ?? '',
          cardCompany: body.cardCompany ?? '',
          // `null` 이면 api.ts 가 키 자체를 빼고 서버는 기존 값을 유지한다.
          totalAmount: parseMoney(body.totalAmount ?? ''),
          currencyCode: body.currencyCode ?? '',
          // `items` 는 보내지 않는다 — `[]` 를 보내면 품목이 전량 삭제된다(api.ts 주석).
        },
      };
  }
}

/* ── 필드 1개 ─────────────────────────────────────────────────────────────── */

type EditFieldProps = {
  def: FieldDef;
  label: string;
  value: string;
  onChange: (next: string) => void;
  onBlur: () => void;
  error?: string;
  disabled: boolean;
  isLast: boolean;
  inputRef: (node: TextInput | null) => void;
  onNext: () => void;
};

function EditField({
  def,
  label,
  value,
  onChange,
  onBlur,
  error,
  disabled,
  isLast,
  inputRef,
  onNext,
}: EditFieldProps) {
  const multiline = def.inputType === 'multiline';
  const warning = error ? undefined : (warnFieldValue(def, value) ?? undefined);

  /**
   * §10-4 정규화 보조 — 포커스가 빠질 때 `2026.05.16` / `오후 3시` 를 ISO 로 옮겨 준다.
   * 네이티브 날짜/시간 피커 패키지가 없어(설치 금지) 형식 힌트 + 블러 정규화로 대체한다.
   * **실패하면 값을 지우지 않는다** — 원문 보존이 우선이고, 형식이 끝내 안 맞으면 A등급 검증이 잡는다.
   */
  const handleBlur = () => {
    if (def.inputType === 'date') {
      const iso = toIsoDate(value);
      if (iso !== null && iso !== value) onChange(iso);
    } else if (def.inputType === 'time') {
      const iso = toIsoTime(value);
      if (iso !== null && iso !== value) onChange(iso);
    }
    onBlur();
  };

  const hint =
    warning ?? (def.inputType === 'date' ? 'YYYY-MM-DD' : def.inputType === 'time' ? 'HH:MM' : undefined);

  return (
    <View>
      {/* select 프리셋은 칩 1탭으로, 자유 입력도 함께 허용한다 (§10-2) */}
      {def.inputType === 'select' && def.options ? (
        <View className="mb-2 flex-row flex-wrap gap-2">
          {def.options.map((option) => (
            <Chip
              key={option}
              label={option}
              selected={value === option}
              tone="neutral"
              size="sm"
              onPress={disabled ? undefined : () => onChange(value === option ? '' : option)}
            />
          ))}
        </View>
      ) : null}

      <TextField
        ref={inputRef}
        value={value}
        onChangeText={onChange}
        onBlur={handleBlur}
        label={label}
        placeholder={def.placeholder}
        keyboardType={def.keyboardType}
        multiline={multiline}
        numberOfLines={def.rows ?? 3}
        disabled={disabled}
        clearable={!multiline}
        // 키보드 `다음` → 다음 필드 포커스 (SCR-20 인터랙션표). multiline 은 줄바꿈이 우선이다.
        returnKeyType={multiline ? 'default' : isLast ? 'done' : 'next'}
        onSubmitEditing={multiline || isLast ? undefined : onNext}
        {...(def.maxLength !== undefined ? { maxLength: def.maxLength } : {})}
        {...(def.autoCapitalize ? { autoCapitalize: def.autoCapitalize } : {})}
        {...(error ? { error } : {})}
        {...(hint ? { hint } : {})}
        testID={`edit-field-${def.key}`}
      />
    </View>
  );
}

/* ── 화면 ─────────────────────────────────────────────────────────────────── */

export default function DocumentEditScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const t = useTheme();
  const params = useLocalSearchParams<{ type?: string; id?: string }>();

  const rawType = first(params.type);
  // URL 세그먼트는 소문자(`card`/`ticket`/…)다 — Navigation Map §7.
  const docType: DocumentType | null = documentTypeFromSegment(rawType);
  const id = first(params.id);

  const query = useDocument(docType ?? 'BUSINESS_CARD', docType && id ? id : undefined);
  const doc = query.data;
  const update = useUpdateDocument();

  const [offline, setOffline] = useState(false);
  /** 로드에 실패한 이미지 URL. URL 을 담아 두면 값이 갱신될 때 실패 상태가 저절로 풀린다. */
  const [failedImageUrl, setFailedImageUrl] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const inputs = useRef<Record<string, TextInput | null>>({});
  const seeded = useRef(false);

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => setOffline(state.isConnected === false));
    return unsubscribe;
  }, []);

  /* ── 폼 정의 ────────────────────────────────────────────────────────────── */

  const fields = useMemo<readonly EditableField[]>(
    () => (docType ? EDITABLE[docType] : []),
    [docType],
  );

  /**
   * 입력 타입·키보드·maxLength·검증은 전부 `fieldSchema` 에서 온다. 라벨만 위키 표로 덮는다.
   * 서버 `fields` 는 이 경로(단건 조회)에 존재하지 않으므로 두 번째 인자는 null 이다.
   */
  const defs = useMemo<FieldDef[]>(() => {
    if (!docType) return [];
    const base = new Map(buildFieldDefs(docType, null).map((def) => [def.key, def]));
    return fields.map((field) => {
      const def = base.get(field.schemaKey);
      return def
        ? { ...def, label: field.label }
        : // 스키마에 없는 키는 이론상 없다(위 표가 스키마의 부분집합). 방어적으로만 남긴다.
          ({
            key: field.schemaKey,
            label: field.label,
            inputType: 'text',
            keyboardType: 'default',
            required: false,
            ocrExtracted: false,
            persisted: true,
            placeholder: '직접 입력',
          } satisfies FieldDef);
    });
  }, [docType, fields]);

  /**
   * A등급 검증(FLD-06) 스키마.
   *
   * `fieldSchema.buildDocumentZodSchema` 를 쓰지 않는다 — 그쪽은 `z.record(...)` 라 `_input` 이
   * `unknown` 이고 `zodResolver` 의 `FieldValues` 제약에 물리지 않는다. 규칙 자체는 같은
   * `fieldZodSchema(def)` 에서 나오므로 검증 내용은 한 곳(fieldSchema)뿐이다.
   */
  const schema = useMemo(
    () => z.object(Object.fromEntries(defs.map((def) => [def.key, fieldZodSchema(def)]))),
    [defs],
  );

  const {
    control,
    handleSubmit,
    reset,
    formState: { isDirty },
  } = useForm<Record<string, string>>({
    defaultValues: {},
    // `fieldZodSchema` 의 선언 타입이 `ZodType<string>`(입력 타입 `unknown`)이라 resolver 제네릭이
    // `Record<string, unknown>` 으로 잡힌다. 폼 값은 항상 문자열이므로 런타임 동작은 같고 타입만 맞춘다.
    resolver: zodResolver(schema) as Resolver<Record<string, string>>,
    mode: 'onBlur',
  });

  // 서버 값이 도착하면 **한 번만** 폼에 심는다. 재검증 응답으로 사용자의 입력을 덮지 않기 위해서다.
  useEffect(() => {
    if (!doc || seeded.current) return;
    seeded.current = true;
    reset(toFormValues(doc, fields));
  }, [doc, fields, reset]);

  const imageUrl = doc?.imageUrl ?? null;
  const imageFailed = imageUrl !== null && failedImageUrl === imageUrl;

  /* ── 이탈 가드 ──────────────────────────────────────────────────────────── */

  const close = useCallback(() => {
    if (router.canGoBack()) router.back();
    else if (docType && id)
      router.replace({ pathname: '/doc/[type]/[id]', params: { type: DOC_ROUTE_SEGMENT[docType], id } });
  }, [docType, id, router]);

  const confirmLeave = useCallback(() => {
    if (!isDirty) {
      close();
      return;
    }
    haptics.warning();
    Alert.alert(COPY.leaveTitle, COPY.leaveBody, [
      { text: COPY.leaveCancel, style: 'cancel' },
      { text: COPY.leaveConfirm, style: 'destructive', onPress: close },
    ]);
  }, [close, isDirty]);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      confirmLeave();
      return true;
    });
    return () => sub.remove();
  }, [confirmLeave]);

  /* ── 저장 ───────────────────────────────────────────────────────────────── */

  const saving = update.isPending;
  const canSave = Boolean(doc) && isDirty && !saving && !offline;

  const focusField = useCallback((key: string) => {
    inputs.current[key]?.focus();
  }, []);

  const saveValues = useCallback(
    async (values: Record<string, string>) => {
      if (!doc || !docType) return;

      // 필수 필드(SCR-20 상태표 `빈`) — zod 스키마에는 필수가 없으므로 여기서 막는다.
      const requiredKey = REQUIRED_SCHEMA_KEY[docType];
      if (requiredKey && (values[requiredKey] ?? '').trim() === '') {
        haptics.warning(); // HAP-03 — 폼 검증 실패는 Warning 이다(Error 는 저장 실패용)
        setSaveError(COPY.requiredEmpty);
        // `setFocus` 는 Controller 가 ref 를 등록하지 않으면 동작하지 않는다 — 직접 잡은 ref 를 쓴다.
        focusField(requiredKey);
        return;
      }

      setSaveError(null);
      try {
        await update.mutateAsync(toUpdateInput(doc, values, fields));
        toast.success(DOCUMENT_COPY.updated); // `수정했습니다.`
        close();
      } catch (error) {
        // 실패해도 입력값을 유지한다(상태표 `에러(저장 실패)`). 롤백은 훅이 이미 했다.
        haptics.error();
        setSaveError(error instanceof Error ? error.message : DOCUMENT_COPY.updateFailed);
      }
    },
    [close, doc, docType, fields, focusField, update],
  );

  const rejectInvalid = useCallback(() => {
    // A등급 검증(FLD-06) 게이트 — 날짜/시간/금액 형식.
    // 햅틱은 아래 토스트가 울린다(ToastHost) → 여기서 또 부르면 두 번 진동한다.
    setSaveError(COPY.formatInvalid);
    toast.error(COPY.formatInvalid);
  }, []);

  /** 렌더 중이 아니라 **탭 시점**에 `handleSubmit` 을 만든다(폼 ref 를 렌더에서 읽지 않기 위해). */
  const submit = useCallback(() => {
    void handleSubmit(saveValues, rejectInvalid)();
  }, [handleSubmit, rejectInvalid, saveValues]);

  const focusNext = useCallback(
    (index: number) => {
      const next = defs[index + 1];
      if (next) focusField(next.key);
    },
    [defs, focusField],
  );

  /* ── 렌더 ───────────────────────────────────────────────────────────────── */

  const title = docType ? `${DOCUMENT_TYPE_LABELS[docType]} 수정` : '문서 수정';
  const rawText = doc && docType ? String(readModel(doc, RAW_TEXT_KEY[docType]) ?? '') : '';

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-bg-base"
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* dirty 면 iOS 스와이프 백을 막는다 — 확인 없이 입력이 사라지는 경로를 없앤다 */}
      <Stack.Screen options={{ gestureEnabled: !isDirty }} />

      {/* ── 헤더: 취소 / 제목 / 저장 (iOS 관례대로 저장을 헤더 우측에 고정) ── */}
      <View
        className="h-14 flex-row items-center justify-between border-b border-border-subtle px-2"
        style={{ marginTop: insets.top }}
      >
        <Button label="취소" onPress={confirmLeave} variant="ghost" size="sm" haptic="none" />
        <Text className="text-h3 font-w700 text-text-primary" accessibilityRole="header" maxFontSizeMultiplier={1.3}>
          {title}
        </Text>
        <Button
          label="저장"
          loadingLabel={COPY.saving}
          loading={saving}
          disabled={!canSave}
          onPress={submit}
          variant="ghost"
          size="sm"
          haptic="selection"
        />
      </View>

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxxl }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        {offline ? (
          <View
            className="mb-3 border border-warn-border bg-warn-container px-4 py-3"
            style={{ borderRadius: radius.card }}
            accessibilityLiveRegion="polite"
          >
            <Text className="text-body-sm text-warn">{COPY.offline}</Text>
          </View>
        ) : null}

        {/* ── 이미지 (읽기 전용) ─────────────────────────────────────────── */}
        <View
          className="overflow-hidden border border-border-subtle bg-surface-alt"
          style={{ height: IMAGE_HEIGHT, borderRadius: radius.card }}
        >
          {imageUrl && !imageFailed ? (
            <Image
              source={{ uri: imageUrl }}
              contentFit="contain"
              transition={160}
              style={{ width: '100%', height: '100%' }}
              // 서버 이미지가 404 일 수 있다 — 실패하면 폴백으로 교체한다 (UX-23)
              onError={() => setFailedImageUrl(imageUrl)}
              accessibilityLabel={docType ? `${DOCUMENT_TYPE_LABELS[docType]} 이미지` : '문서 이미지'}
            />
          ) : (
            <View className="flex-1 items-center justify-center gap-2">
              <DocPlaceholderIcon color={t.text.disabled} size={24} />
              <Text className="text-body-sm text-text-muted">{COPY.imageEmpty}</Text>
            </View>
          )}
        </View>

        {/* ── 동적 폼 ────────────────────────────────────────────────────── */}
        {query.isPending && !doc ? (
          <View className="mt-5 gap-4" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            {[0, 1, 2, 3, 4].map((i) => (
              <View key={i} className="gap-1.5">
                <Skeleton width="24%" height={11} radius={4} />
                <Skeleton width="100%" height={48} radius={radius.button} />
              </View>
            ))}
          </View>
        ) : query.isError && !doc ? (
          /* 조회 실패 — 이 분기가 없던 동안에는 **빈 폼**이 그려졌다. 사용자는 값이 지워진 줄 알고
             다시 입력하지만 저장 버튼은 `doc` 이 없어 영영 켜지지 않는다(FR-109 에러+재시도). */
          <View
            className="mt-5 items-start border border-danger-border bg-danger-container px-4 py-4"
            style={{ borderRadius: radius.card }}
            accessibilityLiveRegion="polite"
          >
            <Text className="text-body-sm font-w700 text-danger">
              {query.error?.message ?? DOCUMENT_COPY.detailFailed}
            </Text>
            <Button
              label={COPY.retry}
              onPress={() => void query.refetch()}
              variant="ghost"
              size="sm"
              style={{ marginTop: spacing.sm }}
            />
          </View>
        ) : (
          <View
            className="mt-5 gap-4"
            style={saving ? { opacity: 0.5 } : undefined}
            pointerEvents={saving ? 'none' : 'auto'}
          >
            {defs.map((def, index) => (
              <Controller
                key={def.key}
                control={control}
                name={def.key}
                // 검증은 `resolver`(zod)가 폼 단위로 수행한다 — resolver 가 있으면 `rules` 는 무시된다.
                render={({ field, fieldState }) => (
                  <EditField
                    def={def}
                    label={def.label}
                    value={field.value ?? ''}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                    disabled={saving}
                    isLast={index === defs.length - 1}
                    inputRef={(node) => {
                      inputs.current[def.key] = node;
                    }}
                    onNext={() => focusNext(index)}
                    {...(fieldState.error?.message ? { error: fieldState.error.message } : {})}
                  />
                )}
              />
            ))}
          </View>
        )}

        {/* ── OCR 원문 (편집 불가 명시) ──────────────────────────────────── */}
        {rawText ? (
          <View className="mt-6">
            <Text className="mb-1.5 text-label font-w600 text-text-secondary">{COPY.rawLabel}</Text>
            <View className="bg-bg-sunken px-3 py-3" style={{ borderRadius: radius.button }}>
              <Text className="text-body-sm text-text-secondary" numberOfLines={6} selectable>
                {rawText}
              </Text>
            </View>
          </View>
        ) : null}

        {/* ── 저장 실패/검증 에러 캡션 ───────────────────────────────────── */}
        {saveError ? (
          <Text className="mt-5 text-label text-danger" accessibilityLiveRegion="polite">
            {saveError}
          </Text>
        ) : null}

        {/* ── 하단 풀폭 저장 (헤더 저장과 같은 액션 — 도달성) ────────────── */}
        <Button
          label="저장"
          loadingLabel={COPY.saving}
          loading={saving}
          disabled={!canSave}
          onPress={submit}
          variant="primary"
          size="lg"
          fullWidth
          style={{ marginTop: spacing.lg }}
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
