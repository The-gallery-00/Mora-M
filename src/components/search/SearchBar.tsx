// src/components/search/SearchBar.tsx
//
// CMP-05 SearchBar — Component Library §2 (1-A) 정본. SCR-23 상단 검색바.
// 와이어프레임 수치 그대로: h44 / radius 10 / 배경 `surface`(라이트 #F8FAFC) / 좌측 🔍 / 우측 ✕.
//
// **`TextField`(CMP-03)를 쓰지 않는 이유**: CMP-03 은 h48·라벨/헬퍼/에러를 가진 폼 필드이고
// 좌측 아이콘 슬롯이 없다. 검색바는 라벨도 헬퍼도 없는 h44 단일 행이라 형태가 다르다.
// 대신 입력 요소의 색·폰트를 style + useTheme 으로 주는 규칙(§3-0 N-6)은 CMP-03 과 동일하게 지킨다.
//
// **디바운스 없음(FR-071).** 이 컴포넌트는 `onChangeText` 로 로컬 상태만 올리고, 실행은
// `onSubmit`(키보드 `검색` 또는 🔍 버튼) 에서만 일어난다. 서버가 검색 API 호출마다 검색기록을
// 1건 적립하므로 타이핑 중 실행은 구조적으로 막아야 한다.
import { forwardRef } from 'react';
import { ActivityIndicator, Pressable, TextInput, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

import { useTheme } from '@/theme/ThemeProvider';
import { fontFamily, fontScale, radius, spacing } from '@/theme/scale';

/** 원본 문구 (SCR-23 상태표). */
export const SEARCH_BAR_PLACEHOLDER = '검색어를 입력하세요';

const BAR_HEIGHT = 44;

export interface SearchBarProps {
  value: string;
  onChangeText: (text: string) => void;
  /** 명시적 제출 — 키보드 `검색` / 좌측 🔍 탭. 여기서만 검색이 실행된다. */
  onSubmit: () => void;
  placeholder?: string;
  autoFocus?: boolean;
  /** 우측 스피너. 실행 중에도 입력은 계속 가능하다. */
  loading?: boolean;
  /** 지정하면 ✕ 가 이 콜백을 부른다. 미지정이면 `onChangeText('')`. */
  onClear?: () => void;
  /** 오프라인 등으로 검색 자체가 불가할 때 (SCR-23 상태표 `오프라인`). */
  disabled?: boolean;
  testID?: string;
}

/* lucide-react-native 미설치(패키지 추가 금지) — Design Tokens §12 의 Search/X 를 같은 실루엣으로 그린다. */
function SearchIcon({ color }: { color: string }) {
  return (
    <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
      <Circle cx={10.8} cy={10.8} r={6.8} stroke={color} strokeWidth={1.8} />
      <Path d="M15.8 15.8L20.5 20.5" stroke={color} strokeWidth={1.8} strokeLinecap="round" />
    </Svg>
  );
}

function ClearIcon({ color, glyphColor }: { color: string; glyphColor: string }) {
  return (
    <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
      <Circle cx={12} cy={12} r={9} fill={color} />
      <Path
        d="M8.5 8.5L15.5 15.5M15.5 8.5L8.5 15.5"
        stroke={glyphColor}
        strokeWidth={2}
        strokeLinecap="round"
      />
    </Svg>
  );
}

export const SearchBar = forwardRef<TextInput, SearchBarProps>(function SearchBar(
  {
    value,
    onChangeText,
    onSubmit,
    placeholder = SEARCH_BAR_PLACEHOLDER,
    autoFocus = false,
    loading = false,
    onClear,
    disabled = false,
    testID,
  },
  ref,
) {
  const t = useTheme();
  const showClear = !disabled && value.length > 0;

  return (
    <View
      className={`flex-row items-center border ${
        disabled ? 'border-border-subtle bg-surface-alt' : 'border-border-subtle bg-surface'
      }`}
      style={{
        height: BAR_HEIGHT,
        borderRadius: radius.button,
        paddingHorizontal: spacing.md,
        gap: spacing.sm,
      }}
    >
      {/* 🔍 자체가 제출 버튼이다 — 키보드를 닫은 채로도 재실행할 수단이 필요하다. */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="검색"
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={onSubmit}
        // 아이콘 20dp — 좌우도 12 를 줘야 실효 44×44 가 된다 (§11-1)
        hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        style={({ pressed }) => (pressed ? { opacity: 0.6 } : null)}
      >
        <SearchIcon color={disabled ? t.text.disabled : t.text.muted} />
      </Pressable>

      <TextInput
        ref={ref}
        testID={testID}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={t.text.disabled}
        editable={!disabled}
        autoFocus={autoFocus}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        // 명시적 제출 지점 ①. `blurOnSubmit` 기본값(true)에 맡겨 키보드가 함께 내려간다.
        onSubmitEditing={onSubmit}
        accessibilityLabel={placeholder}
        selectionColor={t.action.base}
        style={{
          flex: 1,
          paddingVertical: 0,
          fontFamily: fontFamily.medium,
          // 16 미만이면 iOS 가 포커스 시 화면을 확대한다 (Design Tokens §5 하한선).
          fontSize: fontScale.input.size,
          lineHeight: fontScale.input.line,
          color: disabled ? t.text.disabled : t.text.primary,
        }}
      />

      {loading ? <ActivityIndicator size="small" color={t.action.base} /> : null}

      {showClear ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="검색어 지우기"
          onPress={() => (onClear ? onClear() : onChangeText(''))}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          className="items-center justify-center"
          style={{ width: 20, height: 20 }}
        >
          <ClearIcon color={t.text.disabled} glyphColor={t.bg.elevated} />
        </Pressable>
      ) : null}
    </View>
  );
});
