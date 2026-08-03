// src/i18n/ko.ts
//
// FR-111 — 한국어 문자열 카탈로그. **v1 의 유일한 로케일이다.**
//
// ── 이 파일이 지키는 규칙 ────────────────────────────────────────────────
// 1. **여기서 문장을 새로 짓지 않는다.** 모든 값은 이미 코드에 존재하던 상수를 글자 단위로
//    옮긴 것이고, 각 네임스페이스에 원본 파일 경로를 적어 두었다. 원본은 다시 위키
//    (Screen Specs / Mobile UX Guide §7-2 카피 테이블)에서 온 문구다.
// 2. **import 가 없다.** 카탈로그는 의존성 그래프의 맨 아래에 있어야 한다. 여기서 features 를
//    import 하면 나중에 화면이 i18n 을 import 하는 순간 순환 참조가 되어 런타임에 undefined 가 뜬다.
//    그래서 값을 리터럴로 복사했고, 복사본이 원본과 어긋나는 것은 `./parity.ts` 가
//    **컴파일 타임에** 막는다(값이 한 글자라도 달라지면 `npm run typecheck` 가 깨진다).
// 3. `as const` 를 뗀다거나 키를 `string` 으로 넓히면 위 가드가 통째로 무력해진다. 유지한다.
//
// ── 아직 여기 없는 것 ────────────────────────────────────────────────────
// 화면 파일(app/**, src/components/**)에 인라인으로 박혀 있는 문자열은 **의도적으로** 옮기지
// 않았다. 일괄 치환은 이 페이즈에서 가장 위험한 작업이다. 이관 순서는 `./index.ts` 하단의
// 마이그레이션 가이드를 따른다.

export const ko = {
  /* ─────────────────────────────────────────────────────────────────────
     auth — 원본: src/features/auth/messages.ts `AUTH_COPY`
     ───────────────────────────────────────────────────────────────────── */
  auth: {
    loginFailed: '이메일 또는 비밀번호를 다시 확인해 주세요',
    signupFailed: '가입하지 못했어요. 이미 가입된 이메일인지 확인해 주세요',
    tokenMissing: '로그인에 실패했어요. 잠시 후 다시 시도해 주세요',
    serverUnreachable: '서버에 연결할 수 없어요. 네트워크와 서버 주소를 확인해 주세요',
    serverSlow: '서버 응답이 느려요. 일부 정보가 늦게 표시될 수 있어요',
    sessionExpired: '로그인 세션이 만료되었습니다. 다시 로그인해 주세요.',
    rateLimited: '요청이 너무 잦습니다. 1분 후 다시 시도해 주세요.',
    socialFailed: '소셜 로그인에 실패했습니다.',
    socialFailedDetail: '브라우저를 닫고 다시 시도해 주세요.',
    socialUnavailable: '준비 중입니다.',
    socialNoParams: '로그인 정보를 받지 못했습니다.',
    socialProgress: '로그인 처리 중입니다.',
    socialProgressSub: '잠시만 기다려 주세요.',
    signupSuccess: '가입이 완료되었습니다. MORA를 시작해 보세요.',
    nameChanged: '닉네임을 변경했습니다.',
    nameChangeFailed: '닉네임 변경에 실패했습니다.',
    expiryWarning: '로그인이 곧 만료됩니다. 저장하지 않은 스캔이 있다면 먼저 저장해 주세요.',
    submittingLogin: '로그인 중',
    submittingSignup: '가입 중',

    /** `socialSuccessMessage()` 의 템플릿 판. 함수 카피는 parity 가드 대상이 아니다(§index 가이드 3). */
    socialSuccess: '{provider}로 로그인했습니다.',
  },

  /* ─────────────────────────────────────────────────────────────────────
     chat — 원본: src/features/chat/store.ts `CHAT_COPY` (SCR-24)
     ───────────────────────────────────────────────────────────────────── */
  chat: {
    title: '모라냥 AI',
    greeting:
      '안녕하세요. MORA 챗봇 모라냥 AI입니다. 업로드, 검색, 일정 등록 관련해서 무엇이든 물어보세요.',
    typing: '답변 작성 중...',
    emptyAnswer: '관련 문서를 찾았지만 답변 내용이 비어 있어요.',
    noResult: '관련된 데이터를 찾을 수 없어 답변하기 어렵습니다. 다른 키워드로 검색해 보세요.',
    send: '전송',
    retry: '다시 시도',
    sessionExpired: '로그인 세션이 만료되었습니다. 다시 로그인해 주세요.',
    networkFailed: '백엔드 서버에 연결할 수 없습니다.',
    timeout: '답변이 오래 걸립니다. 잠시 후 다시 시도해 주세요.',
    sourceNotFound: '문서를 찾을 수 없습니다.',
    copied: '복사했습니다.',
    help: {
      title: '모라냥 AI 이용 안내',
      confirm: '확인',
      items: [
        '키워드만 입력하기보다 대화형 문장으로 질문해 주세요.',
        '저는 MORA의 문서 관리 기능(업로드, OCR, 보관함, 검색) 중심으로 안내해 드려요.',
        '실제 문서 인식 결과는 이미지 품질에 따라 달라질 수 있으니 저장 전 필드 값을 꼭 확인해 주세요.',
        '일정/연락처/금액 같은 중요 정보는 원본 이미지와 함께 최종 검토하는 것을 권장해요.',
        '입력한 대화 내용은 품질 개선과 오류 분석을 위해 서비스 정책에 따라 처리될 수 있어요.',
      ],
    },
    reset: {
      title: '대화 내용 초기화',
      body: '대화가 처음부터 다시 시작되며 이전 대화 내용은 복구할 수 없습니다. 초기화 하시겠습니까?',
      confirm: '초기화',
      cancel: '취소',
    },
  },

  /* ─────────────────────────────────────────────────────────────────────
     search — 원본: src/features/search/queries.ts `SEARCH_COPY` (SCR-23)
     ───────────────────────────────────────────────────────────────────── */
  search: {
    placeholder: '검색어를 입력하세요',
    guideTitle: '이렇게 찾아보세요',
    guideBody: '이름 일부, 회사명, 직책 등 기억나는 것만으로 찾을 수 있습니다.',
    loadingSlow: '검색 중...',
    emptyTitle: '조건에 맞는 결과가 없습니다.',
    emptyBody: '다른 키워드나 문서 유형으로 검색해 보세요.',
    failed: '검색에 실패했습니다.',
    offline: '오프라인입니다. 검색은 연결 후 가능합니다.',
    recentTitle: '최근 검색어',
    clearAll: '전체 삭제',
    historyTitle: '전체 기록 보기',
    historyFailed: '검색 기록을 불러오지 못했습니다.',
    historyClearFailed: '검색 기록 삭제에 실패했습니다.',
    sortRelevance: '관련도순',
    sortRecent: '최신순',

    /** 함수 카피의 템플릿 판 — `searchResultCountLabel` / `searchPartialFailureNotice` / `searchHistoryClearedMessage`. */
    resultCount: '{label} {count}건',
    partialFailure: '{labels} 검색에 실패했습니다.',
    historyCleared: '검색 기록 {count}건을 삭제했습니다.',
  },

  /* ─────────────────────────────────────────────────────────────────────
     notifications — 원본: src/features/notifications/api.ts `NOTIFICATION_COPY` (SCR-08)
     ───────────────────────────────────────────────────────────────────── */
  notifications: {
    screenTitle: '알림',
    markAllAction: '모두 읽음',
    listFailed: '알림을 불러오지 못했습니다.',
    retry: '다시 시도',
    emptyTitle: '알림이 없습니다',
    emptyCaption: '마감이 다가오면 알려드릴게요.',
    readFailed: '읽음 처리에 실패했습니다.',
    deleteFailed: '삭제에 실패했습니다.',
    refreshFailed: '새로고침에 실패했습니다.',
    typeLabel: {
      DEADLINE: '마감 임박',
      SCHEDULE: '일정 임박',
      GENERAL: '알림',
    },

    /** 함수 카피의 템플릿 판 — `markAllReadMessage`. */
    markAllRead: '알림 {count}건을 읽음으로 표시했습니다.',
  },

  /* ─────────────────────────────────────────────────────────────────────
     documents — 원본: src/features/scan/types.ts `TYPE_LABELS`
     (보관함/검색의 `DOCUMENT_TYPE_LABELS` · `SEARCH_DOC_TYPE_LABELS` 는 여기서 파생된 값이다)
     ───────────────────────────────────────────────────────────────────── */
  documents: {
    typeLabel: {
      BUSINESS_CARD: '명함',
      POSTER: '포스터',
      RECEIPT: '영수증',
      TICKET: '티켓',
      ETC: '기타',
      /** 검색 칩 전용 — `SEARCH_DOC_TYPE_LABELS.ALL`. */
      ALL: '전체',
    },
  },

  /* ─────────────────────────────────────────────────────────────────────
     account — 원본: src/features/account/schema.ts (SCR-27 · SCR-28 · SCR-29)
     ───────────────────────────────────────────────────────────────────── */
  account: {
    /** `PASSWORD_FORM_COPY` */
    password: {
      description: '보안을 위해 현재 비밀번호를 확인한 뒤 새 비밀번호를 설정합니다.',
      currentLabel: '현재 비밀번호',
      currentPlaceholder: '••••••••',
      newLabel: '새로운 비밀번호',
      newPlaceholder: '8자 이상',
      newHint: '8자 이상',
      confirmLabel: '새로운 비밀번호 확인',
      confirmPlaceholder: '한 번 더 입력',
      submit: '변경',
      submitting: '변경 중…',
      success: '비밀번호가 변경되었습니다. 다음 로그인부터 새 비밀번호를 사용하세요.',
      socialBlocked: '소셜 로그인(구글/카카오/네이버) 계정은 비밀번호를 변경할 수 없습니다.',
    },

    /** `DANGER_ZONE_COPY` */
    dangerZone: {
      screenTitle: '계정 및 데이터',
      documentsSection: '데이터 삭제',
      documentsCardTitle: '내 데이터 전체 삭제',
      documentsCardBody:
        '저장한 명함, 티켓, 포스터, 영수증과 검색 기록이 삭제됩니다. 구글 캘린더 연동 자체는 유지됩니다.',
      documentsAction: '전체 삭제',
      documentsSheetTitle: '내 데이터 전체를 삭제할까요?',
      documentsConfirmLabel: '확인 문구',
      documentsConfirmHint: '계속하려면 "전체삭제"를 정확히 입력하세요.',
      accountSection: '회원 탈퇴',
      accountCardTitle: '정말 탈퇴하시겠어요?',
      accountCardBody: '이 작업은 되돌릴 수 없습니다. 저장된 계정과 서비스 데이터가 삭제됩니다.',
      accountAction: '회원 탈퇴',
      accountLocalBody: '이 작업은 되돌릴 수 없습니다. 계속하려면 계정 비밀번호를 입력하세요.',
      accountSocialBody: '이 작업은 되돌릴 수 없습니다. 저장된 계정과 서비스 데이터가 삭제됩니다.',
      accountConfirmAction: '탈퇴',
      accountSuccess: '회원 탈퇴가 완료되었습니다.',
      cancel: '취소',
      submitting: '삭제 중...',
      passwordInvalid: '비밀번호가 올바르지 않습니다.',
    },

    /** `NOTIFICATION_SETTINGS_COPY` */
    notificationSettings: {
      screenTitle: '알림 설정',
      notice: '알림은 앱 안에서 확인할 수 있습니다. 기기 푸시 알림은 준비 중입니다.',
      typeSection: '알림 종류',
      deadlineTitle: '마감 임박 알림',
      deadlineCaption: '포스터 행사 마감이 다가오면 알려드립니다.',
      scheduleTitle: '일정 임박 알림',
      scheduleCaption: '티켓 출발일이 다가오면 알려드립니다.',
      timingSection: '알림 시점',
      daysTitle: '며칠 전부터 알림 받기',
      footer: '알림은 매일 오전 9시에 확인합니다.',
      loadFailed: '알림 설정을 불러오지 못했습니다.',
      saveFailed: '알림 설정을 저장하지 못했습니다.',
      retry: '다시 시도',
      entryCaption: '마감·일정 알림 수신 방식을 설정합니다.',

      /** 함수 카피의 템플릿 판 — `deadlineDaysCaption`. */
      deadlineDaysCaption: '마감 {days}일 전부터 알림을 받습니다.',
    },
  },
} as const;

export type KoCatalog = typeof ko;
