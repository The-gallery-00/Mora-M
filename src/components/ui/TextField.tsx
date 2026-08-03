// src/components/ui/TextField.tsx
//
// CMP-03 TextField — Component Library §2 / §3-2 정본. 원본 `shared/TextInput.tsx` 이식(단순화)이다.
// 원본의 4겹 absolute 레이어(배경/보더/input/inset shadow)는 1겹으로 줄였다 —
// RN 에 inset shadow 가 없고(Design Tokens §8 규칙 4) 레이어가 커서·선택 동작을 방해한다.
//
// 색: 컨테이너·라벨·헬퍼는 className 토큰, TextInput 자신의 색·폰트는 style 이다.
// 이유 — `inSheet` 일 때 서드파티 `BottomSheetTextInput` 으로 스위칭되는데 그 컴포넌트에는
// NativeWind className 이 닿지 않는다(cssInterop 미등록). 두 분기의 시각을 동일하게 유지하려면
// 입력 요소만 style + useTheme 로 통일해야 한다(§3-0 N-6 의 취지와 동일).
import { BottomSheetTextInput } from '@gorhom/bottom-sheet';
import { forwardRef, useEffect, useState, type ReactNode } from 'react';
import {
  Pressable,
  Text,
  TextInput,
  View,
  type KeyboardTypeOptions,
  type ReturnKeyTypeOptions,
  type StyleProp,
  type TextInputProps as RNTextInputProps,
  type ViewStyle,
} from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, Path } from 'react-native-svg';

import { useTheme } from '@/theme/ThemeProvider';
import { fontFamily, fontScale, radius, spacing } from '@/theme/scale';

/** 인증 폼(SCR-03/04)은 h56 / radius 14, 일반 폼은 h48 / radius 10 (§3-2) */
export type TextFieldVariant = 'default' | 'auth';

export interface TextFieldProps {
  value: string;
  onChangeText: (text: string) => void; // ← 원본 onChange(e) 에서 시그니처 변경
  placeholder?: string;
  label?: string; // 위쪽 caption 라벨
  hint?: string; // 아래쪽 caption
  error?: string; // 있으면 hint 대신 danger 색으로 표시
  required?: boolean; // 라벨에 * 표시 (RN 엔 required 속성이 없다)
  disabled?: boolean;
  multiline?: boolean;
  numberOfLines?: number; // multiline 일 때 minHeight 산출용
  maxLength?: number;
  clearable?: boolean; // 우측 ✕ 버튼
  /** 비밀번호 입력. `revealable` 과 함께 우측 눈 토글이 붙는다 */
  secureTextEntry?: boolean;
  /** 눈 토글 노출. default true (secureTextEntry 일 때만 의미 있음) */
  revealable?: boolean;
  keyboardType?: KeyboardTypeOptions;
  autoCapitalize?: RNTextInputProps['autoCapitalize'];
  autoComplete?: RNTextInputProps['autoComplete'];
  textContentType?: RNTextInputProps['textContentType'];
  returnKeyType?: ReturnKeyTypeOptions;
  onSubmitEditing?: () => void;
  onFocus?: () => void;
  onBlur?: () => void;
  /** 캘린더/시계 아이콘 등 우측 커스텀 슬롯 */
  trailing?: ReactNode;
  /** true 면 BottomSheetTextInput 사용 — 시트 안에서 일반 TextInput 은 키보드와 충돌한다 */
  inSheet?: boolean;
  /**
   * 배경을 비우고 **테두리만** 남긴다 (SCR-27 피그마 개정). default false.
   * 상태 구분은 보더 색·굵기(focus `border-action` / error `border-danger` 1.5dp)와
   * 텍스트 색이 그대로 지므로 §14-4(색 외 단서)는 유지된다.
   * `variant` 와 직교한다 — 그쪽은 높이/반경 축이다.
   */
  unfilled?: boolean;
  variant?: TextFieldVariant; // default 'default'
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/* ── 최소 인라인 아이콘 ────────────────────────────────────────────────
   lucide-react-native 가 아직 설치되지 않았다(패키지 추가 금지). Design Tokens §12 의
   `Eye`/`EyeOff`/`X` 자리를 react-native-svg 로 같은 크기(20dp)·같은 색 규칙으로 채운다.
   lucide 도입 후 이 3개만 교체하면 된다. */
function EyeIcon({ color, off }: { color: string; off?: boolean }) {
  return (
    <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
      <Path
        d="M1.5 12C4.5 6.5 8 5 12 5C16 5 19.5 6.5 22.5 12C19.5 17.5 16 19 12 19C8 19 4.5 17.5 1.5 12Z"
        stroke={color}
        strokeWidth={2}
        strokeLinejoin="round"
      />
      <Circle cx={12} cy={12} r={3} stroke={color} strokeWidth={2} />
      {off ? <Path d="M3 3L21 21" stroke={color} strokeWidth={2} strokeLinecap="round" /> : null}
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

export const TextField = forwardRef<TextInput, TextFieldProps>(function TextField(
  {
    value,
    onChangeText,
    placeholder,
    label,
    hint,
    error,
    required = false,
    disabled = false,
    multiline = false,
    numberOfLines = 4,
    maxLength,
    clearable = false,
    secureTextEntry = false,
    revealable = true,
    keyboardType,
    autoCapitalize,
    autoComplete,
    textContentType,
    returnKeyType,
    onSubmitEditing,
    onFocus,
    onBlur,
    trailing,
    inSheet = false,
    unfilled = false,
    variant = 'default',
    style,
    testID,
  },
  ref,
) {
  const t = useTheme();
  const reduceMotion = useReducedMotion();
  const [focused, setFocused] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const shake = useSharedValue(0);

  const hasError = Boolean(error);

  // §3-2 error: 흔들림 200ms (translateX ±4). Reduce Motion 이면 움직이지 않는다(§8 전역 규칙 1)
  useEffect(() => {
    if (!hasError || reduceMotion) return;
    shake.value = withSequence(
      withTiming(-4, { duration: 50, easing: Easing.linear }),
      withTiming(4, { duration: 50, easing: Easing.linear }),
      withTiming(-2, { duration: 50, easing: Easing.linear }),
      withTiming(0, { duration: 50, easing: Easing.linear }),
    );
  }, [hasError, reduceMotion, shake]);

  const shakeStyle = useAnimatedStyle(() => ({ transform: [{ translateX: shake.value }] }));

  /* 상태별 배경·보더 (§3-2). 다크 값은 같은 토큰 이름으로 치환된다(N-1)
     `unfilled` 는 상태와 무관하게 배경을 비운다 — 채움으로 주던 신호는 보더 색/굵기가 대신 진다.
     disabled 도 마찬가지라 배경 대신 `text-disabled` 글자색 + `border-border-subtle` 로만 읽힌다. */
  const surfaceClass = unfilled
    ? 'bg-transparent'
    : disabled
      ? 'bg-surface-alt'
      : hasError
        ? 'bg-danger-container' // 원본 dangerFaint(red-50)는 tokens.ts 에 없어 danger.container 로 매핑
        : focused
          ? 'bg-bg-elevated'
          : 'bg-surface';

  const borderClass = disabled
    ? 'border-border-subtle'
    : hasError
      ? 'border-danger'
      : focused
        ? 'border-action'
        : 'border-border-subtle';

  // 포커스/에러는 1.5dp. border.strong·action 이 표면 대비 3:1 을 넘겨야 WCAG 1.4.11 을 만족한다(DK-07)
  const borderWidth = !disabled && (focused || hasError) ? 1.5 : 1;

  const height = variant === 'auth' ? 56 : 48;
  const boxRadius = variant === 'auth' ? radius.field : radius.button;

  // 시트 안에서는 BottomSheetTextInput 으로 스위칭한다. 두 컴포넌트의 props 집합이 같으므로
  // 유니온 대신 단일 타입으로 좁혀 JSX 호출 시그니처 충돌을 피한다.
  const Input = (inSheet ? BottomSheetTextInput : TextInput) as typeof TextInput;
  const showEye = secureTextEntry && revealable;
  const showClear = clearable && !disabled && value.length > 0;
  const helper = error ?? hint;

  return (
    <View className="w-full" style={style}>
      {label ? (
        <Text className="mb-1.5 text-label font-w600 text-text-secondary">
          {label}
          {required ? <Text className="text-label font-w600 text-danger"> *</Text> : null}
        </Text>
      ) : null}

      <Animated.View style={shakeStyle}>
        <View
          className={`flex-row ${multiline ? 'items-start' : 'items-center'} ${surfaceClass} ${borderClass}`}
          style={{
            borderWidth,
            borderRadius: boxRadius,
            paddingHorizontal: spacing.lg,
            ...(multiline
              ? { minHeight: numberOfLines * fontScale.input.line + spacing.xxl, paddingVertical: spacing.md }
              : { height }),
          }}
        >
          <Input
            ref={ref as never}
            value={value}
            onChangeText={onChangeText}
            placeholder={placeholder}
            // 플레이스홀더는 대비 2.9:1 로 의도된 미달 값이다 — 읽어야 하는 정보에 쓰지 않는다(§11-2)
            placeholderTextColor={t.text.disabled}
            editable={!disabled}
            multiline={multiline}
            maxLength={maxLength}
            secureTextEntry={secureTextEntry && !revealed}
            keyboardType={keyboardType}
            autoCapitalize={autoCapitalize}
            autoComplete={autoComplete}
            textContentType={textContentType}
            returnKeyType={returnKeyType}
            onSubmitEditing={onSubmitEditing}
            onFocus={() => {
              setFocused(true);
              onFocus?.();
            }}
            onBlur={() => {
              setFocused(false);
              onBlur?.();
            }}
            testID={testID}
            /* A11Y-14 — 필드와 에러를 한 라벨로 묶어 읽히게 한다.
               라벨이 없는 자리(인증 폼은 placeholder 만 쓴다)에서도 오류는 반드시 붙는다 —
               예전에는 `label` 이 없으면 accessibilityLabel 이 통째로 undefined 라
               스크린리더가 오류를 한 마디도 읽지 않았다. */
            accessibilityLabel={
              (() => {
                const base = label ?? placeholder;
                if (base === undefined) return error ? `오류: ${error}` : undefined;
                return error ? `${base}, 오류: ${error}` : base;
              })()
            }
            selectionColor={t.action.base}
            style={{
              flex: 1,
              paddingVertical: 0,
              // typography.input — 16 미만이면 iOS 가 포커스 시 화면을 확대한다(§5 하한선)
              fontFamily: fontFamily.medium,
              fontSize: fontScale.input.size,
              lineHeight: fontScale.input.line,
              color: disabled ? t.text.disabled : t.text.primary,
              textAlignVertical: multiline ? 'top' : 'center',
            }}
          />

          {showClear ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="입력 지우기"
              onPress={() => onChangeText('')}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              className="ml-2 items-center justify-center"
              style={{ width: 20, height: 20 }}
            >
              <ClearIcon color={t.text.disabled} glyphColor={t.bg.elevated} />
            </Pressable>
          ) : null}

          {showEye ? (
            <Pressable
              accessibilityRole="button"
              // 원본 문구 그대로 (UX 가이드 §5 규칙 8)
              accessibilityLabel={revealed ? '비밀번호 숨기기' : '비밀번호 보기'}
              accessibilityState={{ selected: revealed }}
              onPress={() => setRevealed((prev) => !prev)}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              className="ml-2 items-center justify-center"
              style={{ width: 20, height: 20 }}
            >
              <EyeIcon color={t.text.muted} off={revealed} />
            </Pressable>
          ) : null}

          {trailing ? <View className="ml-2">{trailing}</View> : null}
        </View>
      </Animated.View>

      {helper ? (
        <Text
          className={`mt-1.5 text-caption ${error ? 'text-danger' : 'text-text-muted'}`}
          // 오류 캡션은 나타나는 순간 읽혀야 한다. hint 는 상시 문구라 알릴 것이 없다(A11Y-14).
          {...(error ? { accessibilityLiveRegion: 'polite' as const } : {})}
        >
          {helper}
        </Text>
      ) : null}
    </View>
  );
});
