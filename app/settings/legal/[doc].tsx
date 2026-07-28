// app/settings/legal/[doc].tsx — SCR-30 약관 / 개인정보 처리방침 / 라이선스 / 앱 정보
//
// **인증이 필요 없는 화면이다.** 스토어 심사 도구가 비로그인 상태로 열 수 있어야 한다(SCR-30 표).
// 루트 스택에는 인증 가드가 없으므로(가드는 `(tabs)/_layout` 과 `(auth)/_layout` 두 곳뿐 —
// Navigation Map §6-3 규칙 1) 이 파일은 세션을 전혀 건드리지 않는다.
//
// 본문은 **앱 번들에 동봉한 문서**를 렌더한다. 원격 웹뷰가 아닌 이유(SCR-30 신설 근거):
//   ① 오프라인에서도 열려야 하고 ② 네트워크·CSP 실패에 영향받지 않아야 하며
//   ③ 심사 시점의 문서가 고정돼야 한다.
//
// ⚠ 마크다운 렌더러를 **직접 만든다.** `react-native-markdown-display` 같은 패키지를 넣을 수
//   없고(패키지 추가 금지), 문서 4종이 쓰는 문법은 제목·문단·목록·표·인용·구분선·코드블록과
//   인라인 굵게/코드/링크뿐이다. 범용 파서가 필요한 상황이 아니다.
//   지원하지 않는 문법(이미지·중첩 목록·각주)은 문서 쪽에서 쓰지 않는다.
//
// ⚠ 로딩 상태를 만들지 않는다. SCR-30 상태표의 `스켈레톤 텍스트 6줄`은 번들 문서를 비동기로
//   파싱할 때를 가정한 것인데, 여기서는 문자열이 **동기**로 들어온다. 한 프레임도 비어 있지
//   않은 화면에 스켈레톤을 넣으면 깜빡임만 는다.
import Constants from 'expo-constants';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useMemo } from 'react';
import { Linking, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  isLegalDoc,
  LEGAL_DOC_TITLE,
  LEGAL_EFFECTIVE_DATE,
  legalDocumentBody,
} from '@/assets/legal';
import { Button, toast } from '@/components/ui';
import { variant } from '@/config/env';
import { ArchiveHeader } from '@/features/documents/ArchiveList';
import { spacing } from '@/theme/scale';

/** SCR-30 에러 상태 — 번들 문서가 없을 리는 없지만 잘못된 `doc` 으로 딥링크가 들어올 수 있다. */
const LOAD_FAILED = '문서를 불러오지 못했습니다.';
const OPEN_WEB = '웹에서 보기';
const LINK_FAILED = '링크를 열 수 없습니다.';
const FALLBACK_URL = 'https://github.com/lavermeanyou/OCR_FOR_MORA';

/* ══════════════════════════════════════════════════ 인라인 파서

   `**굵게**` · `` `코드` `` · `[라벨](url)` · 맨 URL 을 조각으로 끊는다.
   정규식 하나로 네 패턴을 번갈아 훑고, 매치 사이의 평문을 그대로 흘린다. */

type Inline = { text: string; bold?: boolean; code?: boolean; href?: string };

const INLINE_RE = /\*\*(.+?)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)]+)\)|(https?:\/\/[^\s)]+)/g;

function parseInline(source: string): Inline[] {
  const out: Inline[] = [];
  let cursor = 0;

  for (const match of source.matchAll(INLINE_RE)) {
    const at = match.index ?? 0;
    const full = match[0];
    if (at > cursor) out.push({ text: source.slice(cursor, at) });

    const bold = match[1];
    const code = match[2];
    const linkLabel = match[3];
    const linkHref = match[4];
    const bareUrl = match[5];

    if (bold !== undefined) out.push({ text: bold, bold: true });
    else if (code !== undefined) out.push({ text: code, code: true });
    else if (linkLabel !== undefined && linkHref !== undefined) {
      out.push({ text: linkLabel, href: linkHref });
    } else if (bareUrl !== undefined) out.push({ text: bareUrl, href: bareUrl });

    cursor = at + full.length;
  }

  if (cursor < source.length) out.push({ text: source.slice(cursor) });
  return out;
}

/* ══════════════════════════════════════════════════ 블록 파서 */

type Block =
  | { kind: 'h2'; text: string }
  | { kind: 'h3'; text: string }
  | { kind: 'p'; text: string }
  | { kind: 'li'; text: string; ordered: boolean; marker: string }
  | { kind: 'quote'; text: string }
  | { kind: 'hr' }
  | { kind: 'code'; text: string }
  | { kind: 'table'; header: string[]; rows: string[][] };

const splitRow = (line: string): string[] =>
  line
    .replace(/^\s*\|/, '')
    .replace(/\|\s*$/, '')
    .split('|')
    .map((cell) => cell.trim());

const isTableLine = (line: string): boolean => line.trimStart().startsWith('|');
/** `|---|---|` 구분행. 콜론 정렬 표기(`:---:`)도 통과시킨다. */
const isTableDivider = (line: string): boolean => /^\s*\|[\s:|-]+\|\s*$/.test(line);

function parseMarkdown(source: string): Block[] {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const blocks: Block[] = [];
  // 문단은 여러 줄에 걸쳐 있을 수 있다 → 빈 줄이나 다른 블록을 만날 때 한 번에 flush 한다.
  let paragraph: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    blocks.push({ kind: 'p', text: paragraph.join(' ') });
    paragraph = [];
  };

  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i] ?? '';
    const line = raw.trimEnd();
    const trimmed = line.trim();

    if (trimmed === '') {
      flushParagraph();
      continue;
    }

    // 코드블록 — 닫는 펜스까지 원문 그대로 모은다(들여쓰기 보존).
    if (trimmed.startsWith('```')) {
      flushParagraph();
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !(lines[i] ?? '').trim().startsWith('```')) {
        body.push(lines[i] ?? '');
        i += 1;
      }
      blocks.push({ kind: 'code', text: body.join('\n') });
      continue;
    }

    // 표 — 헤더행 + 구분행이 연달아 나올 때만 표로 본다(단순 파이프 문장 오인 방지).
    if (isTableLine(line) && isTableDivider(lines[i + 1] ?? '')) {
      flushParagraph();
      const header = splitRow(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && isTableLine(lines[i] ?? '')) {
        rows.push(splitRow(lines[i] ?? ''));
        i += 1;
      }
      i -= 1; // 바깥 루프의 증가분을 되돌린다
      blocks.push({ kind: 'table', header, rows });
      continue;
    }

    if (/^---+$/.test(trimmed)) {
      flushParagraph();
      blocks.push({ kind: 'hr' });
      continue;
    }

    if (trimmed.startsWith('### ')) {
      flushParagraph();
      blocks.push({ kind: 'h3', text: trimmed.slice(4).trim() });
      continue;
    }

    if (trimmed.startsWith('## ')) {
      flushParagraph();
      blocks.push({ kind: 'h2', text: trimmed.slice(3).trim() });
      continue;
    }

    if (trimmed.startsWith('> ')) {
      flushParagraph();
      const prev = blocks[blocks.length - 1];
      const text = trimmed.slice(2).trim();
      // 연속된 인용 줄은 한 덩어리로 합친다.
      if (prev && prev.kind === 'quote') prev.text = `${prev.text} ${text}`;
      else blocks.push({ kind: 'quote', text });
      continue;
    }

    const ordered = /^\d+\.\s+/.exec(trimmed);
    if (ordered) {
      flushParagraph();
      blocks.push({
        kind: 'li',
        ordered: true,
        marker: ordered[0].trim(),
        text: trimmed.slice(ordered[0].length),
      });
      continue;
    }

    if (/^[-*]\s+/.test(trimmed)) {
      flushParagraph();
      blocks.push({ kind: 'li', ordered: false, marker: '•', text: trimmed.replace(/^[-*]\s+/, '') });
      continue;
    }

    paragraph.push(trimmed);
  }

  flushParagraph();
  return blocks;
}

/* ══════════════════════════════════════════════════ 렌더 */

function openLink(url: string) {
  void (async () => {
    try {
      // 앱 안에서 열어 백스택을 잃지 않는다. mailto: 등은 WebBrowser 가 못 여니 Linking 으로 넘긴다.
      if (/^https?:\/\//i.test(url)) await WebBrowser.openBrowserAsync(url);
      else await Linking.openURL(url);
    } catch {
      toast.error(LINK_FAILED);
    }
  })();
}

function InlineText({ parts }: { parts: Inline[] }) {
  return (
    <>
      {parts.map((part, index) => {
        if (part.href !== undefined) {
          const href = part.href;
          return (
            <Text
              key={index}
              className="text-base font-w600 text-action underline"
              accessibilityRole="link"
              onPress={() => openLink(href)}
            >
              {part.text}
            </Text>
          );
        }
        return (
          <Text
            key={index}
            className={
              part.code
                ? 'text-body-sm font-mono text-text-secondary'
                : part.bold
                  ? 'text-base font-w700 text-text-primary'
                  : 'text-base text-text-secondary'
            }
          >
            {part.text}
          </Text>
        );
      })}
    </>
  );
}

function MarkdownTable({ header, rows }: { header: string[]; rows: string[][] }) {
  return (
    <View className="mt-3 overflow-hidden rounded-md border border-border-subtle">
      <View className="flex-row bg-surface-alt">
        {header.map((cell, index) => (
          <View key={index} className="flex-1 px-2 py-2">
            <Text className="text-caption font-w700 text-text-secondary">{cell}</Text>
          </View>
        ))}
      </View>

      {rows.map((row, rowIndex) => (
        <View key={rowIndex} className="flex-row border-t border-border-subtle">
          {/* 셀 수가 헤더보다 적은 행이 와도 레이아웃이 무너지지 않게 헤더 길이에 맞춘다. */}
          {header.map((_, cellIndex) => (
            <View key={cellIndex} className="flex-1 px-2 py-2">
              <Text className="text-caption text-text-secondary" selectable>
                {row[cellIndex] ?? ''}
              </Text>
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

function MarkdownBlock({ block }: { block: Block }) {
  switch (block.kind) {
    case 'h2':
      return (
        <Text className="mt-6 text-h3 font-w700 text-text-primary" accessibilityRole="header">
          {block.text}
        </Text>
      );
    case 'h3':
      return (
        <Text className="mt-4 text-input font-w700 text-text-primary" accessibilityRole="header">
          {block.text}
        </Text>
      );
    case 'p':
      return (
        <Text className="mt-3 text-base text-text-secondary" selectable>
          <InlineText parts={parseInline(block.text)} />
        </Text>
      );
    case 'li':
      return (
        <View className="mt-2 flex-row gap-2 pl-1">
          <Text className="text-base text-text-muted" style={{ minWidth: block.ordered ? 20 : 12 }}>
            {block.marker}
          </Text>
          <Text className="flex-1 text-base text-text-secondary" selectable>
            <InlineText parts={parseInline(block.text)} />
          </Text>
        </View>
      );
    case 'quote':
      return (
        <View className="mt-3 rounded-md border-l-4 border-border-strong bg-surface-alt px-3 py-2">
          <Text className="text-body-sm text-text-secondary" selectable>
            <InlineText parts={parseInline(block.text)} />
          </Text>
        </View>
      );
    case 'hr':
      return <View className="mt-5 h-px bg-border-subtle" />;
    case 'code':
      return (
        <View className="mt-3 rounded-md bg-bg-sunken p-3">
          <Text className="text-caption font-mono text-text-secondary" selectable>
            {block.text}
          </Text>
        </View>
      );
    case 'table':
      return <MarkdownTable header={block.header} rows={block.rows} />;
  }
}

/* ══════════════════════════════════════════════════ 화면 */

export default function LegalScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ doc?: string }>();

  const doc = isLegalDoc(params.doc) ? params.doc : null;

  const version = Constants.expoConfig?.version ?? '—';
  const build = String(Constants.expoConfig?.android?.versionCode ?? '—');

  // 파싱은 문서당 한 번이면 된다. 스크롤할 때마다 다시 돌면 긴 문서에서 프레임이 떨어진다.
  const blocks = useMemo(
    () => (doc === null ? [] : parseMarkdown(legalDocumentBody(doc, { version, build, variant }))),
    [build, doc, version],
  );

  const title = doc === null ? '문서' : LEGAL_DOC_TITLE[doc];
  const effectiveDate = doc === null ? null : LEGAL_EFFECTIVE_DATE[doc];

  return (
    <View className="flex-1 bg-bg-base">
      <ArchiveHeader title={title} onBack={() => router.back()} testID="legal-header" />

      {doc === null ? (
        <View className="flex-1 items-center justify-center gap-4 px-8">
          <Text className="text-center text-base font-w600 text-text-secondary">{LOAD_FAILED}</Text>
          <Button label={OPEN_WEB} onPress={() => openLink(FALLBACK_URL)} variant="secondary" size="md" />
        </View>
      ) : (
        <ScrollView
          className="flex-1"
          contentContainerStyle={{
            paddingHorizontal: spacing.lg,
            paddingTop: spacing.md,
            paddingBottom: insets.bottom + spacing.xxxl,
          }}
          showsVerticalScrollIndicator={false}
          testID="legal-scroll"
        >
          {effectiveDate ? (
            <Text className="text-caption text-text-muted">시행일 {effectiveDate}</Text>
          ) : null}

          {blocks.map((block, index) => (
            <MarkdownBlock key={index} block={block} />
          ))}
        </ScrollView>
      )}
    </View>
  );
}
