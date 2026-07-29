/**
 * 목 모드 씨드 데이터.
 *
 * 규칙 4가지
 *  1. **행(row)의 모양 = 서버 응답 DTO 의 모양**이다. 핸들러가 가공 없이 그대로 내보낼 수 있어야
 *     `features/*` 의 파서(`documents/mappers.ts` 등)를 한 글자도 우회하지 않는다.
 *  2. 날짜는 **고정 문자열이 아니라 실행 시점 기준 상대값**이다. 그래야 `마감 임박`·`오늘 일정`이
 *     몇 달 뒤에 앱을 켜도 살아 있다. 씨드가 만들어진 날짜는 `seededOn` 에 남기고, 사용자가
 *     아무것도 고치지 않은 상태로 날이 바뀌면 `db.ts` 가 조용히 다시 씨딩한다.
 *  3. 이미지가 없다. `imageUrl` 은 전부 `''` 이며 화면은 이미 종별 플레이스홀더로 폴백한다.
 *     티켓·포스터·영수증은 실서버와 똑같이 `parsedJson` 문자열 **안에** `imageUrl` 을 넣는다
 *     (API Contract §4-6 — 앱의 `imageUrlFromParsedJson` 이 그 경로를 되짚는다).
 *  4. 알림 본문에 서버 결함(`남았습니다입니다`)을 **재현하지 않는다.** 정상 문구로 둔다.
 */

// ───────────────────────────────────────────────────────────── 식별자

/** RFC4122 v4 모양의 문자열. 목이라 암호학적 품질은 필요 없다. */
export function uuid(): string {
  const hex = (digits: number): string =>
    Math.floor(Math.random() * 16 ** digits)
      .toString(16)
      .padStart(digits, '0');
  const variant = '89ab'[Math.floor(Math.random() * 4)] ?? 'a';
  return `${hex(8)}-${hex(4)}-4${hex(3)}-${variant}${hex(3)}-${hex(12)}`;
}

// ───────────────────────────────────────────────────────────── 날짜 유틸

const pad = (value: number, length = 2): string => String(value).padStart(length, '0');

/** 기기 로컬 기준 `YYYY-MM-DD`. `toISOString()` 은 UTC 로 밀리므로 쓰지 않는다. */
export function localDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** `HH:MM`. 서버 `LocalTime.toString()` 이 초가 0 이면 분까지만 준다. */
export function localTime(date: Date): string {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * 서버 `LocalDateTime` 직렬화 모양 — `"2026-07-28T05:06:26.192228"`.
 * 타임존 표기가 없고 마이크로초 6자리가 붙는다(실측). 앱은 이걸 로컬 시각으로 해석한다.
 */
export function localDateTime(date: Date): string {
  const micro = `${pad(date.getMilliseconds(), 3)}${pad(Math.floor(Math.random() * 1000), 3)}`;
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${micro}`
  );
}

/** 지금 시각의 `LocalDateTime` 문자열. */
export const nowDateTime = (): string => localDateTime(new Date());

/** 오늘의 `LocalDate` 문자열. */
export const todayDate = (): string => localDate(new Date());

export function shiftDays(base: Date, days: number): Date {
  const next = new Date(base.getTime());
  next.setDate(next.getDate() + days);
  return next;
}

function at(base: Date, days: number, hour: number, minute: number): Date {
  const next = shiftDays(base, days);
  next.setHours(hour, minute, 0, 0);
  return next;
}

/** N일 뒤 날짜(`YYYY-MM-DD`). 음수면 과거. */
const dayOffset = (base: Date, days: number): string => localDate(shiftDays(base, days));

/** N시간/분 전 시각(`LocalDateTime`). 알림 상대시각(`3시간 전`)을 만들기 위한 것. */
const minutesAgo = (base: Date, minutes: number): string =>
  localDateTime(new Date(base.getTime() - minutes * 60_000));

// ───────────────────────────────────────────────────────────── 행 타입

export type MockProvider = 'local' | 'google' | 'kakao' | 'naver';

export type MockUser = {
  id: string;
  email: string;
  name: string;
  /** 소셜 계정만 값이 있다. 로컬은 `null`. */
  picture: string | null;
  provider: MockProvider;
  createdAt: string;
};

/** `CardResponse` 그대로. 4종 중 유일하게 `imageUrl` 이 정식 컬럼이고 `updatedAt` 이 없다. */
export type MockCard = {
  id: string;
  name: string;
  company: string;
  position: string;
  phone: string;
  email: string;
  rawOcrText: string;
  imageUrl: string;
  groupId: string | null;
  createdAt: string;
};

export type MockPoster = {
  id: number;
  docType: 'POSTER';
  classificationConfidence: number;
  title: string;
  organizerName: string;
  eventStartDate: string;
  eventEndDate: string;
  contactPhone: string;
  contactEmail: string;
  location: string;
  fee: string;
  websiteUrl: string;
  /** 응답은 공백 JOIN 문자열이다(요청만 배열 — API Contract §4-7). */
  description: string;
  rawText: string;
  parsedJson: string;
  rawJson: string;
  createdAt: string;
  updatedAt: string;
};

export type MockTicket = {
  id: number;
  docType: 'TICKET';
  classificationConfidence: number;
  transportType: string;
  departureLocation: string;
  departureDate: string;
  departureTime: string;
  arrivalLocation: string;
  arrivalDate: string;
  arrivalTime: string;
  rawText: string;
  parsedJson: string;
  rawJson: string;
  createdAt: string;
  updatedAt: string;
};

export type MockReceiptItem = {
  id: number;
  itemName: string;
  quantity: number | null;
  unitPrice: number | null;
  totalPrice: number | null;
  category: string | null;
  createdAt: string;
};

export type MockReceipt = {
  id: number;
  docType: 'RECEIPT';
  classificationConfidence: number;
  merchantName: string;
  merchantAddress: string;
  purchaseDate: string;
  purchaseTime: string;
  paymentMethod: string;
  cardCompany: string;
  totalAmount: number | null;
  currencyCode: string;
  items: MockReceiptItem[];
  rawText: string;
  parsedJson: string;
  rawJson: string;
  createdAt: string;
  updatedAt: string;
};

export type MockCardGroup = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
};

export type MockNotificationType = 'DEADLINE' | 'SCHEDULE' | 'GENERAL';

export type MockNotification = {
  id: string;
  type: MockNotificationType;
  title: string;
  message: string;
  linkUrl: string;
  /** 서버는 `readAt != null` 로 파생시킨다. 두 값이 어긋나는 조합을 만들지 않는다. */
  read: boolean;
  readAt: string | null;
  createdAt: string;
};

export type MockSearchHistory = {
  id: string;
  /** 서버가 검색 API 호출마다 적립하는 값. 검색 엔드포인트 1개당 1행이다. */
  documentType: string;
  query: string;
  createdAt: string;
};

export type MockNotificationSettings = {
  deadlineReminderDays: number;
  deadlineReminderEnabled: boolean;
  scheduleReminderEnabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export type MockCalendar = {
  connected: boolean;
  googleEmail: string;
  expiresAt: string;
  scope: string;
};

export type MockSession = {
  token: string;
  userId: string;
  issuedAt: string;
};

/** MMKV `mock.db` 에 통째로 직렬화되는 인메모리 DB 전체. */
export type MockData = {
  /** 스키마 버전. 올리면 기존 영속 데이터를 버리고 다시 씨딩한다. */
  version: number;
  /** 씨드를 만든 날(`YYYY-MM-DD`). 날짜가 바뀌고 `dirty` 가 false 면 재씨딩한다. */
  seededOn: string;
  /** 사용자가 목 데이터를 한 번이라도 바꿨는가. true 면 자동 재씨딩하지 않는다. */
  dirty: boolean;
  user: MockUser;
  /** 마지막으로 설정된 비밀번호. 목은 8자 이상이면 전부 통과시키므로 표시·비교용일 뿐이다. */
  password: string;
  session: MockSession | null;
  cards: MockCard[];
  posters: MockPoster[];
  tickets: MockTicket[];
  receipts: MockReceipt[];
  cardGroups: MockCardGroup[];
  notifications: MockNotification[];
  searchHistories: MockSearchHistory[];
  notificationSettings: MockNotificationSettings;
  calendar: MockCalendar;
  /** IDENTITY PK 시퀀스. 포스터·티켓·영수증은 Integer 다. */
  seq: { poster: number; ticket: number; receipt: number; receiptItem: number };
};

export const MOCK_DB_VERSION = 1;

// ───────────────────────────────────────────────────────────── 조립 헬퍼

/**
 * 티켓·포스터·영수증의 `parsedJson`.
 * 실서버 저장 경로(`scan/api.ts buildSaveBody`)와 **같은 모양**으로 만든다 —
 * OCR 필드맵(snake_case) + `imageUrl`. 이미지가 없으므로 `imageUrl` 은 빈 문자열이다.
 */
const parsedJsonOf = (fields: Record<string, string>): string =>
  JSON.stringify({ ...fields, imageUrl: '' });

/** OCR 블록 원본. 화면이 쓰지 않으므로 빈 배열로 둔다. */
const RAW_JSON = '[]';

// ───────────────────────────────────────────────────────────── 씨드

/**
 * 씨드 1벌을 만든다. **호출 시점의 날짜**를 기준으로 모든 날짜가 계산된다.
 *
 * 살아 있어야 하는 것 3가지 (화면 확인용):
 *  - 포스터 2건이 마감 임박 (오늘+3일 / 오늘+7일) → 홈 마감 캐러셀 · 알림
 *  - 티켓 1건이 오늘 출발                        → 홈 `오늘 일정`
 *  - 영수증 1건이 오늘 결제                      → 최근 항목
 */
export function createSeed(): MockData {
  const now = new Date();
  const today = localDate(now);

  /** 가입 시각. 사용자 행과 알림설정 행이 같은 순간에 만들어진다(서버가 `findOrCreate` 한다). */
  const joinedAt = localDateTime(shiftDays(now, -64));
  const user: MockUser = {
    id: uuid(),
    email: 'mock@mora.dev',
    name: '모라테스터',
    picture: null,
    provider: 'local',
    createdAt: joinedAt,
  };

  // ── 명함 그룹 3개 (createdAt ASC 로 내려간다)
  // `localDateTime` 은 마이크로초 꼬리가 매번 달라지므로 한 번 만들어 두 필드에 같이 쓴다 —
  // 수정한 적 없는 행의 `updatedAt` 이 `createdAt` 과 어긋나면 그것만으로 가짜 티가 난다.
  const group = (name: string, days: number): MockCardGroup => {
    const at = localDateTime(shiftDays(now, days));
    return { id: uuid(), name, createdAt: at, updatedAt: at };
  };
  const groupPartner = group('협력사', -60);
  const groupConference = group('컨퍼런스', -41);
  const groupClient = group('고객사', -22);

  // ── 명함 8건. 3건 미분류로 남겨 `미분류` 칩도 비어 보이지 않게 한다.
  const cardSeed: {
    name: string;
    company: string;
    position: string;
    phone: string;
    email: string;
    address: string;
    groupId: string | null;
    days: number;
  }[] = [
    {
      name: '김도현',
      company: '(주)카카오엔터프라이즈',
      position: '클라우드사업본부 책임매니저',
      phone: '010-2841-7734',
      email: 'dohyun.kim@kakaoenterprise.com',
      address: '경기도 성남시 분당구 판교역로 235 에이치스퀘어 N동 6층',
      groupId: groupPartner.id,
      days: -38,
    },
    {
      name: '박서연',
      company: '네이버클라우드(주)',
      position: 'AI서비스기획팀 팀장',
      phone: '010-3392-5518',
      email: 'seoyeon.park@navercorp.com',
      address: '경기도 성남시 분당구 불정로 6 그린팩토리 12층',
      groupId: groupPartner.id,
      days: -33,
    },
    {
      name: '이준호',
      company: '삼성SDS',
      position: '스마트팩토리사업부 수석',
      phone: '010-7726-1043',
      email: 'junho.lee@samsung.com',
      address: '서울특별시 송파구 올림픽로35길 125 삼성SDS타워',
      groupId: groupClient.id,
      days: -27,
    },
    {
      name: '최민서',
      company: '(주)우아한형제들',
      position: '프론트엔드 개발자',
      phone: '010-4417-2280',
      email: 'minseo.choi@woowahan.com',
      address: '서울특별시 송파구 위례성대로 2 장은빌딩',
      groupId: groupConference.id,
      days: -19,
    },
    {
      name: '정하윤',
      company: '토스페이먼츠(주)',
      position: '가맹점영업팀 대리',
      phone: '010-9083-6612',
      email: 'hayoon.jung@tosspayments.com',
      address: '서울특별시 강남구 테헤란로 142 아크플레이스 12층',
      groupId: groupClient.id,
      days: -14,
    },
    {
      name: '한지우',
      company: 'LG CNS',
      position: 'DX컨설팅팀 선임',
      phone: '010-5561-8827',
      email: 'jiwoo.han@lgcns.com',
      address: '서울특별시 강서구 마곡중앙8로 71',
      groupId: null,
      days: -9,
    },
    {
      name: '오세훈',
      company: '현대오토에버(주)',
      position: '모빌리티플랫폼실 책임연구원',
      phone: '010-2274-9915',
      email: 'sehun.oh@hyundai-autoever.com',
      address: '서울특별시 강남구 테헤란로 510 성보빌딩',
      groupId: null,
      days: -5,
    },
    {
      name: '서예린',
      company: '(주)당근',
      position: '커뮤니티운영팀 매니저',
      phone: '010-6638-3391',
      email: 'yerin.seo@daangn.com',
      address: '서울특별시 서초구 강남대로 465 교보타워 8층',
      groupId: groupConference.id,
      days: -2,
    },
  ];

  const cards: MockCard[] = cardSeed.map((seed) => ({
    id: uuid(),
    name: seed.name,
    company: seed.company,
    position: seed.position,
    phone: seed.phone,
    email: seed.email,
    // OCR 원문은 명함에 인쇄된 순서대로 개행 JOIN 된다(`buildSaveBody` 와 같은 규칙).
    rawOcrText: [
      seed.company,
      `${seed.name} ${seed.position}`,
      `M. ${seed.phone}`,
      `T. 02-${1000 + Math.floor(Math.random() * 8999)}-${1000 + Math.floor(Math.random() * 8999)}`,
      `E. ${seed.email}`,
      seed.address,
    ].join('\n'),
    imageUrl: '',
    groupId: seed.groupId,
    createdAt: localDateTime(shiftDays(now, seed.days)),
  }));

  // ── 포스터 4건. 2건은 마감 임박(오늘+3 / 오늘+7).
  const posterSeed: {
    title: string;
    organizerName: string;
    startOffset: number;
    endOffset: number;
    contactPhone: string;
    contactEmail: string;
    location: string;
    fee: string;
    websiteUrl: string;
    description: string;
    createdOffset: number;
  }[] = [
    {
      title: '2026 서울 AI 개발자 컨퍼런스',
      organizerName: '한국지능정보사회진흥원',
      startOffset: 3,
      endOffset: 4,
      contactPhone: '02-2131-0114',
      contactEmail: 'devcon@nia.or.kr',
      location: '서울 강남구 코엑스 그랜드볼룸',
      fee: '사전등록 무료 / 현장등록 20,000원',
      websiteUrl: 'https://devcon.nia.or.kr',
      description: '온디바이스 AI와 RAG 실전 사례를 다루는 개발자 대상 컨퍼런스입니다. 사전등록 마감이 임박했습니다.',
      createdOffset: -11,
    },
    {
      title: '제12회 대학생 창업 아이디어 공모전',
      organizerName: '중소벤처기업부',
      startOffset: 7,
      endOffset: 7,
      contactPhone: '044-204-7300',
      contactEmail: 'startup@mss.go.kr',
      location: '온라인 접수 (K-스타트업 누리집)',
      fee: '무료',
      websiteUrl: 'https://www.k-startup.go.kr',
      description: '예비창업 단계 대학생 팀을 대상으로 하는 아이디어 공모전입니다. 접수 마감일까지 사업계획서를 제출해 주세요.',
      createdOffset: -8,
    },
    {
      title: '판교 오픈소스 페스티벌 2026',
      organizerName: '오픈소스소프트웨어재단',
      startOffset: 21,
      endOffset: 22,
      contactPhone: '031-8016-9500',
      contactEmail: 'contact@ossfestival.kr',
      location: '경기 성남시 분당구 판교 스타트업캠퍼스 1관',
      fee: '5,000원 (학생 무료)',
      websiteUrl: 'https://ossfestival.kr',
      description: '국내 오픈소스 메인테이너 40여 명이 참여하는 이틀간의 기술 축제입니다.',
      createdOffset: -6,
    },
    {
      title: '국립현대미술관 기획전 «빛과 시간»',
      organizerName: '국립현대미술관',
      startOffset: -5,
      endOffset: 45,
      contactPhone: '02-3701-9500',
      contactEmail: 'visit@mmca.go.kr',
      location: '서울 종로구 삼청로 30 국립현대미술관 서울관 제3전시실',
      fee: '4,000원',
      websiteUrl: 'https://www.mmca.go.kr',
      description: '1970년대 이후 한국 미디어아트를 조명하는 기획전입니다. 매주 월요일 휴관.',
      createdOffset: -3,
    },
  ];

  const posters: MockPoster[] = posterSeed.map((seed, index) => {
    const startDate = dayOffset(now, seed.startOffset);
    const endDate = dayOffset(now, seed.endOffset);
    const createdAt = localDateTime(shiftDays(now, seed.createdOffset));
    const fields = {
      title: seed.title,
      organizer_name: seed.organizerName,
      event_start_date: startDate,
      event_end_date: endDate,
      contact_phone: seed.contactPhone,
      contact_email: seed.contactEmail,
      location: seed.location,
      fee: seed.fee,
      website_url: seed.websiteUrl,
      description: seed.description,
    };
    return {
      id: index + 1,
      docType: 'POSTER',
      classificationConfidence: 0.93 - index * 0.04,
      title: seed.title,
      organizerName: seed.organizerName,
      eventStartDate: startDate,
      eventEndDate: endDate,
      contactPhone: seed.contactPhone,
      contactEmail: seed.contactEmail,
      location: seed.location,
      fee: seed.fee,
      websiteUrl: seed.websiteUrl,
      description: seed.description,
      rawText: [
        seed.title,
        `주최 ${seed.organizerName}`,
        `${startDate} ~ ${endDate}`,
        seed.location,
        `참가비 ${seed.fee}`,
        `문의 ${seed.contactPhone}`,
        seed.websiteUrl,
      ].join(' '),
      parsedJson: parsedJsonOf(fields),
      rawJson: RAW_JSON,
      createdAt,
      updatedAt: createdAt,
    };
  });

  // ── 티켓 3건. 1건은 오늘 출발.
  const ticketSeed: {
    transportType: string;
    departureLocation: string;
    arrivalLocation: string;
    dayOffsetValue: number;
    departureTime: string;
    arrivalTime: string;
    detail: string;
    createdOffset: number;
  }[] = [
    {
      transportType: 'KTX',
      departureLocation: '서울',
      arrivalLocation: '부산',
      dayOffsetValue: 0,
      departureTime: '07:20',
      arrivalTime: '09:55',
      detail: '일반실 4호차 12A 59,800원',
      createdOffset: -7,
    },
    {
      transportType: 'SRT',
      departureLocation: '수서',
      arrivalLocation: '동대구',
      dayOffsetValue: 5,
      departureTime: '06:40',
      arrivalTime: '08:22',
      detail: '일반실 2호차 7C 39,500원',
      createdOffset: -4,
    },
    {
      transportType: '고속버스',
      departureLocation: '센트럴시티(서울)',
      arrivalLocation: '광주 유스퀘어',
      dayOffsetValue: 12,
      departureTime: '14:30',
      arrivalTime: '17:40',
      detail: '우등 3열 11번 23,100원',
      createdOffset: -1,
    },
  ];

  const tickets: MockTicket[] = ticketSeed.map((seed, index) => {
    const date = dayOffset(now, seed.dayOffsetValue);
    const createdAt = localDateTime(shiftDays(now, seed.createdOffset));
    const fields = {
      transport_type: seed.transportType,
      departure_location: seed.departureLocation,
      departure_date: date,
      departure_time: seed.departureTime,
      arrival_location: seed.arrivalLocation,
      arrival_date: date,
      arrival_time: seed.arrivalTime,
    };
    return {
      id: index + 1,
      docType: 'TICKET',
      classificationConfidence: 0.96 - index * 0.05,
      transportType: seed.transportType,
      departureLocation: seed.departureLocation,
      departureDate: date,
      departureTime: seed.departureTime,
      arrivalLocation: seed.arrivalLocation,
      arrivalDate: date,
      arrivalTime: seed.arrivalTime,
      rawText: [
        `${seed.transportType} 승차권`,
        `${seed.departureLocation} → ${seed.arrivalLocation}`,
        `${date} ${seed.departureTime} 출발 ${seed.arrivalTime} 도착`,
        seed.detail,
      ].join(' '),
      parsedJson: parsedJsonOf(fields),
      rawJson: RAW_JSON,
      createdAt,
      updatedAt: createdAt,
    };
  });

  // ── 영수증 3건. 1건은 오늘 결제.
  const receiptSeed: {
    merchantName: string;
    merchantAddress: string;
    dayOffsetValue: number;
    purchaseTime: string;
    paymentMethod: string;
    cardCompany: string;
    totalAmount: number;
    items: { itemName: string; quantity: number; unitPrice: number; category: string }[];
    createdOffset: number;
  }[] = [
    {
      merchantName: '스타벅스 판교역점',
      merchantAddress: '경기 성남시 분당구 판교역로 152',
      dayOffsetValue: -1,
      purchaseTime: '09:12',
      paymentMethod: '신용카드',
      cardCompany: '신한카드',
      totalAmount: 12300,
      items: [
        { itemName: '아이스 카페 아메리카노 T', quantity: 2, unitPrice: 4500, category: '음료' },
        { itemName: '클래식 스콘', quantity: 1, unitPrice: 3300, category: '베이커리' },
      ],
      createdOffset: -1,
    },
    {
      merchantName: '한솥도시락 역삼점',
      merchantAddress: '서울 강남구 테헤란로 132 지하 1층',
      dayOffsetValue: -3,
      purchaseTime: '12:41',
      paymentMethod: '신용카드',
      cardCompany: 'KB국민카드',
      totalAmount: 18500,
      items: [
        { itemName: '치킨마요 도시락', quantity: 2, unitPrice: 4300, category: '식사' },
        { itemName: '돈까스 도시락', quantity: 1, unitPrice: 5900, category: '식사' },
        { itemName: '미소된장국', quantity: 2, unitPrice: 2000, category: '식사' },
      ],
      createdOffset: -3,
    },
    {
      merchantName: 'GS25 역삼중앙점',
      merchantAddress: '서울 강남구 논현로 402',
      dayOffsetValue: 0,
      purchaseTime: '21:05',
      paymentMethod: '신용카드',
      cardCompany: '현대카드',
      totalAmount: 7800,
      items: [
        { itemName: '삼각김밥 참치마요', quantity: 2, unitPrice: 1300, category: '간편식' },
        { itemName: '컵라면 신라면', quantity: 1, unitPrice: 1500, category: '간편식' },
        { itemName: '아메리카노 캔', quantity: 2, unitPrice: 1850, category: '음료' },
      ],
      createdOffset: 0,
    },
  ];

  let receiptItemSeq = 0;
  const receipts: MockReceipt[] = receiptSeed.map((seed, index) => {
    const date = dayOffset(now, seed.dayOffsetValue);
    const createdAt = localDateTime(shiftDays(now, seed.createdOffset));
    const fields = {
      store_name: seed.merchantName,
      merchant_address: seed.merchantAddress,
      purchase_date: date,
      purchase_time: seed.purchaseTime,
      payment_method: seed.paymentMethod,
      card_company: seed.cardCompany,
      total_amount: String(seed.totalAmount),
      currency_code: 'KRW',
    };
    return {
      id: index + 1,
      docType: 'RECEIPT',
      classificationConfidence: 0.91 - index * 0.03,
      merchantName: seed.merchantName,
      merchantAddress: seed.merchantAddress,
      purchaseDate: date,
      purchaseTime: seed.purchaseTime,
      paymentMethod: seed.paymentMethod,
      cardCompany: seed.cardCompany,
      totalAmount: seed.totalAmount,
      currencyCode: 'KRW',
      items: seed.items.map((item) => {
        receiptItemSeq += 1;
        return {
          id: receiptItemSeq,
          itemName: item.itemName,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          totalPrice: item.quantity * item.unitPrice,
          category: item.category,
          createdAt,
        };
      }),
      rawText: [
        seed.merchantName,
        seed.merchantAddress,
        `${date} ${seed.purchaseTime}`,
        ...seed.items.map((item) => `${item.itemName} ${item.quantity} ${item.unitPrice}`),
        `합계 ${seed.totalAmount.toLocaleString('ko-KR')}원`,
        `${seed.cardCompany} 일시불`,
      ].join(' '),
      parsedJson: parsedJsonOf(fields),
      rawJson: RAW_JSON,
      createdAt,
      updatedAt: createdAt,
    };
  });

  // ── 알림 6건 (미읽음 4 / 읽음 2). 서버 문구 결함은 재현하지 않는다.
  const firstPoster = posters[0];
  const secondPoster = posters[1];
  const firstTicket = tickets[0];
  const secondTicket = tickets[1];

  const notifications: MockNotification[] = [
    {
      id: uuid(),
      type: 'SCHEDULE',
      title: '일정 임박',
      message: `${firstTicket?.departureLocation ?? '서울'} → ${
        firstTicket?.arrivalLocation ?? '부산'
      } 일정이 오늘입니다.`,
      linkUrl: '/dashboard/storage/tickets',
      read: false,
      readAt: null,
      createdAt: minutesAgo(now, 35),
    },
    {
      id: uuid(),
      type: 'DEADLINE',
      title: '마감 임박',
      message: `${firstPoster?.title ?? '행사'} 마감이 3일 남았습니다.`,
      linkUrl: '/dashboard/storage/posters',
      read: false,
      readAt: null,
      createdAt: minutesAgo(now, 2 * 60 + 12),
    },
    {
      id: uuid(),
      type: 'DEADLINE',
      title: '마감 임박',
      message: `${secondPoster?.title ?? '공모전'} 마감이 7일 남았습니다.`,
      linkUrl: '/dashboard/storage/posters',
      read: false,
      readAt: null,
      createdAt: minutesAgo(now, 5 * 60 + 41),
    },
    {
      id: uuid(),
      type: 'GENERAL',
      title: '알림',
      message: '명함 8건을 보관함에 저장했습니다.',
      linkUrl: '',
      read: false,
      readAt: null,
      createdAt: localDateTime(at(now, -1, 18, 24)),
    },
    {
      id: uuid(),
      type: 'SCHEDULE',
      title: '일정 임박',
      message: `${secondTicket?.departureLocation ?? '수서'} → ${
        secondTicket?.arrivalLocation ?? '동대구'
      } 일정이 5일 남았습니다.`,
      linkUrl: '/dashboard/storage/tickets',
      read: true,
      readAt: localDateTime(at(now, -1, 9, 2)),
      createdAt: localDateTime(at(now, -2, 8, 30)),
    },
    {
      id: uuid(),
      type: 'GENERAL',
      title: '알림',
      message: '보관함 정리를 완료했습니다.',
      linkUrl: '',
      read: true,
      readAt: localDateTime(at(now, -3, 21, 11)),
      createdAt: localDateTime(at(now, -3, 20, 47)),
    },
  ];

  // ── 검색 기록 5건 (서버는 검색 엔드포인트 1회 호출당 1행을 남긴다)
  const searchHistories: MockSearchHistory[] = [
    { documentType: 'BUSINESS_CARD', query: '김도현', minutes: 48 },
    { documentType: 'BUSINESS_CARD', query: '카카오', minutes: 63 },
    { documentType: 'TICKET', query: '부산', minutes: 190 },
    { documentType: 'POSTER', query: '컨퍼런스', minutes: 1_450 },
    { documentType: 'RECEIPT', query: '스타벅스', minutes: 2_980 },
  ].map((seed) => ({
    id: uuid(),
    documentType: seed.documentType,
    query: seed.query,
    createdAt: minutesAgo(now, seed.minutes),
  }));

  return {
    version: MOCK_DB_VERSION,
    seededOn: today,
    dirty: false,
    user,
    password: 'mockmock',
    session: null,
    cards,
    posters,
    tickets,
    receipts,
    cardGroups: [groupPartner, groupConference, groupClient],
    notifications,
    searchHistories,
    notificationSettings: {
      deadlineReminderDays: 3,
      deadlineReminderEnabled: true,
      scheduleReminderEnabled: true,
      createdAt: joinedAt,
      updatedAt: joinedAt,
    },
    calendar: {
      // 연동된 상태로 시작한다 — 설정 화면의 `연동됨` 행과 해제 흐름을 바로 볼 수 있다.
      connected: true,
      googleEmail: 'mora.mock@gmail.com',
      expiresAt: localDateTime(new Date(now.getTime() + 50 * 60_000)),
      scope: 'https://www.googleapis.com/auth/calendar.events',
    },
    seq: {
      poster: posters.length,
      ticket: tickets.length,
      receipt: receipts.length,
      receiptItem: receiptItemSeq,
    },
  };
}
