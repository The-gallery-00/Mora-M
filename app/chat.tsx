// app/chat.tsx — SCR-24 · 챗봇 (모라냥 AI)
//
// 정본: wiki/design/Screen Specs.md SCR-24 (와이어프레임 · 문구 전량 · 상태표 · 인터랙션표)
//       wiki/design/Component Library.md CMP-38/39/40/22
//       wiki/tech/API Contract.md §3-6 (3홉 · 타임아웃 60초 · **취소 버튼 필수**)
//       wiki/product/Requirements.md FR-076~FR-080
//
// ── 원본(897줄 `ChatbotWidget.tsx`)에서 버린 것 ────────────────────────────────
// 368×580 드래그 플로팅 패널 / clampPosition / resize 리스너 / hover 툴팁 / TOP 버튼.
// 화면 폭이 곧 패널 폭이라 드래그의 존재 이유가 없다. **문구·색·말풍선 형상은 100% 보존**한다.
//
// ── 라우트 옵션을 `<Stack.Screen>` 으로 거는 이유 ────────────────────────────
// 루트 `app/_layout.tsx` 는 담당 범위 밖이고 `headerShown:false` 만 걸려 있다. `presentation:'modal'`
// 은 이 화면 자신이 선언한다 (`app/doc/[type]/[id].tsx` 가 쓰는 것과 같은 패턴).
//
// ── 대화 상태는 zustand 메모리 스토어다 ──────────────────────────────────────
// 서버에 대화 저장이 없다(조회 엔드포인트도 세션 개념도 없다). 그래서 React Query 를 쓰지 않고,
// **모달을 닫아도 대화가 남는다**(SCR-24 인터랙션표 `✕` — "대화는 메모리에 유지"). 앱 종료 시 소멸.
import NetInfo from '@react-native-community/netinfo';
import { FlashList, type FlashListRef, type ListRenderItemInfo } from '@shopify/flash-list';
import * as Clipboard from 'expo-clipboard';
import { Stack, useRouter, type Href } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Path } from 'react-native-svg';

import {
  ChatBubble,
  ChatComposer,
  SourceCard,
  TypingBubble,
} from '@/components/search';
import { Button, IconButton, toast } from '@/components/ui';
import {
  CHAT_COPY,
  canSendChat,
  useChatStore,
  type ChatMessage,
} from '@/features/chat';
import { DOC_ROUTE_SEGMENT, type DocumentSummary } from '@/features/documents';
import { haptics } from '@/lib/haptics';
import { useTheme } from '@/theme/ThemeProvider';
import { spacing } from '@/theme/scale';

/** 헤더 h58 (SCR-24 와이어프레임). */
const HEADER_HEIGHT = 58;

/** typedRoutes 우회 — 세그먼트를 런타임에 조립한다(`ArchiveList.tsx` 의 같은 헬퍼와 동일). */
const href = (path: string): Href => path as Href;

/* ── 헤더 아이콘 (lucide 미설치 — 같은 실루엣으로 그린다) ───────────────────── */

function HelpIcon({ color }: { color: string }) {
  return (
    <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
      <Circle cx={12} cy={12} r={9} stroke={color} strokeWidth={1.8} />
      <Path
        d="M9.6 9.3A2.5 2.5 0 1 1 12 12.4V14"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
      />
      <Circle cx={12} cy={17} r={1.05} fill={color} />
    </Svg>
  );
}

function ResetIcon({ color }: { color: string }) {
  return (
    <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
      <Path
        d="M19.5 12A7.5 7.5 0 1 1 17 6.3"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
      />
      <Path
        d="M18.6 3.2V7.2H14.6"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

function CloseIcon({ color }: { color: string }) {
  return (
    <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
      <Path d="M6 6L18 18M18 6L6 18" stroke={color} strokeWidth={2} strokeLinecap="round" />
    </Svg>
  );
}

/* ── 도움말 시트 (원본 패널 내부 오버레이 → 바텀시트) ──────────────────────── */

function HelpSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
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
        {/* 시트 본체 탭이 백드롭으로 새어나가지 않게 한 겹 더 감싼다. */}
        <Pressable
          className="rounded-t-sheet bg-bg-elevated px-5 pt-4"
          style={{ paddingBottom: insets.bottom + spacing.lg }}
          onPress={() => undefined}
        >
          <Text className="pb-3 text-h3 font-w700 text-text-primary" accessibilityRole="header">
            {CHAT_COPY.help.title}
          </Text>

          <View className="gap-2.5">
            {CHAT_COPY.help.items.map((item, index) => (
              <View key={item} className="flex-row gap-2">
                <Text className="text-body-sm font-w700 text-action" maxFontSizeMultiplier={1.3}>
                  {index + 1}.
                </Text>
                <Text className="flex-1 text-body-sm text-text-secondary" maxFontSizeMultiplier={1.4}>
                  {item}
                </Text>
              </View>
            ))}
          </View>

          <View className="mt-5">
            <Button label={CHAT_COPY.help.confirm} onPress={onClose} variant="primary" fullWidth />
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/* ── 화면 ──────────────────────────────────────────────────────────────────── */

export default function ChatScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const t = useTheme();
  const listRef = useRef<FlashListRef<ChatMessage>>(null);

  const messages = useChatStore((s) => s.messages);
  const docType = useChatStore((s) => s.docType);
  const isSending = useChatStore((s) => s.isSending);
  const setDocType = useChatStore((s) => s.setDocType);
  const send = useChatStore((s) => s.send);
  const cancel = useChatStore((s) => s.cancel);
  const reset = useChatStore((s) => s.reset);

  const [draft, setDraft] = useState('');
  const [helpOpen, setHelpOpen] = useState(false);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => setOffline(state.isConnected === false));
    return unsubscribe;
  }, []);

  /* 새 말풍선이 붙거나 타이핑 인디케이터가 뜨면 하단으로 붙인다.
     레이아웃이 끝난 뒤여야 실제 끝으로 가므로 한 프레임 미룬다. */
  useEffect(() => {
    const timer = setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 60);
    return () => clearTimeout(timer);
  }, [messages.length, isSending]);

  /* ── 전송 ──────────────────────────────────────────────────────────────── */
  const onSend = useCallback(() => {
    if (offline || !canSendChat(docType, draft, isSending)) return;
    const query = draft;
    setDraft(''); // 낙관적으로 비운다 — 사용자 말풍선은 스토어가 즉시 붙인다.
    // 전송 버튼의 햅틱은 `Button` 이 이미 준다(§9 — 일반 버튼에 햅틱을 겹쳐 넣지 않는다).
    void send(query);
  }, [docType, draft, isSending, offline, send]);

  const onRetry = useCallback(
    (query: string) => {
      if (offline || isSending) return;
      // `다시 보내기` 도 일반 버튼이다 — §9 표에 없는 자리에는 햅틱을 넣지 않는다.
      void send(query);
    },
    [isSending, offline, send],
  );

  /* ── 초기화 (FR-080) ───────────────────────────────────────────────────── */
  const confirmReset = useCallback(() => {
    Alert.alert(CHAT_COPY.reset.title, CHAT_COPY.reset.body, [
      { text: CHAT_COPY.reset.cancel, style: 'cancel' },
      {
        text: CHAT_COPY.reset.confirm,
        style: 'destructive',
        onPress: () => {
          haptics.warning();
          reset();
          setDraft('');
        },
      },
    ]);
  }, [reset]);

  /* ── 닫기 · 복사 · 출처 이동 ───────────────────────────────────────────── */
  const close = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/search');
  }, [router]);

  const copyMessage = useCallback((text: string) => {
    haptics.impact('medium'); // HAP-06 — 롱프레스
    void Clipboard.setStringAsync(text);
    // 롱프레스 햅틱이 이미 울렸다 → 토스트 햅틱은 끈다(같은 순간 2회 진동 금지, §9 금지 2).
    toast.success(CHAT_COPY.copied, { haptic: false });
  }, []);

  const openSource = useCallback(
    (source: DocumentSummary) => {
      const id = String(source.id);
      // 서버가 id 없는 행을 흘릴 수 있다(3홉 경유라 DTO 를 앱이 통제하지 못한다).
      if (id === '' || id === 'undefined' || id === 'null') {
        toast.error(CHAT_COPY.sourceNotFound);
        return;
      }
      router.push(href(`/doc/${DOC_ROUTE_SEGMENT[source.type]}/${encodeURIComponent(id)}`));
    },
    [router],
  );

  /* ── 렌더 ──────────────────────────────────────────────────────────────── */
  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<ChatMessage>) => (
      <View className="mb-3">
        <ChatBubble
          role={item.role}
          text={item.text}
          onLongPress={() => copyMessage(item.text)}
          {...(item.retryQuery ? { onRetry: () => onRetry(item.retryQuery ?? '') } : {})}
          testID={`chat-bubble-${item.id}`}
        />

        {/* 출처 카드 레일 (FR-079). 말풍선(maxWidth 84%) 밖에 두어야 200dp 카드가 잘리지 않는다. */}
        {item.sources && item.sources.length > 0 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            className="mt-2"
            contentContainerStyle={{ gap: spacing.sm, paddingRight: spacing.lg }}
          >
            {item.sources.map((source) => (
              <SourceCard
                key={source.key}
                source={source}
                onPress={openSource}
                testID={`chat-source-${source.key}`}
              />
            ))}
          </ScrollView>
        ) : null}
      </View>
    ),
    [copyMessage, onRetry, openSource],
  );

  return (
    <View className="flex-1 bg-surface">
      <Stack.Screen
        options={{
          presentation: 'modal',
          animation: 'slide_from_bottom',
          headerShown: false,
        }}
      />
      {/* 헤더가 brand(진남색)라 상태바 글자는 항상 밝아야 한다 (라이트 테마에서도). */}
      <StatusBar style="light" />

      {/* ── 헤더 h58 bg brand ── */}
      <View
        className="flex-row items-center bg-brand px-2"
        style={{ paddingTop: insets.top, height: HEADER_HEIGHT + insets.top }}
      >
        <Text
          className="ml-2 flex-1 text-h3 font-w700 text-text-inverse"
          numberOfLines={1}
          accessibilityRole="header"
          maxFontSizeMultiplier={1.3}
        >
          {CHAT_COPY.title}
        </Text>

        <IconButton
          icon={<HelpIcon color={t.text.inverse} />}
          onPress={() => setHelpOpen(true)}
          size="md"
          accessibilityLabel={CHAT_COPY.help.title}
          testID="chat-help"
        />
        <IconButton
          icon={<ResetIcon color={t.text.inverse} />}
          onPress={confirmReset}
          size="md"
          accessibilityLabel={CHAT_COPY.reset.title}
          testID="chat-reset"
        />
        <IconButton
          icon={<CloseIcon color={t.text.inverse} />}
          onPress={close}
          size="md"
          accessibilityLabel="닫기"
          testID="chat-close"
        />
      </View>

      {/* ── 본문 + 입력바 (키보드 회피) ──
          iOS 만 `padding` 이다. 안드로이드는 adjustResize 가 창을 줄여 주므로 behavior 를 주면
          입력바가 두 번 밀린다. */}
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {offline ? (
          <View
            className="mx-4 mt-3 rounded-card border border-warn-border bg-warn-container px-3 py-2"
            accessibilityLiveRegion="polite"
          >
            <Text className="text-body-sm font-w600 text-warn" maxFontSizeMultiplier={1.3}>
              {CHAT_COPY.networkFailed}
            </Text>
          </View>
        ) : null}

        {/* FlashList 는 스스로 flex 하지 않는다 → `flex-1` 컨테이너 안에 둔다. 그래야 입력바가
            항상 화면 하단에 붙고, 메시지가 늘어도 리스트만 스크롤된다. */}
        <View className="flex-1">
          <FlashList
            ref={listRef}
            data={messages}
            renderItem={renderItem}
            keyExtractor={(item) => item.id}
            // 역할마다 형상이 달라 재활용 풀을 분리한다.
            getItemType={(item) => item.role}
            drawDistance={400}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ padding: spacing.lg }}
            onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
            ListFooterComponent={isSending ? <TypingBubble testID="chat-typing" /> : null}
          />
        </View>

        <View style={{ paddingBottom: insets.bottom }}>
          <ChatComposer
            value={draft}
            onChangeText={setDraft}
            onSend={onSend}
            selectedType={docType}
            onSelectType={setDocType}
            sending={isSending}
            onCancel={cancel}
            disabled={offline}
            testID="chat-composer"
          />
        </View>
      </KeyboardAvoidingView>

      <HelpSheet visible={helpOpen} onClose={() => setHelpOpen(false)} />
    </View>
  );
}
