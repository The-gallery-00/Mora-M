// app/groups.tsx
//
// SCR-22 명함첩(그룹) 관리 — 목록 · 생성 · 이름 변경 · 삭제.
//
// 원본은 명함 화면 좌측 220px 사이드바 안의 카드였고, 상호작용이 전부 브라우저 전역 함수였다:
// `window.prompt('새 그룹명을 입력하세요.')`, `window.confirm(...)`, `window.alert(...)` ×3.
// RN 에는 prompt 가 없으므로 **입력 바텀시트 + 확인 다이얼로그 + 토스트**로 옮긴다(UX-15).
//
// **이름 변경(API-22)은 이 화면이 최초 소비자다.** 서버에 엔드포인트가 있는데 원본 프론트에는
// 래퍼 함수조차 없었다.
//
// 개수(`전체 명함 12`)를 표시하지 않는 이유 — 서버에 그룹별 집계 엔드포인트가 없다. 개수를
// 채우려면 그룹 수만큼 목록 요청을 보내야 하는데(N+1), Hikari pool 이 3인 서버에 명함첩 화면을
// 여는 것만으로 요청 폭탄을 던지게 된다. 숫자를 지어내는 것보다 안 보여 주는 편이 정직하다.
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';

import { SwipeableRow, type SwipeAction } from '@/components/documents';
import { Button, EmptyState, IconButton, Skeleton, TextField, toast } from '@/components/ui';
import {
  CARD_GROUP_COPY,
  CARD_GROUP_FIXED_LABELS,
  CARD_GROUP_NAME_MAX,
  useCardGroups,
  useCreateCardGroup,
  useDeleteCardGroup,
  useRenameCardGroup,
  type CardGroup,
  type Uuid,
} from '@/features/documents';
import { ArchiveHeader, href } from '@/features/documents/ArchiveList';
import { useTheme } from '@/theme/ThemeProvider';
import { spacing } from '@/theme/scale';

/**
 * 입력 상한. DB 컬럼과 서버 검증은 60자지만(`CARD_GROUP_NAME_MAX`), 화면 스펙(SCR-22 입력 시트)은
 * `maxLength 20` / 캡션 `최대 20자` 다. 칩 레일에서 20자를 넘는 이름은 어차피 잘린다.
 * 서버 상한과 어긋나지 않도록 둘 중 작은 값을 쓴다.
 */
const NAME_MAX = Math.min(20, CARD_GROUP_NAME_MAX);

/** SCR-22 상태 표 문구. 서버 문장을 그대로 쓰지 않는다(API Contract §4-5). */
const COMPOSE_COPY = {
  createTitle: '명함첩 추가',
  renameTitle: '명함첩 이름 변경',
  placeholder: '명함첩 이름',
  hint: `최대 ${NAME_MAX}자`,
  createSubmit: '추가',
  renameSubmit: '변경',
  cancel: '취소',
  emptyName: '이름을 입력해 주세요.',
  duplicated: '같은 이름의 명함첩이 이미 있습니다.',
  created: '명함첩을 만들었습니다.',
} as const;

/* ── 아이콘 ─────────────────────────────────────────────────────────────── */

function PlusIcon({ color }: { color: string }) {
  return (
    <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
      <Path d="M12 5V19M5 12H19" stroke={color} strokeWidth={2.2} strokeLinecap="round" />
    </Svg>
  );
}

function ChevronIcon({ color }: { color: string }) {
  return (
    <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
      <Path
        d="M9 5L16 12L9 19"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/* ── 행 ─────────────────────────────────────────────────────────────────── */

function GroupRow({
  name,
  fixed = false,
  onPress,
  swipeActions,
  testID,
}: {
  name: string;
  /** 고정 항목(전체 명함 / 미분류)은 편집·삭제할 수 없다. */
  fixed?: boolean;
  onPress: () => void;
  swipeActions?: SwipeAction[];
  testID?: string;
}) {
  const t = useTheme();

  const row = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={name}
      onPress={onPress}
      className="h-14 flex-row items-center gap-3 bg-bg-elevated px-4"
      style={({ pressed }) => (pressed ? { opacity: 0.9 } : null)}
      testID={testID}
    >
      <Text
        className={`flex-1 text-input ${fixed ? 'font-w500 text-text-muted' : 'font-w600 text-text-primary'}`}
        numberOfLines={1}
        maxFontSizeMultiplier={1.3}
      >
        {name}
      </Text>
      <ChevronIcon color={t.text.disabled} />
    </Pressable>
  );

  if (!swipeActions || swipeActions.length === 0) return row;
  return <SwipeableRow rightActions={swipeActions}>{row}</SwipeableRow>;
}

/* ── 입력 시트 ──────────────────────────────────────────────────────────── */

type ComposeState =
  | { mode: 'create' }
  | { mode: 'rename'; id: Uuid; original: string };

function ComposeSheet({
  state,
  busy,
  error,
  onSubmit,
  onClose,
}: {
  state: ComposeState | null;
  busy: boolean;
  error: string | null;
  onSubmit: (name: string) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const t = useTheme();
  const inputRef = useRef<TextInput>(null);
  /* 초기값은 마운트 때 한 번만 잡는다. 시트를 열 때마다 값을 비우는 일은 이펙트로 하지 않고
     호출부가 `key` 로 이 컴포넌트를 리마운트시켜 해결한다(이펙트 setState 를 만들지 않는다). */
  const [name, setName] = useState(() => (state?.mode === 'rename' ? state.original : ''));

  // SCR-22 입력 시트 `autoFocus` — Modal 이 화면에 올라온 뒤에 포커스해야 키보드가 뜬다.
  useEffect(() => {
    if (!state) return undefined;
    const timer = setTimeout(() => inputRef.current?.focus(), 120);
    return () => clearTimeout(timer);
  }, [state]);

  if (!state) return null;

  const isRename = state.mode === 'rename';

  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <Pressable
          className="flex-1 justify-end"
          style={{ backgroundColor: t.scrim }}
          accessibilityRole="button"
          accessibilityLabel="닫기"
          onPress={onClose}
        >
          <Pressable
            className="gap-3 rounded-t-sheet bg-bg-elevated px-5 pt-4"
            style={{ paddingBottom: insets.bottom + spacing.lg }}
            onPress={() => undefined}
          >
            {/* 시트 핸들 — 제스처는 없지만 "아래에서 올라온 면"이라는 신호를 준다 */}
            <View className="items-center">
              <View className="h-1 w-9 rounded-full bg-border-subtle" />
            </View>

            <Text className="text-h3 font-w700 text-text-primary" accessibilityRole="header">
              {isRename ? COMPOSE_COPY.renameTitle : COMPOSE_COPY.createTitle}
            </Text>

            <TextField
              ref={inputRef}
              value={name}
              onChangeText={setName}
              placeholder={COMPOSE_COPY.placeholder}
              maxLength={NAME_MAX}
              returnKeyType="done"
              onSubmitEditing={() => onSubmit(name)}
              hint={COMPOSE_COPY.hint}
              {...(error ? { error } : {})}
              testID="group-name-input"
            />

            <View className="flex-row gap-2">
              <View className="flex-1">
                <Button
                  label={COMPOSE_COPY.cancel}
                  onPress={onClose}
                  variant="secondary"
                  size="md"
                  fullWidth
                />
              </View>
              <View className="flex-[2]">
                <Button
                  label={isRename ? COMPOSE_COPY.renameSubmit : COMPOSE_COPY.createSubmit}
                  onPress={() => onSubmit(name)}
                  loading={busy}
                  disabled={busy}
                  size="md"
                  fullWidth
                  testID="group-name-submit"
                />
              </View>
            </View>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/* ── 화면 ───────────────────────────────────────────────────────────────── */

export default function GroupsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ compose?: string }>();

  const groupsQuery = useCardGroups();
  const createMutation = useCreateCardGroup();
  const renameMutation = useRenameCardGroup();
  const deleteMutation = useDeleteCardGroup();

  /* SCR-15 그룹 레일의 `+ 명함첩 추가` 칩이 `?compose=1` 로 들어온다.
     이 화면은 스택 push 라 진입 때마다 새로 마운트되므로 **초기값으로 읽으면 충분**하다 —
     이펙트로 열면 시트 없는 화면이 한 프레임 먼저 보인다. */
  const [compose, setCompose] = useState<ComposeState | null>(() =>
    params.compose === '1' ? { mode: 'create' } : null,
  );
  const [composeError, setComposeError] = useState<string | null>(null);

  const groups = groupsQuery.data ?? [];

  /** 명함 목록으로 되돌아가면서 해당 그룹 필터를 적용한다 (SCR-22 행 탭). */
  const openGroup = (id: string) => {
    router.navigate(href(`/archive/cards?groupId=${encodeURIComponent(id)}`));
  };

  const closeCompose = () => {
    setCompose(null);
    setComposeError(null);
  };

  const submitCompose = (raw: string) => {
    const name = raw.trim();
    if (!compose) return;
    if (!name) {
      setComposeError(COMPOSE_COPY.emptyName);
      return;
    }
    // 서버도 `UNIQUE(user_id, name)` 으로 막지만(400), 왕복 없이 즉시 알려 주는 편이 낫다.
    const duplicated = groups.some(
      (group) =>
        group.name.trim() === name && (compose.mode === 'create' || group.id !== compose.id),
    );
    if (duplicated) {
      setComposeError(COMPOSE_COPY.duplicated);
      return;
    }
    setComposeError(null);

    if (compose.mode === 'create') {
      createMutation.mutate(name, {
        onSuccess: () => {
          closeCompose();
          toast.success(COMPOSE_COPY.created);
        },
        // 추가 실패는 시트를 닫지 않고 하단 캡션으로 알린다(입력값을 잃지 않게).
        onError: (error) => setComposeError(error.message),
      });
      return;
    }

    renameMutation.mutate(
      { id: compose.id, name },
      {
        onSuccess: () => closeCompose(),
        onError: (error) => setComposeError(error.message),
      },
    );
  };

  const confirmDelete = (group: CardGroup) => {
    // 원본 `window.confirm` 문구를 그대로 옮긴 것(`\n` → 본문 2줄).
    Alert.alert(`"${group.name}" 그룹을 삭제할까요?`, '그룹 안의 명함은 미분류로 이동됩니다.', [
      { text: '취소', style: 'cancel' },
      {
        text: '삭제',
        style: 'destructive',
        onPress: () => {
          deleteMutation.mutate(group.id, {
            onSuccess: () => toast.success(CARD_GROUP_COPY.deleted),
            onError: (error) => toast.error(error.message),
          });
        },
      },
    ]);
  };

  const swipeActionsFor = (group: CardGroup): SwipeAction[] => [
    {
      label: '이름 변경',
      tone: 'neutral',
      onPress: () => setCompose({ mode: 'rename', id: group.id, original: group.name }),
    },
    { label: '삭제', tone: 'danger', onPress: () => confirmDelete(group) },
  ];

  const t = useTheme();

  return (
    <View className="flex-1 bg-bg-base">
      <ArchiveHeader
        title="명함첩 관리"
        onBack={() => router.back()}
        trailing={
          <IconButton
            icon={<PlusIcon color={t.text.primary} />}
            onPress={() => setCompose({ mode: 'create' })}
            size="md"
            accessibilityLabel="명함첩 추가"
            testID="group-add"
          />
        }
        testID="groups-header"
      />

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xxl }}
        showsVerticalScrollIndicator={false}
      >
        {/* ── 고정 항목 2개. 편집·삭제할 수 없고 탭하면 그 필터로 명함 목록을 연다 ── */}
        <View className="mt-3 overflow-hidden border-y border-bg-sunken">
          <GroupRow
            name={CARD_GROUP_FIXED_LABELS.all}
            fixed
            onPress={() => openGroup('all')}
            testID="group-row-all"
          />
          <View className="h-px bg-bg-sunken" />
          <GroupRow
            name={CARD_GROUP_FIXED_LABELS.ungrouped}
            fixed
            onPress={() => openGroup('ungrouped')}
            testID="group-row-ungrouped"
          />
        </View>

        <Text className="px-4 pb-2 pt-6 text-body-sm font-w700 text-text-secondary">
          내 명함첩
        </Text>

        {groupsQuery.isLoading ? (
          <View className="gap-px border-y border-bg-sunken bg-bg-elevated">
            {[0, 1, 2].map((i) => (
              <View key={i} className="h-14 justify-center px-4">
                <Skeleton width="45%" height={16} radius={4} />
              </View>
            ))}
          </View>
        ) : groupsQuery.isError ? (
          <View
            className="m-4 items-center gap-3 rounded-card border border-danger-border bg-danger-container p-5"
            accessibilityLiveRegion="polite"
          >
            <Text className="text-center text-base font-w600 text-danger">
              {groupsQuery.error.message}
            </Text>
            <Button
              label="다시 시도"
              onPress={() => void groupsQuery.refetch()}
              variant="secondary"
              size="sm"
            />
          </View>
        ) : groups.length === 0 ? (
          <EmptyState
            compact
            title="명함첩이 없습니다."
            description="명함첩을 만들어 명함을 분류해 보세요."
          />
        ) : (
          <View className="border-y border-bg-sunken">
            {groups.map((group, index) => (
              <View key={group.id}>
                {index > 0 ? <View className="h-px bg-bg-sunken" /> : null}
                <GroupRow
                  name={group.name}
                  onPress={() => openGroup(group.id)}
                  swipeActions={swipeActionsFor(group)}
                  testID={`group-row-${group.id}`}
                />
              </View>
            ))}
          </View>
        )}

        <View className="px-4 pt-6">
          <Button
            label="+ 명함첩 추가"
            onPress={() => setCompose({ mode: 'create' })}
            variant="ghost"
            size="lg"
            fullWidth
            testID="group-add-cta"
          />
        </View>
      </ScrollView>

      <ComposeSheet
        // 시트를 열 때마다 입력값을 초기화하는 장치 — 모드/대상이 바뀌면 리마운트된다.
        key={compose === null ? 'closed' : compose.mode === 'rename' ? compose.id : 'create'}
        state={compose}
        busy={createMutation.isPending || renameMutation.isPending}
        error={composeError}
        onSubmit={submitCompose}
        onClose={closeCompose}
      />
    </View>
  );
}
