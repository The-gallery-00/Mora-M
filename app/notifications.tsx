// app/notifications.tsx
//
// SCR-08 알림 목록 — **원본 웹에 존재하지 않던 화면이다.**
//
// 웹은 `dashboard/layout.tsx` 에 벨 버튼만 있고 `onClick` 이 없다. `lib/api.ts` 에 함수 5개가
// 완비돼 있는데 어떤 `.tsx` 도 import 하지 않는다. 반면 백엔드는 `DeadlineNotificationScheduler`
// (매일 09:00 KST)가 이미 돌며 알림 row 를 쌓고 있다 — **소비 UI 가 없어 기능이 통째로 사장돼
// 있었다.** 모바일에서 완성한다 (SCR-08 신설 근거 1).
//
// ── 이 화면이 지키는 서버 사실 3가지 ───────────────────────────────────────────
//  1. `linkUrl` 은 **웹 경로**(`/dashboard/storage/posters`)라 앱에서 그대로 못 쓴다.
//     `toAppRoute()` 가 보관함 라우트로 매핑한다. `sourceType`/`sourceId` 는 DTO 에 없어서
//     문서 상세까지는 못 열고 목록까지만 보낸다 (SCR-08 신설 근거 2).
//  2. 서버가 `…남았습니다입니다.` 를 **DB 에 그대로 저장한다**(`formatDDay()` 이중 어미).
//     정규화는 데이터 계층(`toNotification`)과 표시 계층(`NotificationItem`) 두 곳에서 건다 —
//     낙관적 갱신으로 만든 임시 객체가 어댑터를 우회하는 경로가 있기 때문이다. 멱등 함수다.
//  3. Page 는 평면이고 종료 판정은 `last` 플래그만 본다(`useInfiniteNotifications` 가 처리).
//
// **라우트 표현(presentation)을 이 파일에서 바꾸지 않는다.** SCR-08 정본은 `스택 push` 이고,
// 루트 `app/_layout.tsx` 는 셸 담당 소유다. 모달로 띄우려면 그쪽에
// `<Stack.Screen name="notifications" options={{ presentation: 'modal' }} />` 한 줄을 더하면 된다
// (여기서 `navigation.setOptions` 로 뒤늦게 바꾸면 카드로 떴다가 모달로 변하는 깜빡임이 생긴다).
import { FlashList, type ListRenderItemInfo } from '@shopify/flash-list';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Path } from 'react-native-svg';

import { NotificationItem } from '@/components/dashboard';
import { Button, EmptyState, IconButton, Skeleton, toast } from '@/components/ui';
import { ArchiveHeader, href } from '@/features/documents/ArchiveList';
import {
  markAllReadMessage,
  NOTIFICATION_COPY,
  notificationKeys,
  toAppRoute,
  useDeleteNotification,
  useInfiniteNotifications,
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  type Notification,
} from '@/features/notifications';
import { haptics } from '@/lib/haptics';
import { useTheme } from '@/theme/ThemeProvider';
import { spacing } from '@/theme/scale';

/** 행 높이가 2줄 본문 기준 88dp 근처다 — 화면 밖 3행 분량을 미리 그린다(FlashList v2 `drawDistance`). */
const DRAW_DISTANCE = 260;

function MoreVerticalIcon({ color }: { color?: string }) {
  return (
    <Svg width={24} height={24} viewBox="0 0 24 24" fill="none">
      <Circle cx={12} cy={5} r={1.75} fill={color} />
      <Circle cx={12} cy={12} r={1.75} fill={color} />
      <Circle cx={12} cy={19} r={1.75} fill={color} />
    </Svg>
  );
}

function TrashIcon({ color }: { color: string }) {
  return (
    <Svg
      width={22}
      height={22}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <Path d="M3 6h18" />
      <Path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <Path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <Path d="M10 11v6" />
      <Path d="M14 11v6" />
    </Svg>
  );
}

function CheckIcon({ color }: { color: string }) {
  return (
    <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
      <Path
        d="M6 12l4 4 8-8"
        stroke={color}
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

interface NotificationMoreMenuProps {
  visible: boolean;
  top: number;
  canReadAll: boolean;
  canSelectForDelete: boolean;
  onReadAll: () => void;
  onSelectForDelete: () => void;
  onClose: () => void;
}

function NotificationMoreMenu({
  visible,
  top,
  canReadAll,
  canSelectForDelete,
  onReadAll,
  onSelectForDelete,
  onClose,
}: NotificationMoreMenuProps) {
  const t = useTheme();

  if (!visible) return null;

  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <View className="flex-1">
        <Pressable
          style={StyleSheet.absoluteFill}
          accessibilityRole="button"
          accessibilityLabel="더보기 메뉴 닫기"
          onPress={onClose}
          testID="notifications-more-backdrop"
        />

        <View
          className="absolute right-2 w-[216px] overflow-hidden rounded-md border border-border-subtle bg-bg-elevated py-1"
          style={[{ top }, t.elevation.dropdown]}
          accessibilityViewIsModal
          testID="notifications-more-menu"
        >
          <Pressable
            accessibilityRole="menuitem"
            accessibilityLabel="삭제"
            accessibilityState={{ disabled: !canSelectForDelete }}
            disabled={!canSelectForDelete}
            onPress={() => {
              onClose();
              onSelectForDelete();
            }}
            className="h-12 justify-center px-4"
            style={({ pressed }) => (pressed ? { opacity: 0.65 } : null)}
            testID="notifications-select-delete"
          >
            <Text
              className={`text-body-sm font-w600 ${canSelectForDelete ? 'text-text-primary' : 'text-text-disabled'}`}
              maxFontSizeMultiplier={1.3}
            >
              삭제
            </Text>
          </Pressable>

          <View className="mx-4 h-px bg-bg-sunken" />

          <Pressable
            accessibilityRole="menuitem"
            accessibilityLabel={NOTIFICATION_COPY.markAllAction}
            accessibilityState={{ disabled: !canReadAll }}
            disabled={!canReadAll}
            onPress={() => {
              onClose();
              onReadAll();
            }}
            className="h-12 justify-center px-4"
            style={({ pressed }) => (pressed ? { opacity: 0.65 } : null)}
            testID="notifications-read-all"
          >
            <Text
              className={`text-body-sm font-w600 ${canReadAll ? 'text-text-primary' : 'text-text-disabled'}`}
              maxFontSizeMultiplier={1.3}
            >
              {NOTIFICATION_COPY.markAllAction}
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

/* ── 초기 스켈레톤 5행 (SCR-08 상태 표) ─────────────────────────────── */

function NotificationSkeleton() {
  return (
    <View className="gap-px bg-bg-sunken">
      {[0, 1, 2, 3, 4].map((i) => (
        <View key={i} className="gap-2 bg-bg-elevated px-4 py-3">
          <Skeleton width="40%" height={14} radius={4} />
          <Skeleton width="85%" height={12} radius={4} />
        </View>
      ))}
    </View>
  );
}

/* ── 화면 ───────────────────────────────────────────────────────────── */

export default function NotificationsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const t = useTheme();
  const queryClient = useQueryClient();
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [deletingSelected, setDeletingSelected] = useState(false);

  const list = useInfiniteNotifications();
  const markRead = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead();
  const remove = useDeleteNotification();

  const { notifications, hasUnread, isEmpty } = list;

  const enterSelectionMode = useCallback(() => {
    setSelectionMode(true);
    setSelectedIds(new Set());
  }, []);

  const closeSelectionMode = useCallback(() => {
    setSelectionMode(false);
    setSelectedIds(new Set());
  }, []);

  const toggleSelection = useCallback((id: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    setSelectedIds((current) => {
      const allSelected =
        notifications.length > 0 && notifications.every((item) => current.has(item.id));
      return allSelected ? new Set() : new Set(notifications.map((item) => item.id));
    });
  }, [notifications]);

  const deleteSelected = useCallback(async () => {
    if (selectedIds.size === 0 || deletingSelected) return;

    const ids = [...selectedIds];
    const byId = new Map(notifications.map((item) => [item.id, item]));
    let deletedCount = 0;
    let firstError = '';

    setDeletingSelected(true);
    try {
      for (const id of ids) {
        try {
          const item = byId.get(id);
          await remove.mutateAsync({ id, wasUnread: item ? !item.read : false });
          deletedCount += 1;
          setSelectedIds((current) => {
            const next = new Set(current);
            next.delete(id);
            return next;
          });
        } catch (error) {
          if (!firstError) {
            firstError = error instanceof Error ? error.message : NOTIFICATION_COPY.deleteFailed;
          }
        }
      }
    } finally {
      setDeletingSelected(false);
    }

    if (deletedCount === ids.length) {
      toast.success(`알림 ${deletedCount}건을 삭제했습니다.`);
      closeSelectionMode();
    } else if (deletedCount > 0) {
      toast.error(`알림 ${deletedCount}건을 삭제했고 ${ids.length - deletedCount}건은 실패했습니다.`);
    } else {
      toast.error(firstError || NOTIFICATION_COPY.deleteFailed);
    }
  }, [closeSelectionMode, deletingSelected, notifications, remove, selectedIds]);

  /* 행 탭: ① 읽음 낙관적 갱신 ② linkUrl 매핑 라우트로 이동.
     **`await` 하지 않는다** — SCR-08 인터랙션 표가 "읽음 실패해도 이동은 진행, 배지 롤백" 이라고
     못박았다. 롤백은 뮤테이션 훅이 스냅샷으로 처리한다. */
  const openNotification = useCallback(
    (item: Notification) => {
      markRead.mutate({ id: item.id, alreadyRead: item.read });
      router.push(href(toAppRoute(item.linkUrl)));
    },
    [markRead, router],
  );

  const readAll = useCallback(() => {
    // `모두 읽음` 은 §9 표에 없는 일반 버튼이다 — 피드백은 결과 토스트가 준다.
    markAll.mutate(undefined, {
      onSuccess: (count) => toast.success(markAllReadMessage(count)),
      onError: (error) => toast.error(error.message),
    });
  }, [markAll]);

  const refresh = useCallback(() => {
    haptics.impact('light'); // HAP-05 — pull-to-refresh 임계 도달
    void list.refetch();
    // 배지는 별도 키다(`['notif','unread']`) — 목록 새로고침이 자동으로 갱신해 주지 않는다.
    void queryClient.invalidateQueries({ queryKey: notificationKeys.unread() });
  }, [list, queryClient]);

  const loadMore = useCallback(() => {
    if (list.hasNextPage && !list.isFetchingNextPage) void list.fetchNextPage();
  }, [list]);

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<Notification>) => (
      <NotificationItem
        id={item.id}
        type={item.type}
        title={item.title}
        message={item.message}
        createdAt={item.createdAt}
        read={item.read}
        selectionMode={selectionMode}
        selected={selectedIds.has(item.id)}
        onPress={() =>
          selectionMode ? toggleSelection(item.id) : openNotification(item)
        }
        testID={`notification-${item.id}`}
      />
    ),
    [openNotification, selectedIds, selectionMode, toggleSelection],
  );

  const canReadAll = hasUnread && !markAll.isPending;
  const canSelectForDelete = notifications.length > 0;
  const allSelected =
    notifications.length > 0 && notifications.every((item) => selectedIds.has(item.id));

  return (
    <View className="flex-1 bg-bg-base">
      <ArchiveHeader
        title={
          selectionMode
            ? selectedIds.size === 0
              ? '알림 선택'
              : `${selectedIds.size}개 선택`
            : NOTIFICATION_COPY.screenTitle
        }
        onBack={() => {
          if (selectionMode) closeSelectionMode();
          else router.back();
        }}
        trailing={
          selectionMode ? (
            <Button
              label="전체"
              onPress={toggleSelectAll}
              variant="ghost"
              size="sm"
              haptic="selection"
              trailingIcon={allSelected ? <CheckIcon color={t.action.base} /> : undefined}
              testID="notifications-selection-all"
            />
          ) : (
            <IconButton
              icon={<MoreVerticalIcon />}
              accessibilityLabel="더보기"
              onPress={() => setMoreMenuOpen(true)}
              size="sm"
              testID="notifications-more"
            />
          )
        }
        testID="notifications-header"
      />

      <NotificationMoreMenu
        visible={moreMenuOpen}
        top={insets.top + 48}
        canReadAll={canReadAll}
        canSelectForDelete={canSelectForDelete}
        onReadAll={readAll}
        onSelectForDelete={enterSelectionMode}
        onClose={() => setMoreMenuOpen(false)}
      />

      {list.isPending ? (
        <NotificationSkeleton />
      ) : list.isError && notifications.length === 0 ? (
        /* 캐시가 아예 없을 때만 에러 카드로 목록 자리를 덮는다. */
        <View
          className="m-4 items-center gap-3 rounded-card border border-danger-border bg-danger-container p-5"
          accessibilityLiveRegion="polite"
        >
          <Text className="text-center text-base font-w600 text-danger" maxFontSizeMultiplier={1.3}>
            {list.error?.message ?? NOTIFICATION_COPY.listFailed}
          </Text>
          <Button
            label={NOTIFICATION_COPY.retry}
            onPress={() => void list.refetch()}
            variant="secondary"
            size="sm"
          />
        </View>
      ) : isEmpty ? (
        <EmptyState
          title={NOTIFICATION_COPY.emptyTitle}
          description={NOTIFICATION_COPY.emptyCaption}
          hideIcon
          testID="notifications-empty"
        />
      ) : (
        <FlashList
          data={notifications}
          extraData={selectedIds}
          renderItem={renderItem}
          keyExtractor={(item) => item.id}
          drawDistance={DRAW_DISTANCE}
          onEndReached={loadMore}
          onEndReachedThreshold={0.5}
          /* `isRefetching` 은 다음 페이지 로딩 중에도 참이다 — 그대로 넘기면 무한 스크롤마다
             상단 스피너가 함께 돈다(보관함 계층과 같은 처리). */
          refreshing={list.isRefetching && !list.isFetchingNextPage}
          onRefresh={refresh}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{
            paddingBottom: selectionMode && selectedIds.size > 0
              ? insets.bottom + 56 + spacing.md + spacing.sm + spacing.xxl
              : insets.bottom + spacing.xxl,
          }}
          ItemSeparatorComponent={() => <View className="h-px bg-bg-sunken" />}
          ListFooterComponent={
            list.isFetchingNextPage ? (
              <View className="items-center py-4">
                <ActivityIndicator size="small" color={t.action.base} />
              </View>
            ) : (
              <View style={{ height: spacing.sm }} />
            )
          }
        />
      )}

      {selectionMode && selectedIds.size > 0 ? (
        <View
          className="absolute inset-x-0 bottom-0 z-20 border-t border-border-subtle bg-bg-elevated px-4 pt-3"
          style={[{ paddingBottom: insets.bottom + spacing.sm }, t.elevation.raised]}
          testID="notifications-selection-actions"
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`선택한 알림 ${selectedIds.size}개 삭제`}
            accessibilityState={{
              disabled: selectedIds.size === 0 || deletingSelected,
              busy: deletingSelected,
            }}
            disabled={selectedIds.size === 0 || deletingSelected}
            onPress={() => {
              haptics.impact('medium');
              void deleteSelected();
            }}
            className="h-14 items-center justify-center gap-0.5"
            style={({ pressed }) => (pressed ? { opacity: 0.65 } : null)}
            testID="notifications-delete-selected"
          >
            {deletingSelected ? (
              <ActivityIndicator size="small" color={t.text.primary} />
            ) : (
              <TrashIcon
                color={selectedIds.size === 0 ? t.text.disabled : t.text.primary}
              />
            )}
            <Text
              className={`text-body-sm ${
                selectedIds.size === 0 ? 'text-text-disabled' : 'text-text-primary'
              }`}
              maxFontSizeMultiplier={1.3}
            >
              {deletingSelected ? '삭제 중...' : '삭제'}
            </Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}
