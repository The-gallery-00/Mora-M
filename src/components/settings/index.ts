// src/components/settings/index.ts
//
// 설정 화면(SCR-25~SCR-30) 전용 composite 배럴 — CMP-10/11/35/36.
// 전부 named export 다. `default export` 는 금지(Component Library §0-2 규칙 1).
//
// primitive(Button/TextField/SegmentedControl/Divider…)는 `@/components/ui` 가 정본이고
// 여기서 재export 하지 않는다 — 같은 컴포넌트를 두 경로로 가져올 수 있게 되면
// 어느 쪽이 정본인지 알 수 없어진다.
export { Avatar, avatarInitial } from './Avatar';
export type { AvatarProps, AvatarSize } from './Avatar';

export { Toggle } from './Toggle';
export type { ToggleProps } from './Toggle';

export { ChevronIcon, SettingsPill, SettingsRow } from './SettingsRow';
export type {
  SettingsPillTone,
  SettingsRowProps,
  SettingsRowTone,
  SettingsRowToggle,
} from './SettingsRow';

export { SettingsSection } from './SettingsSection';
export type { SettingsSectionProps } from './SettingsSection';
