// app/scan/review.tsx — SCR-12 · 스캔 결과 확인 / 편집
//
// 정본: wiki/design/Screen Specs.md SCR-12 (와이어프레임 · 필드 스키마 · 입력 타입 매핑 ·
//                                          상태표 · 인터랙션표 · 이탈 다이얼로그 · 저장 시퀀스)
//       wiki/tech/Camera and Scan.md §9-2(CLS-01~06) · §9-3(종류 변경 승계) · §10(FLD-01~09)
//       원본 UI: frontend/app/dashboard/upload/page.tsx (문구 `확인 & 저장` / `다시 스캔` /
//               `저장 중...` / `기타 문서는 아직 필드 스키마가 정의되지 않았습니다.`)
//
// ── 상태 소유권 ─────────────────────────────────────────────────────────────
// 편집 중의 진실은 **react-hook-form** 이 들고 있고, 스토어에는 (a) 문서 종류를 바꾸는 순간과
// (b) 저장 직전에만 밀어 넣는다. 키 입력마다 zustand 로 왕복하면 화면 전체가 다시 그려진다.
// 검증은 필드별 `rules.validate` → `validateFieldValue`(내부가 zod 스키마)로 수행한다.
//
// ── 다크 국소 예외 ──────────────────────────────────────────────────────────
// 상단 120dp 이미지 스트립만 다크에서도 라이트 표면(`#F8FAFC` = surface)을 유지한다.
// 흰 종이 문서가 화면 상단을 가로로 채우므로 그 컨테이너까지 어둡게 하면 대비 충격이 가장 크다.
// 나머지(폼·칩·액션바)는 정상적으로 테마를 따른다 — 다크에서 "밝은 이미지 띠 + 어두운 폼"이 된다.
import { useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import {
  Alert,
  BackHandler,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Chip, SegmentedControl, TextField, toast } from '@/components/ui';
import { documentKeys } from '@/features/documents';
import {
  DOCUMENT_TYPES,
  TYPE_LABELS,
  isSavableDocumentType,
  recognitionSummary,
  softWarningFor,
  toIsoDate,
  toIsoTime,
  useScan,
  useScanStore,
  validateFieldValue,
  validateFields,
  warnFieldValue,
  type DocumentType,
  type FieldDef,
  type ParsedFields,
} from '@/features/scan';
import { haptics } from '@/lib/haptics';
import { radius, spacing } from '@/theme/scale';
import { themes } from '@/theme/tokens';

import { confirmDiscardScan } from './_layout';

/** 상단 이미지 스트립 높이 (Screen Specs 와이어프레임 `h120`). */
const STRIP_HEIGHT = 120;

/** 문서 4종 → Chip 의 docTone (primitive 는 도메인을 알지 않는다 — 화면이 매핑한다). */
const DOC_TONE: Record<DocumentType, 'card' | 'ticket' | 'poster' | 'receipt' | undefined> = {
  BUSINESS_CARD: 'card',
  TICKET: 'ticket',
  POSTER: 'poster',
  RECEIPT: 'receipt',
  ETC: undefined,
};

const TYPE_OPTIONS = DOCUMENT_TYPES.map((value) => ({ value, label: TYPE_LABELS[value] }));

export default function ScanReviewScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();

  const {
    adjustedUri,
    sourceUri,
    scan,
    docType,
    values,
    fieldDefs,
    tier,
    badge,
    noExtractedValues,
    failure,
    failureMessage,
    step,
    changeDocType,
    setValues,
    save,
    resetForNextScan,
    clearFailure,
  } = useScan();

  const previewUri = adjustedUri ?? sourceUri;
  const saving = step === 'saving';
  const [rawOpen, setRawOpen] = useState(false);

  // 마운트 시점의 스토어 값을 폼 초기값으로 고정한다(이후 소유권은 폼에 있다).
  const initialValues = useRef<ParsedFields>(values);

  const { control, getValues, reset, handleSubmit, watch } = useForm<ParsedFields>({
    defaultValues: initialValues.current,
    mode: 'onBlur',
  });

  const watched = watch();

  /**
   * 현재 문서 종류의 필드만 추려 스토어로 올릴 값을 만든다.
   *
   * react-hook-form 은 `shouldUnregister: false` 가 기본이라 종류를 바꿔도 이전 스키마의 키가
   * 폼 값에 남는다. 그대로 저장하면 `parsedJson` 에 엉뚱한 키가 섞여 들어간다.
   */
  const collect = useCallback((): ParsedFields => {
    const all = getValues();
    const out: ParsedFields = {};
    for (const def of fieldDefs) out[def.key] = all[def.key] ?? '';
    return out;
  }, [fieldDefs, getValues]);

  /* ── 파생값은 폼 값 기준으로 계산한다(스토어 값은 저장 직전에만 동기화된다) ── */
  const summary = useMemo(() => recognitionSummary(fieldDefs, watched), [fieldDefs, watched]);
  const softWarning = useMemo(() => softWarningFor(docType, watched), [docType, watched]);
  const formValid = useMemo(() => validateFields(fieldDefs, watched).ok, [fieldDefs, watched]);

  /** CLS-03 저신뢰: 종류를 확정하기 전까지 폼·저장을 잠근다. */
  const locked = tier === 'pick';
  /** CLS-04 ETC: 저장 경로가 없다. */
  const blocked = tier === 'blocked' || !isSavableDocumentType(docType);
  const canSaveNow = !locked && !blocked && !saving && formValid;

  /* 스캔 결과 없이 직접 진입한 경우 방어 */
  useEffect(() => {
    if (!scan && Object.keys(initialValues.current).length === 0 && !previewUri) {
      router.replace('/scan');
    }
  }, [previewUri, router, scan]);

  /* ── 이탈 가드 ─────────────────────────────────────────────────────── */

  const leaveToCamera = useCallback(() => {
    resetForNextScan();
    router.replace('/scan');
  }, [resetForNextScan, router]);

  const handleBack = useCallback(() => {
    // 폼 값이 스토어와 어긋나 있을 수 있으므로 dirty 판정 직전에 밀어 넣는다.
    setValues(collect());
    confirmDiscardScan(leaveToCamera);
  }, [collect, leaveToCamera, setValues]);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      handleBack();
      return true;
    });
    return () => sub.remove();
  }, [handleBack]);

  /* ── 문서 종류 변경 (§9-3 승계 규칙은 스토어가 소유한다) ────────────────── */

  const handleTypeChange = useCallback(
    (next: DocumentType) => {
      if (next === docType && tier !== 'pick') return;
      // ① 현재 입력값을 스토어로 올리고 ② 스토어가 COMMON_FIELD_MAP 승계를 수행한 뒤
      // ③ 그 결과를 폼으로 되돌린다.
      setValues(collect());
      changeDocType(next);
      reset(useScanStore.getState().values);
      clearFailure();
    },
    [changeDocType, clearFailure, collect, docType, reset, setValues, tier],
  );

  /* ── 저장 시퀀스 (API-63 커밋 → 도메인 /save) ─────────────────────────── */

  const finishSave = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    // 보관함 키의 정본은 `documents/queries.ts` 의 `documentKeys` 다.
    // 예전 코드는 `['cards']`/`['tickets']` 같은 자체 문자열을 무효화했는데, 실제 키는
    // `['documents', <DocumentType>, …]` 라 **어떤 캐시도 매치되지 않았다** — 스캔 저장 직후
    // 보관함에 방금 저장한 문서가 안 보이는 원인이다. 종별 루트를 지우면 목록·상세가 함께 갱신된다.
    if (isSavableDocumentType(docType)) {
      void queryClient.invalidateQueries({ queryKey: documentKeys.ofType(docType) });
    }
    router.replace('/scan/done');
  }, [docType, queryClient, router]);

  const runSave = useCallback(
    async (options?: { allowMissingImage?: boolean }) => {
      setValues(collect());
      const ok = await save(options);
      if (ok) {
        finishSave();
        return;
      }

      const current = useScanStore.getState().failure;
      haptics.error();

      // 커밋 실패(SCF-07/SCF-11)만 다이얼로그로 되묻는다. 나머지는 상단 인라인 배너.
      if (current?.code === 'SCF-11' || current?.code === 'SCF-07') {
        Alert.alert('이미지를 저장하지 못했습니다.', '이미지 없이 저장할까요?', [
          { text: '취소', style: 'cancel' },
          {
            text: '다시 시도',
            onPress: () => {
              void runSave();
            },
          },
          {
            text: '이미지 없이 저장',
            onPress: () => {
              void runSave({ allowMissingImage: true });
            },
          },
        ]);
      }
    },
    [collect, finishSave, save, setValues],
  );

  const submit = handleSubmit(
    async () => {
      await runSave();
    },
    () => {
      // A등급(FLD-06) 게이트. 저장을 막고 첫 오류 필드를 알린다.
      // HAP-03 — 폼 검증 실패는 Warning 이다. 토스트 햅틱(Error)을 끄지 않으면 같은 순간에 2회 울린다.
      haptics.warning();
      toast.error('날짜·시간·금액 형식을 확인해 주세요.', { haptic: false });
    },
  );

  const handleRescan = useCallback(() => {
    haptics.warning();
    Alert.alert('다시 스캔할까요?', '입력한 내용이 사라집니다.', [
      { text: '취소', style: 'cancel' },
      { text: '다시 스캔', style: 'destructive', onPress: leaveToCamera },
    ]);
  }, [leaveToCamera]);

  const rawBlocks = scan?.rawBlocks ?? [];

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-bg-base"
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={0}
    >
      {/* ── 헤더 ─────────────────────────────────────────────────────── */}
      <View
        className="h-14 flex-row items-center border-b border-border-subtle px-2"
        style={{ marginTop: insets.top }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="뒤로"
          onPress={handleBack}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          className="h-11 w-11 items-center justify-center"
        >
          <Text className="text-h2 text-text-primary">‹</Text>
        </Pressable>
        <Text
          className="text-h3 font-w700 text-text-primary"
          accessibilityRole="header"
          maxFontSizeMultiplier={1.3}
        >
          결과 확인
        </Text>
      </View>

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxxl }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        {/* ── 이미지 스트립 (다크에서도 라이트 표면 유지) ──────────────── */}
        {previewUri ? (
          <View
            className="border border-border-subtle"
            style={{
              height: STRIP_HEIGHT,
              borderRadius: radius.card,
              padding: 4, // 사방 4dp 매트
              // 이 컨테이너만 테마를 따르지 않는다 → className 이 아니라 라이트 토큰을 직접 읽는다.
              // HEX 는 여전히 tokens.ts 한 곳에서만 나온다(§13-0).
              backgroundColor: themes.light.surface.base,
              overflow: 'hidden',
            }}
          >
            <Image
              source={{ uri: previewUri }}
              contentFit="contain"
              style={{ width: '100%', height: '100%', borderRadius: radius.md }}
              accessibilityLabel={`${TYPE_LABELS[docType]} 이미지`}
            />
          </View>
        ) : null}

        {/* ── 상태 배너 ────────────────────────────────────────────────── */}
        {failure?.code === 'SCF-10' ? (
          <Banner
            title="이미지에서 글자를 찾지 못했습니다."
            body="더 밝은 곳에서 글자가 선명하게 보이도록 다시 촬영해 주세요."
          />
        ) : noExtractedValues ? (
          <Banner title="인식된 정보가 없습니다." body="직접 입력하거나 다시 촬영해 주세요." />
        ) : null}

        {failure && failure.code !== 'SCF-10' && failureMessage ? (
          <View
            className="mt-3 border border-danger-border bg-danger-container px-4 py-3"
            style={{ borderRadius: radius.card }}
            accessibilityLiveRegion="polite"
          >
            <Text className="text-body-sm font-w700 text-danger">{failureMessage.title}</Text>
            {failureMessage.body ? (
              <Text className="mt-1 text-body-sm text-danger">{failureMessage.body}</Text>
            ) : null}
          </View>
        ) : null}

        {/* ── 문서 유형 + 신뢰도 ───────────────────────────────────────── */}
        <View className="mt-5 flex-row items-center justify-between">
          <Text className="text-caption text-text-muted">문서 유형</Text>
          <Text className="text-caption text-text-disabled">{badge}</Text>
        </View>

        {/* CLS-02 확인 바 / CLS-03 저신뢰 게이트 */}
        {tier === 'confirm' || locked ? (
          <View
            className="mt-2 border border-warn-border bg-warn-container px-4 py-3"
            style={{ borderRadius: radius.card }}
          >
            <Text className="text-body-sm font-w700 text-warn">이 문서가 맞나요?</Text>
            <Text className="mt-1 text-body-sm text-warn">
              {locked
                ? '분류 신뢰도가 낮습니다. 문서 종류를 골라야 편집할 수 있어요.'
                : '분류가 확실하지 않습니다. 다르면 아래에서 종류를 바꿔 주세요.'}
            </Text>
          </View>
        ) : null}

        <SegmentedControl
          options={TYPE_OPTIONS}
          value={docType}
          onChange={handleTypeChange}
          scrollable
          size="md"
          accessibilityLabel="문서 유형 선택"
          style={{ marginTop: spacing.sm }}
        />

        {/* ── 인식 요약 ────────────────────────────────────────────────── */}
        {!blocked ? (
          <View className="mt-4 flex-row items-center gap-2">
            <Chip
              label={`총 ${summary.total}개 중 ${summary.recognized}개 인식됨`}
              tone="neutral"
              size="sm"
              docTone={DOC_TONE[docType]}
            />
            {summary.empty > 0 ? (
              <Chip label={`미입력 ${summary.empty}개`} tone="neutral" size="sm" />
            ) : null}
          </View>
        ) : null}

        {/* ── 동적 폼 ──────────────────────────────────────────────────── */}
        {blocked ? (
          <View className="items-center px-4 py-8">
            {/* 원본 웹 문구 그대로 */}
            <Text className="text-center text-body-sm text-text-muted">
              기타 문서는 아직 필드 스키마가 정의되지 않았습니다.
            </Text>
            <Text className="mt-2 text-center text-body-sm text-text-muted">
              명함·포스터·영수증·티켓 중에서 골라 주세요.
            </Text>
          </View>
        ) : (
          <View
            className="mt-4 gap-4"
            style={locked ? { opacity: 0.45 } : undefined}
            pointerEvents={locked ? 'none' : 'auto'}
          >
            {fieldDefs.map((def) => (
              <Controller
                key={def.key}
                control={control}
                name={def.key}
                rules={{ validate: (value: string) => validateFieldValue(def, value ?? '') ?? true }}
                render={({ field, fieldState }) => (
                  <FieldRow
                    def={def}
                    value={field.value ?? ''}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                    error={fieldState.error?.message}
                  />
                )}
              />
            ))}
          </View>
        )}

        {/* ── OCR 원문 접힘 섹션 ───────────────────────────────────────── */}
        {rawBlocks.length > 0 ? (
          <View className="mt-6">
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`OCR 원문 ${rawBlocks.length}개`}
              accessibilityState={{ expanded: rawOpen }}
              onPress={() => setRawOpen((prev) => !prev)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              className="h-11 flex-row items-center gap-2"
            >
              <Text className="text-body-sm text-text-muted">{rawOpen ? '▾' : '▸'}</Text>
              <Text className="text-body-sm font-w700 text-text-secondary">
                {`OCR 원문 ${rawBlocks.length}개`}
              </Text>
            </Pressable>

            {rawOpen ? (
              <View className="mt-2 flex-row flex-wrap gap-2">
                {rawBlocks.map((block) => (
                  <Chip
                    key={`${block.block_index}-${block.text}`}
                    label={block.text.length > 24 ? `${block.text.slice(0, 24)}…` : block.text}
                    tone="neutral"
                    size="sm"
                  />
                ))}
              </View>
            ) : null}
          </View>
        ) : null}

        {/* ── 소프트 경고 (저장을 막지 않는다 — §10-3) ────────────────────── */}
        {!blocked && softWarning ? (
          <Text className="mt-5 text-body-sm text-warn" accessibilityLiveRegion="polite">
            {softWarning}
          </Text>
        ) : null}
      </ScrollView>

      {/* ── 하단 고정 액션바 ────────────────────────────────────────────── */}
      <View
        className="flex-row gap-3 border-t border-border-subtle bg-bg-base px-4 pt-3"
        style={{ paddingBottom: insets.bottom + spacing.md }}
      >
        <Button
          label="다시 스캔"
          onPress={handleRescan}
          variant="secondary"
          size="lg"
          haptic="selection"
          style={{ flex: 1 }}
        />
        <Button
          label="확인 & 저장"
          loadingLabel="저장 중..."
          loading={saving}
          disabled={!canSaveNow}
          onPress={() => {
            void submit();
          }}
          variant="primary"
          size="lg"
          style={{ flex: 1.4 }}
        />
      </View>
    </KeyboardAvoidingView>
  );
}

/* ── 배너 (warn 토큰) ────────────────────────────────────────────────────── */

function Banner({ title, body }: { title: string; body: string }) {
  return (
    <View
      className="mt-3 border border-warn-border bg-warn-container px-4 py-3"
      style={{ borderRadius: radius.card }}
      accessible
      accessibilityLabel={`${title} ${body}`}
    >
      <Text className="text-body-sm font-w700 text-warn">{title}</Text>
      <Text className="mt-1 text-body-sm text-warn">{body}</Text>
    </View>
  );
}

/* ── 필드 1개 ────────────────────────────────────────────────────────────── */

function FieldRow({
  def,
  value,
  onChange,
  onBlur,
  error,
}: {
  def: FieldDef;
  value: string;
  onChange: (next: string) => void;
  onBlur: () => void;
  error?: string;
}) {
  const empty = value.trim() === '';
  const warning = error ? undefined : (warnFieldValue(def, value) ?? undefined);

  /**
   * §10-4 정규화 보조 규칙 — 포커스가 빠질 때 `2026.05.16` / `05.16` 을 ISO 로 옮겨 준다.
   * **실패하면 값을 지우지 않는다**(원문 보존 우선). 형식이 끝내 안 맞으면 A등급 검증이 잡는다.
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

  // 네이티브 Date/Time 피커 패키지가 없어(설치 금지) 형식 힌트 + 블러 시 자동 정규화로 대체한다.
  const hint =
    warning ?? (def.inputType === 'date' ? 'YYYY-MM-DD' : def.inputType === 'time' ? 'HH:MM' : undefined);

  return (
    <View>
      <View className="mb-1.5 flex-row items-center gap-1.5">
        {/* 미인식 필드 표식 (§10-3) — 색만으로 알리지 않도록 placeholder 문구가 병행된다 */}
        {empty ? <View className="h-1 w-1 rounded-full bg-text-disabled" /> : null}
        <Text className="text-label font-w600 text-text-secondary">{def.label}</Text>
        {!def.persisted ? (
          <View className="rounded-full bg-surface-alt px-1.5 py-0.5">
            <Text className="text-micro font-w600 text-text-muted" maxFontSizeMultiplier={1.2}>
              저장 안 됨
            </Text>
          </View>
        ) : null}
      </View>

      {/* select 프리셋은 칩으로 1탭, 자유 입력도 함께 허용한다 (§10-2 ChipSelect + 직접입력) */}
      {def.inputType === 'select' && def.options ? (
        <View className="mb-2 flex-row flex-wrap gap-2">
          {def.options.map((option) => (
            <Chip
              key={option}
              label={option}
              selected={value === option}
              tone="neutral"
              size="sm"
              onPress={() => onChange(value === option ? '' : option)}
            />
          ))}
        </View>
      ) : null}

      <TextField
        value={value}
        onChangeText={onChange}
        onBlur={handleBlur}
        placeholder={def.placeholder}
        keyboardType={def.keyboardType}
        multiline={def.inputType === 'multiline'}
        numberOfLines={def.rows ?? 3}
        {...(def.maxLength !== undefined ? { maxLength: def.maxLength } : {})}
        {...(def.autoCapitalize ? { autoCapitalize: def.autoCapitalize } : {})}
        {...(error ? { error } : {})}
        {...(hint ? { hint } : {})}
        clearable={def.inputType !== 'multiline'}
        testID={`scan-field-${def.key}`}
      />
    </View>
  );
}
