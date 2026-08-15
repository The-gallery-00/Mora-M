# ═══════════════════════════════════════════════════════════════
# src/classifier/rule_based.py — 규칙 기반 텍스트 분류기
# ═══════════════════════════════════════════════════════════════
#
# [역할]
# OCR로 추출된 텍스트 블록들을 정규식과 휴리스틱 규칙으로 분류하여
# 문서 종류별 필드에 매핑한다.
# 머신러닝 모델 없이 순수 규칙 기반으로 동작하므로 속도가 빠르고
# 분류 기준이 투명하다.
#
# [코드 흐름]
# 1) 모듈 로드 시 정규식 패턴(이메일, 전화, 팩스 등)을 compile한다
# 2) classify_all_blocks_for_type() 호출 시 문서 종류에 따라 분기:
#    a) BUSINESS_CARD → classify_all_blocks() (2-pass 분류)
#    b) POSTER → classify_text_block_for_poster()
#    c) RECEIPT → classify_text_block_for_receipt()
#    d) TICKET → classify_text_block_for_ticket()
#    e) ETC → 모든 블록 unknown
#
# [메서드 목록]
# - classify_text_block(text, all_blocks, block_index):
#     단일 텍스트 블록을 명함 스키마 필드로 분류.
# - classify_text_block_for_poster(text):
#     포스터용 단일 텍스트 블록 분류.
# - classify_text_block_for_receipt(text):
#     영수증용 단일 텍스트 블록 분류.
# - classify_text_block_for_ticket(text):
#     티켓용 단일 텍스트 블록 분류.
# - extract_clean_value(text, field):
#     분류된 필드에서 해당 값만 정규식으로 추출 (노이즈 제거).
# - _split_multi_number_blocks(text_blocks):
#     하나의 텍스트 블록에 2개 이상의 전화번호가 포함된 경우
#     각각 별도 블록으로 분리하는 전처리.
# - classify_all_blocks_for_type(text_blocks, document_type):
#     문서 종류에 따라 적절한 분류 함수를 선택하여 전체 블록 분류.
# - classify_all_blocks(text_blocks):
#     명함 전용. 전처리 → 2-pass 분류 → 값 추출.
#
# [사용된 라이브러리]
# ───────────────────────────────────────────
# re.compile(pattern)
#   정규식 문자열을 패턴 객체(re.Pattern)로 변환함.
#   같은 패턴을 반복 사용할 때 compile()로 미리 만들어두면
#   호출마다 패턴을 새로 파싱하지 않고 객체를 재사용할 수 있음.
# ───────────────────────────────────────────
# pattern.search(text)
#   문자열 전체를 훑으며 패턴을 탐색함.
#   패턴이 발견되면 Match 객체, 없으면 None 반환.
# ───────────────────────────────────────────
# pattern.match(text)
#   문자열의 **시작 부분**부터 패턴 매칭을 시도한다.
# ───────────────────────────────────────────
# pattern.finditer(text)
#   문자열에서 패턴과 일치하는 모든 위치를 이터레이터로 반환.
# ───────────────────────────────────────────
#
# ═══════════════════════════════════════════════════════════════

"""
규칙 기반 분류기: 정규식 + 휴리스틱으로 텍스트 블록을 스키마 필드에 매핑.
"""
from __future__ import annotations

import re

# ========== 공통 패턴 ==========

# 이메일: 영어와 @ . 으로 이루어져있음
EMAIL_PATTERN = re.compile(r"[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+(?:\.[a-zA-Z]{2,})+")

# 휴대폰: 010-xxxx-xxxx, 01x-xxx-xxxx
MOBILE_PATTERN = re.compile(r"01[016789][-.\s]?\d{3,4}[-.\s]?\d{4}")

# 일반 전화 / 팩스: 02-xxx-xxxx, 0xx-xxx-xxxx
# 지역번호 부분이 `0\d{1,2}` 이면 **안심번호(0505/0504/0507/0506)가 잘린다.**
# 실측: "0505-123-4567" → "05-123-4567", "0507-1234-5678" → "07-1234-5678".
# 미매치가 아니라 **앞 두 자리를 잃은 값이 그대로 저장**되는 것이 문제다 —
# 걸려온 번호를 다시 걸 수 없는 값이 DB 에 들어간다.
# 050X 국번을 먼저 시도하고(교대는 왼쪽 우선), 실패하면 종전 2~3자리 지역번호로 떨어진다.
LANDLINE_PATTERN = re.compile(r"(?:050\d|0\d{1,2})[-.\s]?\d{3,4}[-.\s]?\d{4}")

# 값 추출 전용(분류 아님): 괄호 지역번호 "(055)366-0762" 도 잡는 느슨한 전화 패턴.
# extract_clean_value 에서 라벨/괄호가 섞인 원문에서 번호만 뽑을 때 사용.
_PHONE_LOOSE = re.compile(r"\(?0\d{1,2}\)?[-.\s]?\d{3,4}[-.\s]?\d{4}")

# 국제표기 한국 전화: "+82 53-000-0000", "+82(0) 53 754 7534", "+82-10-1234-5678".
# +82 가 국내 trunk '0' 을 대체(또는 "(0)" 으로 병기)하므로 패턴/분류/정규화가 모두
# 미스 → 국내표기(0 으로 시작)로 환원해야 기존 MOBILE/LANDLINE/LOOSE 가 그대로 동작.
_INTL_KR_PREFIX = re.compile(r"\+\s*82[\s().\-]*0?[\s().\-]*(?=\d)")


def _intl_to_domestic(text: str) -> str:
    """문자열 내 '+82[ (0) ]' 국제표기 한국전화 prefix 를 국내 trunk '0' 으로 환원.
    예) '+82 53-000-0000'→'053-000-0000', '+82(0) 53 754 7534'→'053 754 7534',
        '+82-10-1234-5678'→'010-1234-5678'. 한국전화 외 텍스트는 영향 없음."""
    return _INTL_KR_PREFIX.sub("0", text)

# 팩스 키워드
FAX_KEYWORDS = re.compile(r"(?i)(fax|팩스|f\s*[:.]|FAX\s*[:.)])")

# 전화 키워드
PHONE_KEYWORDS = re.compile(r"(?i)(tel|phone|전화|핸드폰|휴대폰|mobile|h\.?p\.?|t\s*[:.])")

# 날짜: "2024년 3월 15일", "2024.03.15", "2024-03-15", "3/15" 등
DATE_PATTERN = re.compile(
    r"\d{4}[년.\-/]\s*\d{1,2}[월.\-/]\s*\d{1,2}[일]?"
    r"|\d{1,2}[월.\-/]\s*\d{1,2}[일]?"
)

# 시간: "14:30", "09:00", "오후 2시" 등
TIME_PATTERN = re.compile(
    r"\d{1,2}\s*:\s*\d{2}"
    r"|[오전후]+\s*\d{1,2}\s*시"
)

# URL 링크: http://, https://, www. 로 시작하는 주소
LINK_PATTERN = re.compile(r"https?://\S+|www\.\S+", re.IGNORECASE)

# 스킴/www 없는 맨도메인(명함에 흔함): "foo.co.kr", "company.com/about".
# 알려진 TLD 로 끝나는 토큰만 URL 로 인정(정밀도). 이메일 로컬파트(@앞)는
# (?<![@\w]) 룩비하인드로 제외. 이메일은 분류 1단계서 먼저 걸러짐.
_URL_TLD = (r"(?:com|net|org|io|biz|info|dev|app|me|tv|edu|gov"
            r"|co\.kr|ne\.kr|or\.kr|go\.kr|ac\.kr|re\.kr|pe\.kr|kr)")
# 분류/추출에서 함께 쓰는 통합 URL 탐지(스킴/www/맨도메인 모두).
WEBSITE_PATTERN = re.compile(
    r"https?://\S+|www\.\S+|"
    r"(?<![@\w])(?:[a-z0-9][a-z0-9\-]*\.)+" + _URL_TLD + r"\b(?:/[^\s]*)?",
    re.IGNORECASE,
)

# 금액: "12,000원", "₩12,000" 등
PRICE_PATTERN = re.compile(r"[\d,]+\s*원|₩\s*[\d,]+")

# ========== 명함 전용 패턴 ==========

# 한국어 이름 패턴 (2~4글자 한글)
KOREAN_NAME_PATTERN = re.compile(r"^[가-힣]{2,4}$")

# 이름 후보에서 제외할 라벨/안내 어휘.
#
# **왜 필요한가.** 이름 판정은 "2~4자 한글이고 첫 글자가 성씨 목록에 있다" 가 전부인데,
# 한국어 성씨는 흔한 글자라 일반 어휘의 첫 글자와 대량으로 겹친다. 실측(28개 표본):
# 안내·문의·장소·주소·신청·방법·오전·오후·전화·이메일·정보·성명·연락처·서명·기간·공지·
# 심사·선발·주제 = **19개(68%)가 person_name 으로 오분류**됐다.
# (재현율은 멀쩡하다 — 김민수·이영희·남궁민수·박지원은 모두 정상 판정된다. 정밀도만 무너져 있다.)
#
# **왜 이것이 단순 오분류보다 나쁜가.** 이름 칸이 "안내" 같은 값으로 채워지면 앱의
# hasNoExtractedValues(src/features/scan/scanStore.ts)가 false 가 되어
# "인식된 정보가 없습니다" 배너가 뜨지 않는다. 즉 **실패를 성공처럼 보이게 만든다.**
#
# 목록 방식의 한계는 인정한다 — 여기 없는 라벨은 여전히 통과한다. 다만 (a) 명함에는
# 라벨 단독 블록이 드물고 (b) 포스터/안내문에서 실제로 관측되는 어휘가 이 집합에
# 몰려 있어, 목록만으로도 오탐의 대부분이 사라진다. 근본 해결은 bbox 위치/폰트 크기를
# 보는 것이고 그것은 이 규칙 계층의 범위 밖이다.
# 단독 대문자 영문 단어가 이름이 아닌 경우 (로고·약어·라벨).
# 12번 분기가 단어 1개를 받게 되면서 필요해진 최소 방어선이다.
_NON_NAME_TOKENS = frozenset({
    "TEL", "FAX", "MOBILE", "PHONE", "EMAIL", "MAIL", "WEB", "HOMEPAGE", "HTTP", "HTTPS",
    "ADDRESS", "OFFICE", "COMPANY", "INSTA", "INSTAGRAM", "KAKAO", "FACEBOOK", "TWITTER",
    "CEO", "CTO", "CFO", "COO", "MANAGER", "DIRECTOR", "TEAM", "LAB", "INC", "LTD", "CORP",
    "OFF", "ON", "OPEN", "CLOSE", "NEW", "SALE", "EVENT", "VIP", "QR", "NO", "PM", "AM",
})

NON_NAME_WORDS = frozenset({
    # 안내/라벨
    "안내", "문의", "장소", "위치", "주소", "신청", "방법", "정보", "성명", "이름",
    "연락처", "서명", "기간", "공지", "대상", "자격", "접수", "시상", "심사", "선발",
    "참가", "상금", "주제", "분야", "내용", "혜택", "일시", "일정", "시간", "구분",
    "비고", "기타", "제목", "목적", "개요", "요강", "모집", "마감", "제출", "서류",
    # 연락 수단
    "전화", "휴대폰", "핸드폰", "팩스", "이메일", "메일", "홈페이지", "주최", "주관", "후원",
    # 시각 표현
    "오전", "오후", "당일", "금일", "익일", "매일", "매주", "매월",
})

# 한국어 성 (외자)
KOREAN_SURNAME_SINGLE = re.compile(
    r"^(김|이|박|최|정|강|조|윤|장|임|한|오|서|신|권|황|안|송|유|류|홍|전|고|문|손|"
    r"양|배|백|허|노|심|하|주|구|곽|성|차|우|진|민|나|지|엄|채|원|천|방|공|현|함|"
    r"변|염|여|추|도|소|석|선|설|마|길|연|위|표|명|기|반|라|왕|금|옥|육|인|맹)"
)

# 복성(두 글자 성) — 남궁, 독고, 황보 등
KOREAN_SURNAME_DOUBLE = re.compile(
    r"^(남궁|독고|황보|제갈|선우|동방|사공|서문)"
)

# 직책 키워드
JOB_TITLE_KEYWORDS = [
    # 한국어
    "대표", "사장", "부사장", "전무", "상무", "이사", "부장", "차장",
    "과장", "대리", "사원", "주임", "팀장", "실장", "본부장", "센터장",
    "매니저", "엔지니어", "디자이너", "개발자", "연구원", "교수", "박사",
    "원장", "부원장", "회장", "지점장", "점장", "소장", "국장", "위원장",
    # 영어
    "CEO", "CTO", "CFO", "COO", "VP", "Director", "Manager", "Engineer",
    "Designer", "Developer", "Analyst", "Consultant", "President",
    "Senior", "Junior", "Lead", "Head", "Chief", "Officer", "Intern",
]

# 회사명 키워드
COMPANY_KEYWORDS = [
    # 한국어
    "주식회사", "(주)", "㈜", "(재)", "재단법인", "(사)", "사단법인",
    "협회", "재단", "기술원", "연구원", "진흥원", "공사", "공단",
    "대학교", "대학원", "학교",   # 학술/교육기관(대학 명함)
    "회사", "그룹", "코퍼레이션", "테크", "랩",
    "솔루션", "시스템", "네트워크", "미디어", "엔터", "파트너스",
    # 영어
    "Inc", "Corp", "Ltd", "LLC", "Co.", "Company", "Group",
    "Technologies", "Tech", "Labs", "Solutions", "Systems",
    "Networks", "Media", "Entertainment", "Partners", "Global",
    "University", "College", "Institute", "Univ",
]

# 부서 키워드 — 텍스트 끝에 이 키워드가 오면 부서명으로 판별
DEPARTMENT_KEYWORDS = [
    "부", "팀", "실", "센터", "본부", "사업부", "연구소", "지점",
    "학부", "학과",   # 대학 조직(예: "디지털융합대학 컴퓨터학부")
    "파트", "그룹", "Division", "Team", "Department", "Dept",
]

# 주소 패턴 — 한국 주소에 자주 등장하는 키워드 조합
ADDRESS_PATTERN = re.compile(
    r"(시|구|동|로|길|읍|면|리|층|호|번지|번길)"
)

# 우편번호 패턴 — 5자리 숫자 단독
ZIP_CODE_PATTERN = re.compile(r"^\d{5}$")

# ========== 포스터 전용 패턴 ==========

# 주최/주관 키워드
ORGANIZER_KEYWORDS = ["주최", "주관", "후원", "협찬", "organizer", "hosted by"]

# 라벨 없이 **기관명만** 적힌 블록을 주최자로 잡기 위한 접미사.
#
# ORGANIZER_KEYWORDS 는 "주최:"/"주관:" 같은 라벨이 붙은 경우만 잡는다. 실제
# 포스터는 하단에 기관명만 나열하는 쪽이 훨씬 흔하고, 그 블록들이 전부
# LOCATION_KEYWORDS 의 "센터"에 걸려 장소로 흘러갔다.
# 실측(대구 동구 청년창업 경진대회):
#     location = "청년센터 창업지원사업 연계 동구청년센터the꿈 동구청년센터the끔"
#     organizer_name = (없음)
# "센터"는 한국 기관명에 압도적으로 흔하다(청년센터/문화센터/진흥센터) —
# 장소 키워드로 두는 한 주최자는 영원히 안 잡힌다.
#
# **접미사는 반드시 블록 끝(또는 끝 근처)에 있어야 한다.** 부분문자열로 검사하면
# 일반 명사에 걸린다 — 첫 시도에서 "대구지역 거주 대학생"의 '대학', "(훈격) 동구청장상"의
# '구청' 이 주최자로 잡혔다(LOCATION_KEYWORDS 의 "at "/"SAT" 와 같은 종류의 실수다).
# 기관명 블록은 기관 접미사로 **끝나는** 것이 정상이고, 뒤에 조사/구두점 정도만 붙는다.
_ORG_SUFFIX = re.compile(
    r"(?:대학교|대학원|재단|협회|학회|진흥회|진흥원|연구원|연구소|공사|공단|위원회|중앙회|"
    r"연합회|문화원|사업단|장학회|봉사단|복지관|청년센터|지원센터|진흥센터|"
    r"주식회사|교육청|시청|군청|도청|구청|YMCA|YWCA)"
    r"\s*(?:the\s*\S+)?\s*[.,)\]]?\s*$"
    r"|^\s*(?:\(주\)|㈜)"          # 선두 회사 표기는 그 자체가 기관 신호다
)

# 주소 토큰. 기관명이 들어 있어도 이것이 함께 있으면 **장소**다
# ("○○센터 3층 대강당", "△△회관 2F"). 주최자와 장소를 가르는 유일한 신호다.
_ADDRESS_HINT = re.compile(
    r"\d+\s*(?:층|F\b|호|호실|번지)|[가-힣]+(?:로|길)\s*\d|대강당|강당|회의실|세미나실|"
    r"컨벤션|홀\b|아트홀|체육관|운동장|광장"
)

# 주최자 값 정제용 패턴 — 선두/인라인 라벨 + 구분자. entity 타입(시/재단/회사/사람)
# 가정 없이 라벨 앵커로만 메인(주최) 식별. 접미 라벨명사(자/측/처/사)는 라벨로 함께 소비
# ('주최자/주최측/주관사' 의 접미음절을 값으로 오인하지 않음). 경계가드로 '우주관광' 등 오발동 차단.
_ORG_LABEL_SUFFIX = r"(?:자|측|처|사)?"
_ORG_LABEL_CORE = (
    r"(?:주최\s*[/／]\s*주관|주최|주관|후원|협찬)" + _ORG_LABEL_SUFFIX
    + r"|(?:organizer|hosted\s*by)"
)
_ORG_LABEL_LEAD = re.compile(
    r"^\s*(?:" + _ORG_LABEL_CORE + r")(?=[\s:：/／|·・,，]|$)\s*[:：/／|·・]?\s*",
    re.IGNORECASE,
)
_ORG_LABEL_ONLY = re.compile(
    r"^\s*(?:" + _ORG_LABEL_CORE + r")\s*$", re.IGNORECASE,
)
_ORG_INLINE_LABEL = re.compile(
    r"(?<![가-힣])(?:주최|주관|후원|협찬)" + _ORG_LABEL_SUFFIX + r"\s*[:：]\s*"
    + r"|(?<![A-Za-z])(?:organizer|hosted\s*by)\s*[:：]\s*",
    re.IGNORECASE,
)
# 메인('주최:') 캡처 — 다음 인라인라벨/구분자(콤마·가운뎃점·파이프·' / ') 직전까지.
# 공백 없는 슬래시('서울/경기')는 경계 아님 → org명 내부 슬래시 절단 안 함.
_ORG_MAIN = re.compile(
    r"(?<![가-힣])주최" + _ORG_LABEL_SUFFIX + r"\s*[:：]\s*(.+?)"
    + r"(?=\s*(?:[,，·・|]|\s[/／]\s"
    + r"|(?<![가-힣])(?:주관|후원|협찬)" + _ORG_LABEL_SUFFIX + r"\s*[:：]"
    + r"|(?<![A-Za-z])(?:organizer|hosted\s*by)\s*[:：])|$)",
    re.IGNORECASE,
)
_ORG_SPLIT = re.compile(r"\s*[,，·・|]\s*|\s+[/／]\s+")
_ORG_BULLET = " \t·・|／/※▶►●*-—–>"

# 장소 키워드
# 한글 키워드는 부분문자열 검사로 충분하다(교착어라 조사가 붙어도 어간이 남는다).
# **장소는 명시 라벨이 있을 때만 뽑는다.**
#
# 종전 목록은 "곳/홀/센터/회의실/강당" 같은 **시설 일반명사**를 포함했다. 그것들은
# 장소 라벨이 아니라 아무 문장에나 들어가는 낱말이라 오탐의 원천이었다:
#     "청년센터 창업지원사업 연계"  → location
#     "지하 열람실 운영 및시설관리"  → location
# 정답 대조(155장) 결과 location 은 정확 0 / 부분 7 / **오답 22** / 누락 82 였다.
#
# 게다가 정답 111건 중 **61%는 포스터에 근거가 없다** — 라벨 작성자가 "온라인 공모전이니
# 장소는 온라인" 식으로 추론해 적은 값이다(감사 결과: 근거 있음 43/111 = 39%).
# 도달 불가능한 값을 쫓다 보면 없는 장소를 만들어내게 된다. 빈 칸이 낫다 —
# 앱도 "인식되지 않음 · 직접 입력" 으로 안내한다.
#
# 그래서 정밀도 우선으로 간다: **"장소:" 같은 명시 라벨이 붙은 블록만** 장소로 본다.
LOCATION_KEYWORDS = [
    "장소", "위치", "행사장", "개최지", "오시는 길", "오시는길", "venue",
]

# 영문 장소 전치사는 **단어 경계가 필수**다.
#
# 종전에는 이 값이 LOCATION_KEYWORDS 안에 `"at "` 문자열로 들어 있었고,
# 부분문자열 검사라 `SAT `(토요일), `THAT `, `GREAT ` 같은 단어의 꼬리에 걸렸다.
# 실제 피해: 청첩장의 `2026. 08. 22. SAT PM 2:30` 이 **location 으로 분류**되어
# 날짜(event_start_date)가 통째로 사라졌다 — 일정 관리 앱에서 가장 중요한 필드다.
# 장소 검사가 날짜 검사보다 먼저(아래 5번 → 6번)라 날짜 분기에 닿지도 못했다.
LOCATION_PREPOSITION = re.compile(r"\bat\s", re.IGNORECASE)

# 행사 시작 키워드
EVENT_START_KEYWORDS = ["일시", "시작", "개최", "행사일", "기간"]

# 행사 종료/마감 키워드
EVENT_END_KEYWORDS = ["마감", "접수", "신청기한", "deadline", "모집기간", "종료", "까지"]

# 선행 물결표/화살표 = "그날까지". 라벨 접두어가 붙어 있어도 인정한다
# ("접수 ~7.31.", "· ~ 7.31.", "▶~7.31."). 물결표 종류는 OCR 이 흔히 바꿔 쓴다
# (~ 물결, ∼ U+223C, 〜 U+301C, - 하이픈은 범위로도 쓰여 제외).
_LEADING_RANGE_MARK = re.compile(r"^[^\d]{0,12}?[~∼〜–—]\s*(?=\d)")

# ── 포스터 섹션 라벨 ────────────────────────────────────────────────────────
#
# 포스터는 "라벨 + 그 아래 값" 이라는 구획 구조로 인쇄된다. 실측(성별균형 국민제안
# 공모전 포스터)에서 같은 화면에 날짜가 두 벌 있었다:
#     [공모기간]  2026.  6.10.(수)  ~7.31.(금)
#     [결과발표]  2026. 9월
# 텍스트만 보면 둘 다 날짜라 구별할 수 없다. 실제로 "2026.9월" 이 confidence 로
# 이겨 행사 시작일 자리를 차지하고 "6.10.(수)" 를 밀어냈다.
#
# 구별의 근거는 텍스트가 아니라 **어느 라벨 밑에 있는가**다. bbox 로 가장 가까운
# 섹션 라벨을 찾아 그 라벨이 기간 라벨이면 행사일로, 아니면 버린다.
_PERIOD_LABELS = re.compile(
    r"공모\s*기간|접수\s*기간|모집\s*기간|신청\s*기간|응모\s*기간|행사\s*기간|"
    r"교육\s*기간|기\s*간|일\s*시|행사\s*일|공모\s*일정|접수"
)
# 날짜가 있어도 **행사일이 아닌** 섹션. 결과발표·심사·시상 일정이 여기 걸린다.
_NON_PERIOD_LABELS = re.compile(
    r"결과\s*발표|발\s*표|심\s*사|시\s*상|수\s*상|당첨|공지|문\s*의|"
    r"오리엔테이션|교육\s*일|설명\s*회"
)

# ========== 영수증 전용 패턴 ==========

# 합계 키워드
TOTAL_KEYWORDS = ["합계", "총액", "total", "합산", "결제", "총"]

# 업장 키워드
STORE_KEYWORDS = ["상호", "매장", "가맹점"]

# 영수증 구매일자로 인정할 **엄격한** 날짜 형태.
# 연도 4자리(2026.02.27 / 2018/01/30 / 2026-02-28) 또는 한국어 표기(6월 15일)만 받는다.
# DATE_PATTERN 의 "MM.DD" 교대는 영수증에서 오탐이 압도적이라 쓰지 않는다
# (사업자번호·POS번호·승인번호·금액 소수점이 전부 그 형태다).
# 영수증 하단 안내문구. 상호 자리에 들어가면 안 된다.
_RECEIPT_NOTICE = re.compile(
    r"실제와\s*다|신고|포상금|문의|안내|협회|고객센터|주의|확인\s*바랍|바랍니다|"
    r"교환|환불|반품|영수증을|보관"
)

_RECEIPT_DATE_STRICT = re.compile(
    r"(?:19|20)\d{2}\s*[년.\-/]\s*\d{1,2}\s*[월.\-/]\s*\d{1,2}\s*일?"
    r"|\d{1,2}\s*월\s*\d{1,2}\s*일"
)

# ========== 티켓 전용 패턴 ==========

# 교통수단 키워드 → 정규화된 교통수단명 매핑
TRANSPORT_NORMALIZE = {
    # KTX
    "KTX": "KTX",
    # SRT
    "SRT": "SRT",
    # ITX
    "ITX": "ITX",
    # 무궁화
    "무궁화": "무궁화",
    # 고속버스
    "고속버스": "고속버스", "시외버스": "고속버스",
    # 비행기 (항공사명, 항공 키워드, IATA 코드)
    "항공": "비행기", "AIR": "비행기", "비행기": "비행기",
    "아시아나": "비행기", "대한항공": "비행기", "진에어": "비행기",
    "티웨이": "비행기", "제주항공": "비행기", "에어부산": "비행기",
    "에어서울": "비행기", "이스타": "비행기", "플라이강원": "비행기",
    "탑승권": "비행기",
    # IATA 항공사 코드
    "OZ": "비행기", "KE": "비행기", "LJ": "비행기",
    "TW": "비행기", "7C": "비행기", "BX": "비행기",
    "ZE": "비행기", "RS": "비행기",
}

# 역호환용 키워드 리스트 (티켓 감지에 사용)
TRANSPORT_KEYWORDS = list(TRANSPORT_NORMALIZE.keys())

# 출발 키워드
DEPARTURE_KEYWORDS = ["출발", "탑승", "departure", "from", "승차"]

# 도착 키워드
ARRIVAL_KEYWORDS = ["도착", "하차", "arrival", "to", "종착"]


# ════════════════════════════════════════════
# 명함 분류기
# ════════════════════════════════════════════

def _has_korean_name_block(all_blocks: list[dict] | None, skip_index: int) -> bool:
    """다른 블록에 한글 이름 모양(성씨 + 2~4자, 라벨 아님)이 있는지 본다.

    _classified 를 보지 않는 이유: 분류는 2-pass 이고 블록 순서에 따라 아직
    person_name 이 붙지 않았을 수 있다. 텍스트 모양만 보면 순서와 무관해진다.
    """
    if not all_blocks:
        return False
    for b in all_blocks:
        if b.get("block_index") == skip_index:
            continue
        t = re.sub(r"\s+", "", (b.get("text") or "").strip())
        if not (2 <= len(t) <= 4) or not re.fullmatch(r"[가-힣]+", t):
            continue
        if t in NON_NAME_WORDS:
            continue
        if KOREAN_SURNAME_SINGLE.match(t) or KOREAN_SURNAME_DOUBLE.match(t):
            return True
    return False


def classify_text_block(text: str, all_blocks: list[dict] = None, block_index: int = 0) -> str:
    """
    단일 텍스트 블록을 명함 스키마 필드로 분류.

    Args:
        text: OCR에서 추출된 텍스트
        all_blocks: 전체 텍스트 블록 목록 (문맥 참조용)
        block_index: 현재 블록의 인덱스

    Returns:
        필드명 (person_name, english_name, company_name, department,
        job_title, mobile_phone, office_phone, fax_number, email,
        address, website, zip_code, unknown)
    """
    text_stripped = text.strip()
    if not text_stripped:
        return "unknown"

    # 1) 이메일 확인 — @ 기호를 포함한 이메일 패턴 매칭
    if EMAIL_PATTERN.search(text_stripped):
        return "email"

    # 2) 웹사이트 확인 — http/https/www + 스킴없는 맨도메인(foo.co.kr)
    if WEBSITE_PATTERN.search(text_stripped):
        return "website"

    # 3~5) 전화/팩스 — 국제표기(+82) 는 국내표기(0)로 환원 후 패턴 매칭
    phone_text = _intl_to_domestic(text_stripped)

    # 3) 팩스 확인 — 팩스 키워드 + 전화번호 패턴이 동시에 존재
    if FAX_KEYWORDS.search(text_stripped) and LANDLINE_PATTERN.search(phone_text):
        return "fax_number"

    # 4) 휴대폰 번호 확인 — 010/011/016/017/018/019로 시작하는 번호
    if MOBILE_PATTERN.search(phone_text):
        if FAX_KEYWORDS.search(text_stripped):
            return "fax_number"
        return "mobile_phone"

    # 5) 일반 전화번호 / 팩스 판별 — 0으로 시작하는 유선 번호
    if LANDLINE_PATTERN.search(phone_text):
        if FAX_KEYWORDS.search(text_stripped):
            return "fax_number"
        if PHONE_KEYWORDS.search(text_stripped):
            return "office_phone"
        # 키워드 없는 유선번호 → 문맥으로 판단
        # 이미 mobile_phone이 할당된 블록이 있으면 office_phone으로 분류
        if all_blocks:
            mobile_already_found = any(
                b.get("_classified") == "mobile_phone"
                for b in all_blocks
                if b["block_index"] != block_index
            )
            return "office_phone" if mobile_already_found else "office_phone"
        return "office_phone"

    # 6) 우편번호 확인 — 5자리 숫자 단독
    if ZIP_CODE_PATTERN.match(text_stripped):
        return "zip_code"

    # 7) 주소 확인 — 한국 주소 키워드 포함 + 어느 정도 길이
    if len(text_stripped) >= 5 and ADDRESS_PATTERN.search(text_stripped):
        # 주소는 보통 5자 이상이고 숫자+한글 혼합
        address_keyword_count = len(ADDRESS_PATTERN.findall(text_stripped))
        if address_keyword_count >= 2:
            return "address"

    # 8) 직책 확인 — 키워드 리스트와 대소문자 무관 비교
    for keyword in JOB_TITLE_KEYWORDS:
        if keyword.lower() in text_stripped.lower():
            return "job_title"

    # 9) 부서 확인 — 텍스트가 부서 키워드로 끝나는 경우
    for keyword in DEPARTMENT_KEYWORDS:
        if text_stripped.endswith(keyword):
            return "department"

    # 10) 회사명 확인 — 키워드 리스트와 대소문자 무관 비교
    for keyword in COMPANY_KEYWORDS:
        if keyword.lower() in text_stripped.lower():
            return "company_name"

    # 11) 한국어 이름 확인 — 2~4글자 한글 단독 + 한국 성씨로 시작
    #     공백이 포함된 경우("이 응 환")도 공백 제거 후 판별
    name_no_space = re.sub(r"\s+", "", text_stripped)
    if 2 <= len(name_no_space) <= 4 and re.match(r"^[가-힣]+$", name_no_space):
        # 라벨/안내 어휘는 성씨로 시작해도 이름이 아니다 (NON_NAME_WORDS 주석의 실측 참조).
        if name_no_space not in NON_NAME_WORDS and (
            KOREAN_SURNAME_SINGLE.match(name_no_space) or KOREAN_SURNAME_DOUBLE.match(name_no_space)
        ):
            return "person_name"

    # 12) 영문 이름 추정 — 1~3 단어, 각 단어 첫 글자 대문자.
    #     로마자 한국이름은 하이픈/마침표 포함 가능("Yong-Yeon","J.H.") → 제거 후 알파벳 검사.
    #
    #     **단어 1개도 받는다.** 종전 하한이 2였고, 그래서 로마자 이름을 한 덩어리로
    #     인쇄한 명함("MINJUNG")에서 english_name 이 통째로 누락됐다 — 실측 사례다.
    #     대신 단어가 1개일 때는 조건을 좁힌다: 3~12자, 전부 알파벳(하이픈 허용),
    #     그리고 **아래 _NON_NAME_TOKENS 에 없는 것**. 회사/직책 키워드는 이 함수의
    #     앞 단계(9·10번)에서 이미 걸러졌으므로 여기 도달하는 단독 대문자 단어는
    #     대부분 이름이지만, 로고/약어가 남을 수 있어 최소한의 방어선을 둔다.
    words = text_stripped.split()
    looks_name = False
    if 2 <= len(words) <= 3:
        # 길이 상한을 둔다. 로마자 한국 이름은 길어야 "Yong-Yeon Choi" 정도(20자 안팎)인데,
        # 상한이 없어 상호/슬로건이 통과했다 — 실측:
        #     name = "Korean Resaurant MYUNJANGSUYEONPO"  (식당 상호)
        # 각 단어가 대문자로 시작하는 영문 상호는 흔하므로 형태만으로는 갈라지지 않는다.
        looks_name = len(text_stripped) <= 24 and all(
            w[:1].isupper() and w.replace("-", "").replace(".", "").isalpha() for w in words
        )
    elif len(words) == 1:
        w = words[0]
        stripped = w.replace("-", "")
        looks_name = (
            3 <= len(stripped) <= 12
            and stripped.isalpha()
            and stripped.isascii()
            and w[:1].isupper()
            and stripped.upper() not in _NON_NAME_TOKENS
            # **한글 이름이 이미 있는 명함에서는 받지 않는다.**
            # 단독 로마자 단어는 이름만큼이나 로고/브랜드일 확률이 높다 — 첫 시도에서
            # 파트너사 로고 "COGNEX" 가 english_name 으로 들어왔다. 이름을 로마자
            # 한 덩어리로만 인쇄한 명함("MINJUNG")을 살리는 것이 이 분기의 목적이므로,
            # 한글 이름이 따로 있으면 그 목적이 이미 달성된 것이고 여기서 얻을 것은 없다.
            # 2-pass 분류 순서에 의존하지 않도록 _classified 가 아니라 **텍스트 모양**으로 본다.
            and not _has_korean_name_block(all_blocks, block_index)
        )

    if looks_name:
        # 이미 한국어 이름이 분류된 블록이 있으면 english_name으로
        if all_blocks:
            has_korean_name = any(
                b.get("_classified") == "person_name"
                for b in all_blocks
            )
            if has_korean_name:
                return "english_name"
        return "person_name"

    return "unknown"


def _normalize_phone(number: str) -> str:
    """전화번호 정규화: 산업표준 libphonenumber(E.164 검증)로 한국번호를
    국가표준 형식(010-1234-5678)으로 통일. 라이브러리 부재/파싱 실패/무효번호는
    기존 regex 정규화로 폴백(절대 깨지지 않음)."""
    raw = number

    # 050X 안심번호는 libphonenumber 에 맡기지 않는다.
    #
    # 실측: "0505-123-4567" → "050-5123-4567", "0507-1234-5678" → "050-71234-5678".
    # 숫자는 보존되지만 국번을 050 으로 잘라 하이픈 위치가 틀어진다 — 사람이 읽는
    # 표기로도, 다시 거는 값으로도 어색하다. 050X 는 4자리 전체가 국번이므로
    # 여기서 직접 나눈다. (libphonenumber 는 050X 대역을 지역번호로 모델링하지 않는다.)
    digits = re.sub(r"\D", "", raw)
    if len(digits) in (11, 12) and digits.startswith("050"):
        return f"{digits[:4]}-{digits[4:-4]}-{digits[-4:]}"

    try:
        import phonenumbers
        pn = phonenumbers.parse(number, "KR")
        if phonenumbers.is_valid_number(pn):
            return phonenumbers.format_number(
                pn, phonenumbers.PhoneNumberFormat.NATIONAL)
    except Exception:
        pass
    # 폴백: 괄호 지역번호 처리 + 구분자(. 공백)를 하이픈으로 통일.
    number = raw.replace("(", "").replace(")", "-")   # "(055)366" → "055-366"
    number = re.sub(r"[.\s]+(?=\d)", "-", number)         # 구분자 → 하이픈
    number = re.sub(r"-{2,}", "-", number).strip("-")      # 중복 하이픈 정리
    return number


def _clean_amount(text: str) -> str:
    """금액 칸 정제: 라벨/무관항목 제거 후 가장 큰 숫자를 'N원'으로. 숫자 없으면 ''.

    **천단위 구분자로 마침표를 쓰는 영수증을 받는다.** 한국 영수증 인쇄에서 "7.500"
    (=7,500원)은 흔한 표기이고, OCR 이 쉼표를 마침표로 흘리는 경우도 잦다.
    종전 정규식은 쉼표 구분자와 4자리 이상 연속 숫자만 봐서 "7.500" 을 통째로
    버렸다 — 실측 19장에서 total_amount 가 **0장**이었던 원인 중 하나다.

    소수점과 구분되지 않는 것은 사실이지만, 이 필드는 원화 결제 금액이라 소수점이
    쓰이지 않는다. 그래서 **뒤 3자리** 형태(`\\d{1,3}(\\.\\d{3})+`)만 천단위로 읽는다 —
    "8.50"(2자리)이나 "4.5001"(4자리)은 매치되지 않아 종전대로 버려진다.
    """
    nums = re.findall(r"\d{1,3}(?:[.,]\d{3})+|\d{4,}", text)
    if not nums:
        # OCR 이 끝자리를 흘린 경우를 한 번 더 본다: "66,00"(원본 66,000).
        # 이 경로는 **마지막 그룹이 2자리일 때만** 쓴다 — 소수점 금액(9.38)과
        # 구분이 안 되므로 3자리로 복원하지 않고 있는 자릿수 그대로 읽는다.
        loose = re.findall(r"\d{1,3}(?:[.,]\d{3})*[.,]\d{2}(?!\d)", text)
        if not loose:
            return ""   # 유효 금액 없음 → 드롭(예 라벨만/깨진 값)
        nums = loose
    n = max(int(re.sub(r"[.,]", "", s)) for s in nums)
    return f"{n:,}원"


def _strip_date_label(s: str) -> str:
    """날짜 칸 선두 라벨/장식 제거: [판매]/[구매]/출력일시:/일시:/~/· 등."""
    s = s.strip()
    s = re.sub(r"^[\[\(][^\]\)]{0,8}[\]\)]\s*", "", s)                       # [판 매]/(구매)
    s = re.sub(r"(?i)^\s*(출력일시|판매일시|구매일시|거래일시|일시|날짜|기간|date)\s*[:：]?\s*", "", s)
    s = s.lstrip("~·※▶►●*- \t")
    return s.strip()


def _to_iso_datetime(s: str) -> str:
    """한국어/숫자 날짜(+시간) → ISO 8601(YYYY-MM-DD 또는 YYYY-MM-DDTHH:MM).
    파싱 실패 시 '' 반환(호출부가 원문 폴백). 연도 없으면 올해로 보정(휴리스틱)."""
    s = (s or "").strip()
    # 날짜: (YYYY[년./-])? M[월./-] D[일]?  — 연도는 선택.
    md = re.search(r"(?:(\d{4})\s*[년.\-/]\s*)?(\d{1,2})\s*[월.\-/]\s*(\d{1,2})\s*일?", s)
    if not md:
        return ""
    y, mo, d = md.group(1), int(md.group(2)), int(md.group(3))
    if not (1 <= mo <= 12 and 1 <= d <= 31):
        return ""
    if y is None:
        import datetime as _dt
        y = _dt.date.today().year     # 연도 없는 포스터 → 올해로 가정(휴리스틱)
    else:
        y = int(y)
    iso = f"{y:04d}-{mo:02d}-{d:02d}"
    # 시간: (오전|오후|AM|PM)? H[:시] MM? — [:시] 가 있어야 시간으로 인정(날짜오인 방지).
    tm = re.search(r"(오전|오후|AM|PM)?\s*(\d{1,2})\s*[:시]\s*(\d{2})?\s*분?", s, re.I)
    if tm:
        ap = (tm.group(1) or "").lower()
        h = int(tm.group(2))
        mi = int(tm.group(3)) if tm.group(3) else 0
        if 0 <= h <= 23 and 0 <= mi <= 59:
            if ap in ("오후", "pm") and h < 12:
                h += 12
            if ap in ("오전", "am") and h == 12:
                h = 0
            iso += f"T{h:02d}:{mi:02d}"
    return iso


def _clean_event_date(text: str, role: str) -> str:
    """행사 날짜 → ISO 8601 정규화. 범위(A~B)는 role(start/end)로 한쪽 선택하고,
    종료일에 연도 없으면 시작연도를 상속. 파싱 실패 시 노이즈만 제거한 원문 반환."""
    s = _strip_date_label(text)
    s = re.sub(r"\([^)]*\)", "", s)                 # (금)(목)(토/Sat) 요일 괄호 제거
    # 2자리 연도(YY.M.D) → 20YY.M.D ('26.6.15' 가 '26.6'(월26) 으로 오파싱되는 것 방지).
    # 4자리 연도 내부는 lookbehind(?<!\d)로 보호.
    s = re.sub(r"(?<!\d)(\d{2})\s*[.\-/]\s*(\d{1,2})\s*[.\-/]\s*(\d{1,2})",
               lambda m: (f"20{m.group(1)}.{m.group(2)}.{m.group(3)}"
                          if 24 <= int(m.group(1)) <= 30 and int(m.group(2)) <= 12
                          else m.group(0)), s)
    # 날짜 패턴이 전혀 없으면 빈값(모델이 비-날짜 텍스트를 event_date 로 오분류한 경우 차단).
    if not DATE_PATTERN.search(s):
        return ""
    # 범위: 날짜 토큰이 2개 이상이면 role 로 한쪽 선택(구분자 ~/- 무관).
    matches = [m.group() for m in DATE_PATTERN.finditer(s)]
    if len(matches) >= 2 and role in ("start", "end"):
        chosen = matches[0] if role == "start" else matches[-1]
        if role == "end" and not re.search(r"\d{4}", chosen):
            ym = re.search(r"(\d{4})", matches[0])   # 종료일 연도 없으면 시작연도 상속
            if ym:                                   # ISO 파서 연도패턴(\d{4}[구분자])에 맞게 '.' 결합
                chosen = ym.group(1) + "." + chosen.lstrip(" .-/")
        iso = _to_iso_datetime(chosen)
        if iso:
            return iso.split("T")[0]      # 행사일은 날짜만(시각 제거)
    iso = _to_iso_datetime(s)
    if iso:
        return iso.split("T")[0]

    # **ISO 로 못 만들면 버린다. 원문을 돌려주지 않는다.**
    #
    # 종전에는 "꼬리 노이즈만 제거한 원문"을 폴백으로 내보냈는데, 그 값은 앱에서
    # 쓸 수가 없다 — event_*_date 는 inputType 'date' 라 zod 가 isIsoDate 를 강제하고,
    # 형식이 어긋나면 validateFields 가 오류를 내 저장이 막힌다. 즉 이 폴백이 만드는 것은
    # "덜 정확한 값"이 아니라 **저장 불가 상태**다.
    # 실측(포스터 27장)에서 이 경로로 나간 값들:
    #     "CC브랜드260303-0017"(사업자번호)  "입학상담|810-4966~8"(전화)
    #     "10:00-17:00/130"(시간대)          "7942-28-59944"  "12.81.7"
    # 하나도 날짜가 아니다. 빈 칸이 이것들보다 낫다 — 사용자가 직접 넣을 수 있다.
    return ""


def _clean_purchase_date(text: str) -> str:
    """영수증 구매일시 → ISO 날짜(YYYY-MM-DD). 날짜가 없으면 빈 문자열.

    **ISO 로 내보내야 한다.** purchase_date 는 앱 fieldSchema 에서 inputType 'date' 라
    zod 가 isIsoDate 를 강제한다 — 원문을 그대로 주면 저장이 막힌다(티켓 날짜에서
    같은 문제를 이미 겪었다). 종전 구현은 라벨·괄호만 떼고 원문을 돌려줬다:
        "2026.06.15 14:30" → "2026.06.15 14:30"   (검증 실패)
        "Tel 053-759-3560" → "Tel 053-759-3560"   (애초에 날짜가 아니다)

    시각은 버린다. 영수증의 구매시각은 별도 필드(purchase_time)이고, 그쪽은 OCR
    추출 대상이 아니라 수기 입력이다(앱 fieldSchema 의 ocrExtracted:false).
    """
    s = _strip_date_label(text)
    s = re.sub(r"\([^)]*\)", "", s)                  # 요일 괄호 제거
    s = re.sub(r"(\d)(\d{2}:\d{2})", r"\1 \2", s)    # '06-0221:13' → '06-02 21:13'
    iso = _to_iso_datetime(s)
    return iso.split("T")[0] if iso else ""


def _clean_location(text: str) -> str:
    """장소 칸 정제: 글머리/라벨(선두+중간) 제거 + 정확 중복 절반 축약."""
    s = text.strip().lstrip("·※▶►●*-> \t")
    # 라벨(장소/위치/실험장소/오시는길/오리엔테이션/오프라인/온라인/venue) 선두·중간 제거
    s = re.sub(r"(?i)\s*(실험\s*장소|장소|위치|행사장|개최지|오시는\s*길|오리엔테이션|오프라인|온라인|venue)\s*[:：]\s*", " ", s)
    # 라벨 뒤에 구분자(: 등)가 없는 형태도 뗀다 — "행사장 COEX 3층", "오시는 길 판교역".
    s = re.sub(r"(?i)^\s*(실험\s*장소|장소|위치|행사장|개최지|오시는\s*길|venue|at)\s*[:：]?\s*", "", s)
    s = re.sub(r"^[\-·\s]+", "", s)   # 선두 글머리(- · 등) 잔여 제거
    s = re.sub(r"\s+", " ", s).strip()
    # OCR/세그먼트 중복으로 같은 값이 두 번("A A") → 한 번으로.
    half = len(s) // 2
    if s[:half].strip() and s[:half].strip() == s[half:].strip():
        s = s[:half].strip()
    s = s.strip()

    # **라벨만 남았으면 값이 아니다.** "장소" 블록이 라벨 하나로 끝나는 경우
    # (값은 다음 블록에 있다) 라벨 제거 후 빈 문자열이나 조사 조각만 남는다.
    # 그것을 장소로 내보내면 사용자는 인식된 장소인 줄 알고 그대로 저장한다.
    if len(s) < 2:
        return ""
    if s in ("장소", "위치", "행사장", "개최지", "venue", "안내", "및", "또는"):
        return ""
    return s


def _strip_org_label(s: str) -> str:
    """문자열 선두의 주최/주관/후원/협찬(+접미 자/측/처/사) 라벨 1회 제거 + 글머리 strip."""
    return _ORG_LABEL_LEAD.sub("", s.strip()).strip(_ORG_BULLET)


def _org_finalize(v: str) -> str:
    """주최자 값 최종정제: 본문/주의문구 절단 + 연속·구(句) 중복 제거 + 과도 길이 컷.
    깨끗한 기관명엔 no-op(본문마커/중복 없음). join 으로 길어진 junk 만 정리."""
    v = (v or "").strip()
    if not v:
        return v
    # 기관명 뒤 본문/주의/수상명/footnote 절단(기관명엔 안 나오는 마커만).
    v = re.split(r"\s*(?:변경될|변경\s*될|사정으로|문의|신청|방문\s*또는|우편\s*:|에\s*관심|"
                 r"관심있|지식재산|공공데이터|초청|관심\s*있|청년작가전)", v)[0].strip()
    v = re.split(r"※|#|자세한|[0-9]+\s*층|복합문화공간|주관방송사|주관\s*방송", v)[0].strip()
    v = re.sub(r"\s*(?:주관방송사|주관방송|후원|협찬|주관|주최)\s*$", "", v).strip(" /·-|")
    # 수상명(…장상/…장관상 등)에서 절단 — 수상 주체명만 남김. generic '…장상' 포함.
    v = re.split(r"(?<=[가-힣])(?:장상|장관상|회장상|시장상|군수상|위원장상|교육감상|총장상|이사장상)", v)[0].strip()
    toks = v.split()
    dd = []
    for t in toks:                       # 연속 동일 토큰 제거
        if not dd or dd[-1] != t:
            dd.append(t)
    n = len(dd)                          # 앞 구 통째 반복 제거: 'A B A B C' → 'A B C'
    for k in range(1, n // 2 + 1):
        if dd[:k] == dd[k:2 * k]:
            dd = dd[:k] + dd[2 * k:]
            break
    v = " ".join(dd).strip(" /·-|")
    if len(v.split()) > 6:              # 과도 길이 → 앞 6토큰
        v = " ".join(v.split()[:6])
    return v


def _clean_organizer(text: str) -> str:
    """주최자 칸 정제: 선두/인라인 라벨 제거 + 메인(주최) 1개 선택. entity 타입 무관.

    1) '주최:'(자/측 포함) 인라인 라벨 있으면 그 값(다음 라벨/구분자 전까지). 공백없는
       슬래시는 절단 안 함. 2) 메인 없으면 인라인라벨→경계 치환 후 구분자 분리, 첫 비라벨
       항목. 3) 빈값 폴백: 선두라벨만 뗀 원문 → 그것도 비면 원문(데이터 소실 방지).
    """
    raw = text.strip()
    if not raw:
        return ""
    lead_stripped = _strip_org_label(raw)
    main = _ORG_MAIN.search(raw)
    if main:
        val = main.group(1).strip().strip(_ORG_BULLET).strip()
        if val and not _ORG_LABEL_ONLY.match(val):
            return _org_finalize(val)
    cleaned = _ORG_INLINE_LABEL.sub(" / ", raw)
    cleaned = _strip_org_label(cleaned)
    parts = [_strip_org_label(p) for p in _ORG_SPLIT.split(cleaned)]
    parts = [p for p in parts if p and not _ORG_LABEL_ONLY.match(p)]
    if parts:
        return _org_finalize(parts[0])
    fb = lead_stripped.strip(_ORG_BULLET).strip()
    if fb and not _ORG_LABEL_ONLY.match(fb):
        return _org_finalize(fb)
    return _org_finalize(raw)


def extract_clean_value(text: str, field: str) -> str:
    """분류된 필드에서 해당 값만 깨끗하게 추출 (키워드/노이즈 제거)."""
    if field in ("email", "contact_email"):
        # "E-mail." 처럼 라벨이 로컬파트 문자(letters/-/.)라 정규식에 흡수되는 것을
        # 막기 위해 선두 'E-mail' 라벨을 먼저 제거한 뒤 추출.
        # 괄호/한글 라벨("(0|메일: x@y)")은 로컬파트로 못 들어가 search 가 알아서 분리.
        cleaned = re.sub(r"(?i)^\s*[\(\[]?\s*e[-.\s]?mail[.:)\-\s]*", "", text.strip())
        # 이메일 라벨아이콘 'E'가 로컬파트 앞에 글루된 경우("Ewoojoo2021@") 제거.
        # (명함의 E/T/F 아이콘 라벨에서 공백이 OCR로 소실된 케이스. email칸 한정.)
        cleaned = re.sub(r"^E(?=[a-z])", "", cleaned)
        match = EMAIL_PATTERN.search(cleaned) or EMAIL_PATTERN.search(text)
        if match:
            return match.group()
        # OCR 노이즈 폴백: 도메인 점 누락("@navercom") 등. @ 있으면 느슨 추출.
        # (이미 contact_email 로 분류된 칸 한정 → 오탐 위험 낮음)
        loose = re.search(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9._\-]+", text)
        return loose.group() if loose else ""
    if field in ("mobile_phone", "office_phone", "contact_phone"):
        t = _intl_to_domestic(text)   # +82 국제표기 → 국내(0) 환원 후 추출
        match = (MOBILE_PATTERN.search(t) or LANDLINE_PATTERN.search(t)
                 or _PHONE_LOOSE.search(t))
        return _normalize_phone(match.group()) if match else ""   # 전화 패턴 없으면 드롭
    if field == "fax_number":
        t = _intl_to_domestic(text)
        match = (LANDLINE_PATTERN.search(t) or MOBILE_PATTERN.search(t)
                 or _PHONE_LOOSE.search(t))
        return _normalize_phone(match.group()) if match else ""
    if field == "total_amount":
        return _clean_amount(text)
    if field == "purchase_date":
        return _clean_purchase_date(text)
    if field == "event_start_date":
        return _clean_event_date(text, "start")
    if field == "event_end_date":
        return _clean_event_date(text, "end")
    if field == "location":
        return _clean_location(text)
    if field == "organizer_name":
        return _clean_organizer(text)
    if field == "store_name":
        # 어긋난 괄호 '[주)' → '(주)' 정도만 정돈(상호명 자체는 보존).
        t = text.strip().replace("[주)", "(주)").replace("(주]", "(주)")

        # **라벨을 떼고, 라벨만 남으면 드롭한다.**
        # STORE_KEYWORDS 는 상호를 가리키는 *라벨*("상호"/"매장"/"가맹점")인데
        # 종전에는 그 라벨이 붙은 블록을 store_name 으로 분류만 하고 값을 그대로 뒀다.
        # 실측(IC신용승인 영수증): 가게 이름 칸에 **"가맹점"** 이 들어갔다 — 라벨이
        # 값 자리를 차지하면 사용자는 그것이 인식된 상호인 줄 알고 그대로 저장한다.
        # 영수증은 "가맹점 : 김밥천국" 처럼 한 줄에 오기도, 라벨만 한 블록이기도 하다.
        t = re.sub(r"^\s*(?:상\s*호|매\s*장|가\s*맹\s*점)\s*(?:명)?\s*[:：)\]]?\s*", "", t)
        if not t or t in ("상호", "매장", "가맹점", "상호명"):
            return ""

        # 영수증 하단 안내문구를 배제한다. STORE_KEYWORDS 가 부분문자열 검사라
        # "가맹점명,가맹점주소가 실제와 다르면 신고…" 같은 문장이 store_name 으로 잡히고,
        # 라벨 접두를 떼고 나면 그 꼬리(",가맹점주소가 실제와 다")가 상호 자리에 남는다.
        # 실측(한국신용카드결제 영수증)에서 그대로 재현됐다.
        if _RECEIPT_NOTICE.search(t):
            return ""

        # 대괄호 라벨과 그 꼬리를 떼어낸다: "[가맹점] No:" → 빈 값.
        # OCR 이 라벨 블록을 "[가맹점] 가맹점No:" 처럼 흘려 놓으면 위 선두 라벨 제거만으로는
        # "] No:" 같은 조각이 남는다. 실측(한국신용카드결제 영수증)에서 그 조각이 상호가 됐다.
        t = re.sub(r"\[[^\]]*\]", " ", t)
        # 대괄호를 떼면 라벨이 다시 드러난다("[가맹점] 가맹점No:" → " 가맹점No:").
        # 선두 라벨 제거를 한 번 더 돌린다.
        t = re.sub(r"^\s*(?:상\s*호|매\s*장|가\s*맹\s*점)\s*(?:명)?\s*[:：)\]]?\s*", "", t)
        t = re.sub(r"\b(?:No|NO|no)\s*[.:：]?\s*$", "", t)
        t = t.strip(" .,:：;|/\\-")

        # 업종 일반명사만 남은 경우도 상호가 아니다("편의점", "마트", "약국").
        if t in ("편의점", "마트", "약국", "식당", "카페", "주유소", "백화점", "지점", "본점"):
            return ""
        if len(t) < 2:
            return ""
        return t
    if field == "job_title":
        t = text.strip()
        # 짧은 비한글 노이즈("FP" 등) 드롭: 한/영 직책키워드 어디에도 없으면 의심.
        if re.fullmatch(r"[A-Za-z]{1,3}", t) and not any(t.lower() == k.lower() for k in JOB_TITLE_KEYWORDS):
            return ""
        return t
    if field == "address":
        t = text.strip()
        # 선두 우편번호(5자리) 분리: "38541경상북도…" → 주소값에서 떼어냄
        # (zip_code 는 별도 필드. 붙은 zip 이 주소 앞에 남으면 도로명주소 정규화 깨짐).
        t = re.sub(r"^\s*\d{5}\s*[,]?\s*", "", t)
        # 주소 마커(시/구/동/로/길…)가 2개 미만이고 숫자도 없으면 불완전 조각
        # ("덕암"=회사조각, "화랑로"=도로명만) → 드롭(빈칸 > 주소로 못 쓸 단편).
        if len(ADDRESS_PATTERN.findall(t)) >= 2 or re.search(r"\d", t):
            return t
        return ""
    if field == "english_name":
        # 슬로건/태그라인("SINCE 2001","2026") 방지: 숫자 포함이면 이름 아님 → 드롭.
        return "" if re.search(r"\d", text) else text.strip()
    if field in ("website", "website_url"):
        match = WEBSITE_PATTERN.search(text)
        if not match:
            return ""
        # \S+ 가 후행 닫는괄호/한글/꼬리("kr)를")까지 삼킴 → 절단.
        url = re.sub(r"[)\]\}>」』】가-힣].*$", "", match.group()).rstrip(".,;")
        url = re.sub(r"^(https?):/(?!/)", r"\1://", url)   # 'http:/' → 'http://' 복원
        # 유효 TLD 없는 깨진 URL("www.kistiLre")은 드롭(빈칸 > 접속불가 링크).
        if not re.search(r"\.(com|co|kr|net|org|io|ac|go|or|edu|biz|info|dev|app)\b", url, re.I):
            return ""
        # 스킴 없으면 https:// 보정(명함의 www./맨도메인). 호스트(스킴+도메인) 소문자.
        if not re.match(r"(?i)^https?://", url):
            url = "https://" + url
        m2 = re.match(r"(?i)^(https?://)([^/]+)(.*)$", url)
        if m2:
            url = m2.group(1).lower() + m2.group(2).lower() + m2.group(3)
        return url
    # 티켓: 교통수단은 정규화된 이름으로 반환
    if field == "transport_type":
        upper = text.upper()
        for kw, normalized in TRANSPORT_NORMALIZE.items():
            if kw.upper() in upper:
                return normalized
        return text.strip()
    # 티켓 시각: HH:MM 만 추출. (라벨:값 정규식이 "21:00"의 콜론을 라벨구분자로
    # 오인해 분 "00"만 남기던 버그 방지.)
    if field in ("departure_time", "arrival_time"):
        m = re.search(r"\d{1,2}\s*:\s*\d{2}", text)
        if m:
            return re.sub(r"\s+", "", m.group())
        m2 = re.search(r"(?:오전|오후)?\s*\d{1,2}\s*시(?:\s*\d{1,2}\s*분)?", text)
        return m2.group().strip() if m2 else ""
    # 티켓 날짜: 실제 날짜만 채택. 표번호 "NO. 19-672030"(월19 비현실)은 드롭.
    #
    # **반드시 ISO(YYYY-MM-DD)로 내보낸다.** 원문을 그대로 돌려주면 앱이 저장을 막는다:
    # departure_date/arrival_date 는 앱 fieldSchema 에서 inputType 'date' 이고,
    # 그 zod 스키마가 isIsoDate(^\d{4}-\d{2}-\d{2}$)를 강제한다 → validateFields 가
    # 오류를 내고 canSave 가 false 가 된다.
    # 실측(KTX 승차권): 파싱은 7/7 완벽한데 departure_date 가 "2026.06.15" 로 나가
    # **저장 버튼이 동작하지 않았다.** 포스터 쪽(event_*_date)은 _clean_event_date →
    # _to_iso_datetime 을 타서 ISO 로 나오는데 티켓만 이 경로를 건너뛰고 있었다.
    if field in ("departure_date", "arrival_date"):
        # 1) 4자리 연도 포함 형식 우선(YYYY.MM.DD / YYYY년 MM월 DD일)
        m = re.search(r"\d{4}\s*[년.\-/]\s*\d{1,2}\s*[월.\-/]\s*\d{1,2}\s*일?", text)
        if m:
            return _to_iso_datetime(m.group())[:10]
        # 2) MM.DD / MM월 DD일 — 단 월≤12, 일≤31 인 현실 범위만(일련번호 배제)
        #    연도가 없으면 _to_iso_datetime 이 올해로 보정한다(포스터와 같은 휴리스틱).
        for mm in re.finditer(r"(\d{1,2})\s*[월/.\-]\s*(\d{1,2})\s*일?", text):
            mo, da = int(mm.group(1)), int(mm.group(2))
            if 1 <= mo <= 12 and 1 <= da <= 31:
                return _to_iso_datetime(mm.group())[:10]
        return ""
    # 티켓 위치: "라벨 : 값" 패턴에서 값만 추출
    if field in ("departure_location", "arrival_location"):
        label_match = re.match(r"^[\-▶►●·※\[\]\s]*(.+?)\s*[:：]\s*(.+)$", text.strip())
        if label_match:
            return label_match.group(2).strip()
        return text.strip()
    # departure_location이지만 여정(출발-도착) 합쳐진 경우 → 출발지만 반환
    # (도착지는 _split_ticket_compound_fields에서 별도 블록으로 분리됨)
    if field == "_route_departure":
        return text.strip()
    if field == "_route_arrival":
        return text.strip()
    if field == "person_name":
        # 공백 포함된 한국어 이름("이 응 환") → 공백 제거("이응환")
        name_no_space = re.sub(r"\s+", "", text.strip())
        if re.match(r"^[가-힣]{2,4}$", name_no_space):
            return name_no_space
        return text.strip()
    return text


# ════════════════════════════════════════════
# 공유 세그멘터 — "한 줄에 두 필드" 혼합 블록 분할
# ════════════════════════════════════════════
#
# [목적]
# "강미경 010.6498.5121"(person_name+mobile_phone) 처럼 한 OCR 라인에
# 이름/회사 등 비패턴 텍스트 + 전화/이메일/URL 패턴이 섞인 블록을,
# 분류기에 넘기기 전에 두 조각으로 쪼개는 공유 분할기.
#
# [원칙] 세그멘터는 '분할'만 한다. 무슨 필드인지 라벨링은 분류기/모델 몫.
#
# [두 형태 — 같은 코어(_segment_core)를 공유]
#   (a) segment_lines(list[str]) -> list[str]
#         각 원본 라인을 0~N개 세그먼트 문자열로 펼침(순서보존).
#         build_dataset / gold_scaffold(문자열 라인 리스트)용.
#   (b) segment_text_blocks(list[dict]) -> list[dict]
#         text/confidence/bbox/block_index 보존. 한 블록이 여러 세그먼트로
#         늘면 동일 block_index 유지(기존 _split 관행). rule/ml 런타임용.
#
# 기존 _split_multi_pattern_blocks 는 segment_text_blocks 의 별칭으로 보존.

# 전화 → 이메일/URL 순으로 매칭(전화번호를 먼저 확정해야 이메일 패턴이
# 전화 숫자를 로컬파트로 삼키는 것을 방지). 코어/별칭 모두 재사용.
_PHONE_PATTERNS = [MOBILE_PATTERN, LANDLINE_PATTERN]
_OTHER_PATTERNS = [EMAIL_PATTERN, LINK_PATTERN]

# 확장 라벨 가드 — 기존 PHONE_KEYWORDS/FAX_KEYWORDS 가 못 잡는
# 단일/공백분리/한글 라벨(예: "H P", "M ", "T ", "F ", "E-mail.", 한글라벨)을
# 보강. prefix 가 '오직 라벨키워드(+구두점/공백)만' 으로 끝날 때만 매치.
SEGMENT_LABEL_GUARD = re.compile(
    r"(?i)^\s*(?:"
    r"(?:h|c|m)\s*\.?\s*p\.?"  # H P / H.P / HP / C.P / CP / M.P / MP (모바일 라벨)
    r"|e[-.\s]?mail\.?"        # E-mail. / Email / E mail
    r"|mobile|phone|tel|fax"   # 풀워드
    r"|[mtfeh]"                # 단일문자 라벨 M/T/F/E/H
    r"|에이치피|휴대폰|핸드폰|전화|팩스|이메일"  # 한글 라벨
    r")\s*[:.\-]?\s*$"
)


def _is_meaningful_nonpattern(s: str) -> bool:
    """비패턴 조각이 '의미있는 텍스트'(이름/회사/주소조각)인지 판정.

    공백/구두점/구분자(-,·,|,/,:,.,(),쉼표)를 제거한 알맹이가 2자 이상이면 True.
    → 단독 '|','-','·',',', 1글자 '0' 등은 버림(False).
    """
    if not s:
        return False
    core = re.sub(r"[\s\-·|/:.,()]+", "", s.strip())
    return len(core) >= 2


# 패턴 바로 앞에 붙는 trailing 라벨토큰(공백/구두점 제외) 매칭용.
# 예: '동793)T.' 의 끝 'T.', '강미경 Mobile.' 의 끝 'Mobile.', 'HP.' 등.
_TRAILING_LABEL = re.compile(
    r"(?i)(?:"
    r"(?:h|c|m)\s*\.?\s*p\.?"  # H P / H.P / HP / C.P / CP / M.P / MP (모바일 라벨)
    r"|e[-.\s]?mail\.?"        # E-mail.
    r"|mobile|phone|tel|fax"   # 풀워드
    r"|에이치피|휴대폰|핸드폰|전화|팩스|이메일"  # 한글 라벨
    r"|(?<![A-Za-z가-힣])[mtfeh]"  # 단일문자 라벨(앞이 영문/한글이 아닐 때만)
    r")\s*[:.\-]?\s*$"
)


def _is_label_keyword(prefix: str) -> bool:
    """패턴 앞/뒤 텍스트가 전화/팩스/이메일 '라벨'로 끝나면 True(=분할 금지).

    1) 확장 라벨 가드 SEGMENT_LABEL_GUARD: prefix 전체가 라벨키워드(+구두점)뿐.
    2) trailing 라벨토큰: prefix 가 라벨(T./Mobile./HP. 등)로 '끝나는' 경우.
       → '동793)T.'(주소+라벨), '강미경 Mobile.' 처럼 라벨이 패턴 바로 앞에
         붙어있으면 그 라벨은 패턴에 귀속(앞 알맹이는 호출부에서 별도 처리).
    3) 기존 PHONE_KEYWORDS/FAX_KEYWORDS 재사용(요구사항 충족).
    """
    s = prefix.strip()
    if not s:
        return False
    if SEGMENT_LABEL_GUARD.match(s):
        return True
    if _TRAILING_LABEL.search(s):
        return True
    if PHONE_KEYWORDS.search(s) or FAX_KEYWORDS.search(s):
        residue = PHONE_KEYWORDS.sub("", s)
        residue = FAX_KEYWORDS.sub("", residue)
        if not _is_meaningful_nonpattern(residue):
            return True
    return False


# 공백분리 한글 음절 이름꼴: "최 용 연", "이 응 환" (2~4 음절, 음절 사이 공백).
# ⚠️'음절 사이 공백'이 핵심 가드 — "전자"/"화학"/"그룹"/"솔루션즈" 같은 붙은
#   한글(회사/내용어)은 내부 공백이 없어 매칭 안 됨 → 오분할 방지.
_SPACED_HANGUL_NAME = r"[가-힣](?:\s+[가-힣]){1,3}"
# 로마자명꼴: 각 토큰 첫 글자 대문자(+하이픈 허용), 숫자 없음, 1~4토큰.
#   "Choi Yong-Yeon", "Hong Gil-Dong", "Choi".
_ROMAN_NAME = r"[A-Z][A-Za-z]*(?:-[A-Za-z]+)*(?:\s+[A-Z][A-Za-z]*(?:-[A-Za-z]+)*){0,3}"

_NAME_HANGUL_LATIN = re.compile(r"^(" + _SPACED_HANGUL_NAME + r")\s+(" + _ROMAN_NAME + r")$")
_NAME_LATIN_HANGUL = re.compile(r"^(" + _ROMAN_NAME + r")\s+(" + _SPACED_HANGUL_NAME + r")$")


def _split_name_script(text: str) -> list[str]:
    """"최 용 연 Choi Yong-Yeon" 류(공백분리 한글이름 + 로마자명)만 두 조각으로 분리.

    전화/이메일/URL 패턴이 없는 라인에만 적용된다(_segment_core 의 무패턴 분기).
    한글측이 '공백분리 음절 이름꼴'일 때만 발동해 회사명/직책/주소/내용어의
    한글+로마자 혼합(예 "CJ그룹","LG화학","Stable Diffusion","ICT 융합")은 건드리지 않는다.
    분리 불가 시 [text] 그대로 반환.
    """
    s = text.strip()
    m = _NAME_HANGUL_LATIN.match(s) or _NAME_LATIN_HANGUL.match(s)
    if m:
        a, b = m.group(1).strip(), m.group(2).strip()
        if a and b:
            return [a, b]
    return [text]


# 한글 직책 키워드(이름 앞에 붙는 "영업이사 권 오 창" 분리용)
_JOB_KW_RE = re.compile(
    "(" + "|".join(re.escape(k) for k in JOB_TITLE_KEYWORDS if re.search(r"[가-힣]", k)) + ")"
)


def _split_title_name(text: str) -> list[str]:
    """"영업이사 권 오 창"/"팀장 한 명 화" 류(직책 + 공백분리 한글이름)를 분리.

    suffix 가 '공백분리 한글 음절 이름꼴'일 때만 발동(강한 이름 신호) → 직책 자체
    ("울산지사 부장")나 일반 텍스트는 건드리지 않는다. head 가 직책키워드를 포함하고
    name 측에는 직책키워드가 없을 때만 분리.
    """
    s = text.strip()
    last = None
    for m in _JOB_KW_RE.finditer(s):
        last = m
    if not last:
        return [text]
    head, tail = s[:last.end()].strip(), s[last.end():].strip()
    tail_ns = tail.replace(" ", "")
    # tail 이 깔끔한 한글 이름(2~4음절)이고 직책키워드 미포함일 때만 분리.
    if head and 2 <= len(tail_ns) <= 4 and re.fullmatch(r"[가-힣]{2,4}", tail_ns) \
            and not _JOB_KW_RE.search(tail_ns):
        return [head, tail]
    return [text]


def _segment_core(text: str) -> list[str]:
    """한 줄(text)을 0~N개 세그먼트 문자열로 분할. 라벨링은 안 함.

    기존 _split_multi_pattern_blocks 의 패턴매칭/마스킹 로직을 그대로 흡수하고,
    '패턴 1개 + 의미있는 비패턴 접두/접미' 분리를 추가한다.
    - filtered>=2(다중패턴): 기존 매치경계 분할을 100% 보존(회귀금지).
      단 i==0 의 prefix 에는 NEW 단일패턴 규칙(이름 분리)을 동일 적용.
    - filtered==1(단일패턴): NEW. 패턴 앞/뒤 비키워드 의미텍스트를 별도 분리.
    """
    text = text.strip()
    if not text:
        return []

    # Step 1: **이메일/URL 을 먼저 확정한다.**
    #
    # 순서가 반대였고, 그것이 이메일을 통째로 잃는 원인이었다. 이메일 로컬파트에
    # 숫자가 길게 들어가면 그 안에서 휴대폰 패턴이 매치된다:
    #     a01077441010@gmail.com
    #      ^^^^^^^^^^^  MOBILE_PATTERN 매치
    # 전화를 먼저 확정하면 세그멘터가 여기서 잘라 'E-mail:a' / '01077441010' /
    # '@gmail.com/…' 세 조각이 되고, 이메일 필드가 통째로 사라진다.
    # (실측: 선거 홍보 명함 "E-mail:a01077441010@gmail.com/H.P : 010-7744-1010")
    # 이메일/URL 은 경계가 명확한 강한 패턴이라 먼저 잡고 마스킹하는 것이 옳다.
    other_matches = []
    for pattern in _OTHER_PATTERNS:
        for m in pattern.finditer(text):
            other_matches.append((m.start(), m.end()))
    other_matches.sort(key=lambda x: x[0])
    other_filtered = []
    for start, end in other_matches:
        if not other_filtered or start >= other_filtered[-1][1]:
            other_filtered.append((start, end))

    # Step 2: 이메일/URL 영역 마스킹 후 전화번호 매칭
    masked = list(text)
    for os_, oe in other_filtered:
        for i in range(os_, oe):
            masked[i] = "\x00"
    masked_text = "".join(masked)

    phone_matches = []
    for pattern in _PHONE_PATTERNS:
        for m in pattern.finditer(masked_text):
            phone_matches.append((m.start(), m.end()))
    phone_matches.sort(key=lambda x: x[0])
    phone_filtered = []
    for start, end in phone_matches:
        if not phone_filtered or start >= phone_filtered[-1][1]:
            phone_filtered.append((start, end))

    # Step 3: 전체 매치 합치기(start 정렬 + 비겹침)
    all_matches = phone_filtered + other_filtered
    all_matches.sort(key=lambda x: x[0])
    filtered = []
    for start, end in all_matches:
        if not filtered or start >= filtered[-1][1]:
            filtered.append((start, end))

    # 패턴(전화/이메일/URL)이 하나도 없으면:
    # 공백분리 한글이름 + 로마자명("최 용 연 Choi Yong-Yeon") 또는
    # 직책 + 공백분리 한글이름("영업이사 권 오 창")만 좁게 분리. 그 외는 원본 그대로.
    if len(filtered) == 0:
        segs = _split_name_script(text)
        if len(segs) == 1:
            segs = _split_title_name(text)
        return segs

    def _emit_prefix(prefix: str, segs: list):
        """패턴 앞 prefix 를 NEW 규칙으로 처리.

        - 의미텍스트 & 비라벨 → 별도 세그먼트로 분리(이름/회사). 패턴엔 안 붙임.
        - 라벨키워드(가드ON) → 패턴에 그대로 붙여둠(예 'Mobile.','T.','동793)T.').
        - 그 외(순수 구두점/공백 등 무의미) → 버림(예 '· ','  '). 패턴엔 안 붙임.
        """
        if _is_label_keyword(prefix):
            return prefix   # 라벨 → 패턴에 귀속
        if _is_meaningful_nonpattern(prefix):
            p = prefix.strip()
            if p:
                segs.append(p)
        return ""           # 분리했거나(이름) 무의미(구두점) → 패턴엔 안 붙임

    segments: list[str] = []
    n = len(filtered)
    for i, (start, end) in enumerate(filtered):
        if i == 0:
            prefix = text[:start]
        else:
            prefix = text[filtered[i - 1][1]:start]
        suffix = text[end:] if i == n - 1 else ""

        if n >= 2:
            # 다중패턴: 매치경계 분할 100% 보존.
            # 단 i==0 prefix(=맨 앞 이름) 에만 NEW 분리 규칙 적용.
            if i == 0:
                prefix = _emit_prefix(prefix, segments)
            seg = (prefix + text[start:end] + suffix).strip()
            if seg:
                segments.append(seg)
        else:
            # 단일패턴(NEW): 접두/접미 의미텍스트 분리.
            # ⚠️경계 가드(데이터손상 회귀 방지): 패턴 매치가 더 큰 영숫자 토큰의
            # 부분문자열(바코드/계좌/거래번호/AID 등 긴 숫자토큰)이면 분리 금지.
            #   - 매치 시작 직전 문자가 영숫자([0-9A-Za-z]) → prefix 가 토큰의 일부
            #   - 매치 종료 직후 문자가 영숫자          → suffix 가 토큰의 일부
            # 정상('강미경 010..','(주)린텍 010..')은 패턴 앞이 공백/한글이라 무영향.
            prefix_attached = bool(prefix) and prefix[-1:].isalnum()
            suffix_attached = bool(suffix) and suffix[:1].isalnum()
            if prefix_attached or suffix_attached:
                # 더 큰 토큰의 부분매치 → 분할하지 않고 원본 라인 그대로 유지.
                return [text]
            prefix = _emit_prefix(prefix, segments)
            # 접미(suffix)도 동일 규칙 — 패턴 뒤 비키워드 의미텍스트면 별도 분리
            tail = ""
            if suffix and _is_meaningful_nonpattern(suffix) and not _is_label_keyword(suffix):
                tail = suffix.strip()
                suffix = ""
            seg = (prefix + text[start:end] + suffix).strip()
            if seg:
                segments.append(seg)
            if tail:
                segments.append(tail)

    # 정제: 패턴 미포함 순수-비패턴 조각(2자 미만/순수구두점)은 버림.
    # 패턴을 포함한 세그먼트는 길이무관 항상 유지.
    cleaned = []
    for seg in segments:
        s = seg.strip()
        if not s:
            continue
        has_pattern = (
            MOBILE_PATTERN.search(s) or LANDLINE_PATTERN.search(s)
            or EMAIL_PATTERN.search(s) or LINK_PATTERN.search(s)
        )
        if has_pattern or _is_meaningful_nonpattern(s):
            cleaned.append(s)

    # 모두 버려졌으면 원본 폴백(완전소실 방지)
    return cleaned if cleaned else [text]


def segment_lines(lines: list[str]) -> list[str]:
    """형태(a): 문자열 라인 리스트를 분할해 펼침(순서보존).

    한 줄이 1개 세그먼트면 그대로, N개면 펼친다. 빈 줄은 원본 유지(인덱스 보존).
    build_dataset / gold_scaffold(라인 리스트, block_index 개념 없음)용.
    """
    out: list[str] = []
    for ln in lines:
        s = (ln or "").strip()
        if not s:
            out.append(ln)
            continue
        segs = _segment_core(s)
        out.extend(segs if segs else [s])
    return out


def segment_text_blocks(text_blocks: list[dict]) -> list[dict]:
    """형태(b): dict 블록을 분할(text/confidence/bbox/block_index 보존).

    한 블록이 여러 세그먼트로 늘면 동일 block_index 유지(기존 _split 관행).
    세그먼트가 0~1개면 원본 블록을 그대로 통과(무변경).

    예:
      "강미경 010.6498.5121" → ["강미경", "010.6498.5121"]
      "F.053-813-1212E.ukneeon@naver.com"
        → ["F.053-813-1212", "E.ukneeon@naver.com"]
      "Mobile.010.4965.4540" → ["Mobile.010.4965.4540"] (라벨 가드)
    """
    expanded = []
    for block in text_blocks:
        s = (block.get("text") or "").strip()
        segs = _segment_core(s) if s else []
        if len(segs) <= 1:
            expanded.append(block)
            continue
        for seg in segs:
            expanded.append({
                "text": seg,
                "confidence": block.get("confidence", 0.0),
                "bbox": block.get("bbox"),
                "block_index": block["block_index"],
            })
    return expanded


# 기존 호출부 호환: _split_multi_pattern_blocks 는 segment_text_blocks 의 별칭.
# classify_all_blocks 의 호출부는 무수정으로 새 분할 로직(단일패턴 분리 포함) 흡수.
_split_multi_pattern_blocks = segment_text_blocks


# ════════════════════════════════════════════
# 포스터 분류기
# ════════════════════════════════════════════

def classify_text_block_for_poster(text: str) -> str:
    """
    포스터용 단일 텍스트 블록을 스키마 필드로 분류.

    판별 순서:
    1) 이메일 → contact_email
    2) URL 링크 → website_url
    3) 전화번호(휴대폰/유선) → contact_phone
    4) 주최/주관 키워드 → organizer_name
    5) 장소 키워드 → location
    6) 날짜 패턴 + 종료 키워드 → event_end_date
    7) 날짜 패턴 + 시작 키워드(또는 키워드 없음) → event_start_date
    8) 해당 없음 → unknown (가장 긴 unknown을 title로 승격)
    """
    text_stripped = text.strip()
    if not text_stripped:
        return "unknown"

    lower = text_stripped.lower()

    # 1) 이메일 확인
    if EMAIL_PATTERN.search(text_stripped):
        return "contact_email"

    # 2) URL 링크 확인 — 스킴/www 없는 맨도메인(foo.co.kr)도 포함(포스터 홈페이지)
    if WEBSITE_PATTERN.search(text_stripped):
        return "website_url"

    # 3) 전화번호 확인 (휴대폰 또는 유선) — +82 국제표기 환원 후 매칭
    _ptext = _intl_to_domestic(text_stripped)
    if MOBILE_PATTERN.search(_ptext) or LANDLINE_PATTERN.search(_ptext):
        return "contact_phone"

    # 4) 주최/주관 키워드 확인
    for kw in ORGANIZER_KEYWORDS:
        if kw in lower:
            return "organizer_name"

    # 4-b) 라벨 없는 기관명 → 주최자.
    #      **장소 검사보다 먼저 와야 한다.** 한국 기관명에는 "센터"가 흔한데 그것이
    #      LOCATION_KEYWORDS 에 있어서, 이 검사가 뒤에 오면 주최자가 전부 장소로
    #      흘러간다(_ORG_SUFFIX 주석의 실측 참조).
    #      단 주소 토큰이 함께 있으면 장소다 — "○○센터 3층 대강당" 은 주최자가 아니다.
    if _ORG_SUFFIX.search(text_stripped) and not _ADDRESS_HINT.search(text_stripped):
        return "organizer_name"

    # 5) 장소 키워드 확인
    #    날짜/시각이 이미 들어 있는 라인은 장소로 보지 않는다 — '3층 스텔라홀 14:00'
    #    같은 복합 라인이 아니라 '2026.08.22 SAT PM 2:30' 처럼 날짜 전용 라인이
    #    장소 키워드에 걸려 날짜를 잃는 것을 막는다. 날짜 판정은 아래 6번이 한다.
    if not (DATE_PATTERN.search(text_stripped) and TIME_PATTERN.search(text_stripped)):
        for kw in LOCATION_KEYWORDS:
            if kw in lower:
                return "location"
        # 영문 전치사 "at " 은 라벨이 아니라 문장의 일부라 값이 함께 있어야 인정한다.
        if LOCATION_PREPOSITION.search(text_stripped) and len(text_stripped) > 5:
            return "location"

    # 6) 날짜 패턴이 있으면 키워드로 event_end_date vs event_start_date 구분
    has_date = DATE_PATTERN.search(text_stripped)
    if has_date:
        # **선행 물결표는 "그날까지" 다.** "~7.31.(금)" 은 종료일이지 시작일이 아니다.
        # 포스터에서 "접수 ~7.31." 처럼 시작일을 생략하는 표기가 매우 흔한데,
        # 종전에는 "까지" 만 종료 키워드로 봐서 이 형태가 전부 시작일로 잡혔다.
        # 날짜가 **하나뿐일 때만** 본다 — "6.10 ~ 7.31" 처럼 둘이면 범위라
        # 아래 분기와 _clean_event_date 의 role 처리가 앞/뒤를 갈라 준다.
        if _LEADING_RANGE_MARK.match(text_stripped) and len(DATE_PATTERN.findall(text_stripped)) == 1:
            return "event_end_date"

        for kw in EVENT_END_KEYWORDS:
            if kw in lower:
                return "event_end_date"
        for kw in EVENT_START_KEYWORDS:
            if kw in lower:
                return "event_start_date"
        # 키워드 없는 날짜 → 행사 시작일로 기본 분류
        return "event_start_date"

    return "unknown"


# ════════════════════════════════════════════
# 영수증 분류기
# ════════════════════════════════════════════

def classify_text_block_for_receipt(text: str) -> str:
    """
    영수증용 단일 텍스트 블록을 스키마 필드로 분류.

    판별 순서:
    1) 금액 패턴 + 합계 키워드 → total_amount
    2) 날짜 패턴 → purchase_date
    3) 업장 키워드 → store_name
    4) 해당 없음 → unknown
    """
    text_stripped = text.strip()
    if not text_stripped:
        return "unknown"

    lower = text_stripped.lower()

    # 1) 금액 + 합계 키워드 확인
    if PRICE_PATTERN.search(text_stripped):
        for kw in TOTAL_KEYWORDS:
            if kw in lower:
                return "total_amount"

    # 2) 날짜 패턴 확인 → 구매일자
    #
    #    **전화번호를 먼저 배제한다.** DATE_PATTERN 의 두 번째 교대(`\d{1,2}[.\-/]\d{1,2}`)가
    #    전화번호 안의 숫자쌍에 그대로 매치된다 — "+82 53-759-3560" 의 "53-759",
    #    "010-1234-5678" 의 "10-1234" 가 날짜로 보인다. 실측(앱 화면)에서
    #    구매일자 칸에 "+82 53-759-3560" 이 들어갔고, 앱의 date 검증(YYYY-MM-DD)에
    #    걸려 저장 버튼이 비활성이 됐다. 영수증에는 가게 전화번호가 거의 항상 있으므로
    #    실사용에서 반드시 재현된다.
    #    _intl_to_domestic 을 먼저 태워 "+82 53-…" 형태도 국내표기로 보고 판정한다.
    _ptext = _intl_to_domestic(text_stripped)
    if MOBILE_PATTERN.search(_ptext) or LANDLINE_PATTERN.search(_ptext):
        return "unknown"

    #    **날짜로 인정하는 조건을 좁힌다.** 영수증에는 날짜처럼 생긴 숫자가 지천이다 —
    #    사업자번호(536-37-00183), POS/전표번호(P0S:1021-5338), 승인번호, 금액의
    #    소수점(4.5001, 8.50), 카드번호 조각. 실측 19장에서 purchase_date 로 잡힌 값
    #    16건이 **전부 이런 쓰레기**였고 진짜 날짜는 한 건도 못 건졌다.
    #    연도 4자리가 있거나(2026.02.27, 2018/01/30) 한국어 날짜 표기(6월 15일)일 때만
    #    받는다. "MM.DD" 만 있는 형태는 영수증에서 오탐이 압도적이라 버린다.
    if _RECEIPT_DATE_STRICT.search(text_stripped):
        return "purchase_date"

    # 3) 업장명 키워드 확인
    for kw in STORE_KEYWORDS:
        if kw in lower:
            return "store_name"

    return "unknown"


# ── 영수증 전용 후처리 ────────────────────────────────────────────────────────
#
# 영수증 OCR 은 **라벨과 값이 다른 블록으로 쪼개져 온다.** 실측(IC신용승인 영수증):
#     5 "가맹점"          6 "김태준의 탕탕집"
#    20 "계"             21 "7.500"
#    13 "사업자"         11 "536-37-00183"
# 블록 하나만 보는 classify_text_block_for_receipt 는 이 구조에서 무력하다 —
# 라벨 블록은 값이 없어 라벨 자체가 값이 되고, 값 블록은 라벨이 없어 unknown 이 된다.
# 실제로 19장 기준 total_amount 는 **0장**, store_name 은 라벨("가맹점")만 잡혔다.
#
# 그래서 블록 리스트 전체를 보고 (라벨 블록 → 다음 블록) 관계를 먼저 해소한다.

# 합계 라벨. OCR 이 "합계"의 앞 글자를 흘려 "계"만 남기는 일이 잦아 단독 "계"도 받는다.
# 단 "설계"/"통계" 같은 단어에 걸리지 않도록 **블록 전체가 라벨일 때만** 인정한다.
# "합계금액"/"결제금액"/"총 금액" 처럼 뒤에 '금액'/'요금'이 붙는 표기가 흔하다.
# 종전 정규식은 그걸 허용하지 않아 롯데하이마트 영수증의 "합계금액" 을 라벨로 못 봤다.
_RECEIPT_TOTAL_LABEL = re.compile(
    r"^\s*(?:합\s*계|총\s*액|총\s*합|합\s*산|결\s*제|청\s*구|받\s*을\s*금\s*액|계|total)"
    r"\s*(?:금\s*액|요\s*금)?\s*[:：]?\s*$",
    re.I,
)
_RECEIPT_STORE_LABEL = re.compile(r"^\s*(?:가\s*맹\s*점|상\s*호|매\s*장)\s*(?:명)?\s*[:：]?\s*$")
_RECEIPT_DATE_LABEL = re.compile(r"^\s*(?:거래\s*일시|거래\s*일자|구매\s*일시|구매\s*일자|일\s*시|승인\s*일시)\s*[:：]?\s*$")

# 값 후보: 금액처럼 보이는 숫자(구분자 . 또는 ,). "7.500" 처럼 천단위를 마침표로 쓰는
# 영수증이 많아 소수점과 구분이 안 된다 — 그래서 **뒤 3자리** 형태만 금액으로 본다.
#
# 마지막 그룹은 2~3자리를 허용한다. OCR 이 끝자리를 흘리는 일이 흔하다 —
# 실측(롯데하이마트): "합계금액" 다음 블록이 "66,00" 이었다(원본 66,000).
# 3자리만 받으면 이 영수증이 통째로 0필드가 된다.
# 소수점 금액(9.38 / 9,41)은 여전히 배제된다 — 정수부가 1자리라 이 패턴에 안 맞고,
# 애초에 원화 영수증이 아니다(외국 영수증까지 맞히는 것은 이 파서의 범위가 아니다).
_RECEIPT_MONEY = re.compile(
    r"^\s*[₩\\]?\s*\d{1,3}(?:[.,]\d{3})*[.,]\d{2,3}\s*원?\s*$"
    r"|^\s*[₩\\]?\s*\d{1,3}(?:[.,]\d{3})+\s*원?\s*$"
    r"|^\s*\d{4,}\s*원\s*$"
)


def _classify_receipt_blocks(text_blocks: list[dict]) -> list[dict]:
    """영수증 블록을 분류한다. 라벨 블록과 그 다음 값 블록을 짝지어 해소한다.

    단일 블록 규칙(classify_text_block_for_receipt)을 기본으로 쓰되,
    라벨-값이 쪼개진 경우를 먼저 처리해 그 결과를 우선한다.
    """
    n = len(text_blocks)
    fields: list[str] = ["unknown"] * n

    def next_nonempty(i: int) -> int:
        for j in range(i + 1, min(i + 4, n)):   # 라벨 바로 뒤 3블록까지만 본다
            if (text_blocks[j].get("text") or "").strip():
                return j
        return -1

    # 1) 라벨 블록 → 다음 값 블록에 필드를 부여한다. 라벨 블록 자체는 unknown 으로 남긴다.
    for i, b in enumerate(text_blocks):
        t = (b.get("text") or "").strip()
        if not t:
            continue
        j = -1
        target = None
        if _RECEIPT_TOTAL_LABEL.match(t):
            j, target = next_nonempty(i), "total_amount"
        elif _RECEIPT_STORE_LABEL.match(t):
            j, target = next_nonempty(i), "store_name"
        elif _RECEIPT_DATE_LABEL.match(t):
            j, target = next_nonempty(i), "purchase_date"
        if j < 0 or target is None:
            continue
        vt = (text_blocks[j].get("text") or "").strip()
        # 값 자리에 또 라벨이 오면(연속 라벨) 짝짓지 않는다.
        if (_RECEIPT_TOTAL_LABEL.match(vt) or _RECEIPT_STORE_LABEL.match(vt)
                or _RECEIPT_DATE_LABEL.match(vt)):
            continue
        if target == "total_amount" and not _RECEIPT_MONEY.match(vt):
            continue     # 합계 라벨 뒤가 금액이 아니면 버린다(레이아웃이 어긋난 것)
        if fields[j] == "unknown":
            fields[j] = target

    # 2) 남은 블록은 단일 블록 규칙으로 채운다.
    for i, b in enumerate(text_blocks):
        if fields[i] != "unknown":
            continue
        fields[i] = classify_text_block_for_receipt((b.get("text") or "").strip())

    # 3) 상호를 못 찾았으면 **상단 업체명**을 후보로 본다.
    #    한국 영수증은 맨 위에 상호를 크게 찍고 "상호:" 라벨을 생략하는 쪽이 더 흔하다.
    #    실측(롯데하이마트 영수증): 1번 블록이 "롯데하이마트(주) 중주롯데마트점" 인데
    #    라벨이 없어 아무 필드도 안 붙었고, 그 영수증이 통째로 0필드가 됐다.
    #    상위 5블록 안에서 기업 표기(_ORG_SUFFIX)나 "…점" 으로 끝나는 한글 블록을 찾는다.
    if "store_name" not in fields:
        for i, b in enumerate(text_blocks[:5]):
            if fields[i] != "unknown":
                continue
            t = (b.get("text") or "").strip()
            if len(t) < 3 or len(t) > 40:
                continue
            if not re.search(r"[가-힣]", t):
                continue                       # 영문 로고 줄은 상호로 쓰지 않는다
            if _RECEIPT_NOTICE.search(t):
                continue
            if _ORG_SUFFIX.search(t) or re.search(r"(?:점|마트|백화점|편의점)\s*$", t):
                fields[i] = "store_name"
                break

    results = []
    for b, f in zip(text_blocks, fields):
        text = (b.get("text") or "").strip()
        clean = extract_clean_value(text, f) if f != "unknown" else text
        results.append({
            "text": clean,
            "confidence": b.get("confidence", 0.0),
            "bbox": b.get("bbox"),
            "block_index": b["block_index"],
            "field": f,
        })
    return results


# ════════════════════════════════════════════
# 티켓 분류기
# ════════════════════════════════════════════

# 캡쳐 티켓에서 "라벨 : 값" 패턴 매칭용 정규식
# 접두사: -, ▶, ►, ●, ·, ※, [] 등 제거
_LABEL_VALUE_PATTERN = re.compile(r"^[\-▶►●·※\[\]\s]*(.+?)\s*[:：]\s*(.+)$")

# 라벨 → 필드 매핑 (캡쳐 티켓 카카오 알림톡/앱 형태)
_TICKET_LABEL_MAP = {
    # 긴 키워드를 먼저 배치해야 "출발"이 "출발시간"보다 먼저 매칭되는 것을 방지
    # 교통수단/편명
    "항공편명": "transport_type", "항공편": "transport_type",
    "편명": "transport_type",
    # 출발 (긴 것 먼저)
    "출발일시": "departure_date", "출발시간": "departure_time",
    "출발일": "departure_date", "출발지": "departure_location",
    "출발": "departure_location",
    # 도착 (긴 것 먼저)
    "도착시간": "arrival_time", "도착일": "arrival_date",
    "도착지": "arrival_location", "도착": "arrival_location",
    # 구간/여정
    "구간": "departure_location", "여정": "departure_location",
    # 기타
    "좌석번호": "unknown", "좌석": "unknown",
    "예약번호": "unknown",
    "탑승객명": "unknown", "탑승객": "unknown",
    "승객명": "unknown", "승객": "unknown",
}


def classify_text_block_for_ticket(text: str) -> str:
    """
    티켓용 단일 텍스트 블록을 스키마 필드로 분류.

    캡쳐 티켓 지원을 위해 "라벨 : 값" 패턴을 우선 처리하고,
    매칭 안 되면 키워드 기반 분류로 폴백.
    """
    text_stripped = text.strip()
    if not text_stripped:
        return "unknown"

    lower = text_stripped.lower()

    # 캡쳐 티켓은 "라벨:값" 패턴 안에 있는 정보만 신뢰.
    # 단독 블록(UI 시계, 전화번호, 날짜 헤더 등)은 전부 노이즈.

    # 1) "라벨 : 값" 패턴 매칭
    label_match = _LABEL_VALUE_PATTERN.match(text_stripped)
    if label_match:
        label = label_match.group(1).strip().rstrip("-").strip()
        for key, field in _TICKET_LABEL_MAP.items():
            if key in label:
                return field

    # 2) 라벨 없이 교통수단 키워드가 포함된 블록 (예: "SRT 373", "KTX-산천 292")
    for kw in TRANSPORT_KEYWORDS:
        if kw.upper() in text_stripped.upper():
            return "transport_type"

    # 나머지는 전부 unknown (UI 노이즈)
    return "unknown"


# 여정 구분자: "포항경주(KPO) - 제주(CJU)", "TAE-CXR", "서울 → 부산"
_ROUTE_SEPARATORS = re.compile(r"\s*[-–—→>]\s*")

# 날짜+시간 분리: "2025.10.10(금)10:45", "2025-12-22(월)19:40"
_DATETIME_SPLIT = re.compile(
    r"^(.*?\d{4}[.\-/]\s*\d{1,2}[.\-/]\s*\d{1,2}(?:\s*\([가-힣]\))?)\s*(.*)$"
)


# 한국 기차역 화이트리스트 (SRT + KTX + ITX + 무궁화)
_STATION_NAMES = {
    # SRT
    "수서", "동탄", "평택지제", "천안아산", "오송", "대전", "김천구미",
    "동대구", "신경주", "경주", "울산", "부산",
    # KTX 추가
    "서울", "용산", "광명", "영등포", "수원", "천안", "조치원",
    "세종", "서대전", "익산", "전주", "남원", "광주송정", "광주",
    "목포", "나주", "순천", "여수엑스포", "여수", "포항", "강릉",
    "정동진", "동해", "삼척", "진주", "마산", "창원", "창원중앙",
    "밀양", "구포", "부전", "태화강",
    # 수도권/기타
    "청량리", "왕십리", "상봉", "양평", "원주", "제천", "충주",
    "안동", "영주", "춘천", "가평", "남춘천",
}

# "역명(시간)" 패턴: "동대구(05:48)", "수서(07:35)"
_STATION_TIME = re.compile(r"([가-힣]{2,5})\s*\((\d{1,2}:\d{2})\)")

# 시간 단독 패턴: "21:00", "13:23"
_TIME_ONLY = re.compile(r"^\d{1,2}:\d{2}$")


def _try_layout_based_ticket(text_blocks: list[dict]) -> list[dict] | None:
    """
    SRT/KTX 네이버 예매 승차권 레이아웃 기반 파싱.
    역명(한글 2~5자)과 시간(HH:MM)이 왼쪽/오른쪽에 쌍으로 배치된 패턴을 감지.
    성공하면 분류 결과 반환, 아니면 None.
    """
    # 역명 블록 찾기
    stations = []
    times = []
    date_block = None
    transport_block = None

    for b in text_blocks:
        text = b["text"].strip()
        bbox = b.get("bbox")
        if not bbox:
            continue
        x = bbox[0][0]

        # "역명(시간)" 합쳐진 패턴 (SRT 앱: "동대구(05:48)")
        st_matches = _STATION_TIME.findall(text)
        if st_matches:
            for station, time_str in st_matches:
                if station in _STATION_NAMES:
                    stations.append({"text": station, "x": x, "block": b})
                    times.append({"text": time_str, "x": x, "block": b})
                    x += 200  # 같은 블록 내 두 번째 매치는 오른쪽으로 취급
            continue

        # 역명 단독 (네이버 예매: "수서", "동대구")
        if text in _STATION_NAMES:
            stations.append({"text": text, "x": x, "block": b})
        elif _TIME_ONLY.match(text):
            times.append({"text": text, "x": x, "block": b})
        elif DATE_PATTERN.search(text) and len(text) >= 8 and not date_block:
            date_block = b
        elif any(kw.upper() in text.upper() for kw in TRANSPORT_KEYWORDS) and not transport_block:
            transport_block = b

    # 역명 2개 + 시간 2개가 있어야 레이아웃 기반 파싱
    if len(stations) < 2 or len(times) < 2:
        return None

    # x 좌표로 정렬 → 왼쪽이 출발, 오른쪽이 도착
    stations.sort(key=lambda s: s["x"])
    times.sort(key=lambda t: t["x"])

    results = []
    base = lambda b: {"confidence": b.get("confidence", 0.0), "bbox": b.get("bbox"), "block_index": b["block_index"]}

    # 출발역/도착역
    results.append({**base(stations[0]["block"]), "text": stations[0]["text"], "field": "departure_location"})
    results.append({**base(stations[-1]["block"]), "text": stations[-1]["text"], "field": "arrival_location"})

    # 출발시간/도착시간
    results.append({**base(times[0]["block"]), "text": times[0]["text"], "field": "departure_time"})
    results.append({**base(times[-1]["block"]), "text": times[-1]["text"], "field": "arrival_time"})

    # 날짜
    if date_block:
        date_text = date_block["text"].strip()
        results.append({**base(date_block), "text": date_text, "field": "departure_date"})
        # 기차/버스: 도착시간이 출발시간보다 크면(자정 안 넘김) 도착일 = 출발일
        dep_time = times[0]["text"]  # "21:00"
        arr_time = times[-1]["text"]  # "22:42"
        dep_h = int(dep_time.split(":")[0])
        arr_h = int(arr_time.split(":")[0])
        if arr_h >= dep_h:  # 자정 안 넘김
            results.append({**base(date_block), "text": date_text, "field": "arrival_date"})

    # 교통수단
    if transport_block:
        transport_name = extract_clean_value(transport_block["text"], "transport_type")
        results.append({**base(transport_block), "text": transport_name, "field": "transport_type"})

    # 나머지 블록은 unknown
    classified_indices = {r["block_index"] for r in results}
    for b in text_blocks:
        if b["block_index"] not in classified_indices:
            results.append({**base(b), "text": b["text"].strip(), "field": "unknown"})

    return results


def _classify_and_split_ticket_blocks(text_blocks: list[dict]) -> list[dict]:
    """
    티켓 블록을 분류한 뒤 복합 필드를 분리.
    1) SRT/KTX 레이아웃 기반 파싱 시도
    2) 실패 시 라벨:값 기반 파싱 (카카오 알림톡 등)
       - 여정(출발-도착 합쳐진 것) → departure_location + arrival_location
       - 출발일시(날짜+시간 합쳐진 것) → departure_date + departure_time
    """
    # SRT/KTX 레이아웃 기반 먼저 시도
    layout_result = _try_layout_based_ticket(text_blocks)
    if layout_result:
        return layout_result

    # 라벨과 값이 **다른 블록**으로 온 경우를 먼저 해소한다.
    #
    # 고속·시외버스 앱 화면이 이 형태다(실측, 0필드로 나온 유일한 티켓):
    #     7 "출발"        8 "서울경점표완료"
    #     9 "도착"       10 "동대구"
    #    12 "출발일"     13 "2026.02.28"
    #    16 "시간"       17 "10:40"
    # _TICKET_LABEL_MAP 은 "라벨:값" 이 한 블록일 때만 동작하므로 여기서는 전멸한다.
    # 영수증에서 쓴 것과 같은 접근이다 — 라벨 블록 뒤 3블록 안의 첫 비어있지 않은
    # 블록을 값으로 본다.
    label_field: dict[int, str] = {}
    _n = len(text_blocks)
    for i, b in enumerate(text_blocks):
        t = re.sub(r"\s+", "", (b.get("text") or "").strip())
        # 블록 **전체**가 라벨일 때만 인정한다. "출발일 2026.02.28" 처럼 값이 붙어
        # 있으면 기존 라벨:값 경로가 처리한다.
        target = _TICKET_LABEL_MAP.get(t)
        if target is None and t in ("시간", "출발시각", "도착시각"):
            target = "departure_time" if t != "도착시각" else "arrival_time"
        if not target or target == "unknown":
            continue
        for j in range(i + 1, min(i + 4, _n)):
            vt = (text_blocks[j].get("text") or "").strip()
            if not vt:
                continue
            # 값 자리에 또 라벨이 오면 짝짓지 않는다.
            if re.sub(r"\s+", "", vt) in _TICKET_LABEL_MAP:
                break
            if j not in label_field:
                label_field[j] = target
            break

    # 라벨:값 기반 파싱 (카카오 알림톡 등)
    results = []
    for idx, block in enumerate(text_blocks):
        text = block["text"].strip()
        field = label_field.get(idx) or classify_text_block_for_ticket(text)
        clean_text = extract_clean_value(text, field)
        base = {
            "confidence": block.get("confidence", 0.0),
            "bbox": block.get("bbox"),
            "block_index": block["block_index"],
        }

        # 여정 분리: "포항경주(KPO) - 제주(CJU)" → 출발지 + 도착지
        if field == "departure_location":
            parts = _ROUTE_SEPARATORS.split(clean_text)
            if len(parts) >= 2:
                results.append({**base, "text": parts[0].strip(), "field": "departure_location"})
                results.append({**base, "text": parts[-1].strip(), "field": "arrival_location"})
                continue

        # 출발일시 분리: "2025.10.10(금)10:45" → 날짜 + 시간
        if field in ("departure_date", "departure_time"):
            dt_match = _DATETIME_SPLIT.match(clean_text)
            if dt_match and dt_match.group(2).strip():
                results.append({**base, "text": dt_match.group(1).strip(), "field": "departure_date"})
                results.append({**base, "text": dt_match.group(2).strip(), "field": "departure_time"})
                continue

        results.append({**base, "text": clean_text, "field": field})

    return results


# ════════════════════════════════════════════
# 통합 분류 함수
# ════════════════════════════════════════════

def classify_all_blocks_for_type(text_blocks: list[dict], document_type: str = "BUSINESS_CARD") -> list[dict]:
    """
    문서 종류에 따라 적절한 분류 함수를 선택하여 전체 블록을 분류.

    - BUSINESS_CARD: 기존 classify_all_blocks()에 위임 (2-pass 분류)
    - POSTER: classify_text_block_for_poster() 사용
      + unknown 블록 중 가장 긴 텍스트를 title로 자동 승격
    - RECEIPT: classify_text_block_for_receipt() 사용
    - TICKET: classify_text_block_for_ticket() 사용
    - ETC: 모든 블록을 unknown으로 반환 (파싱 스키마 미정의)
    """
    # 명함은 기존 로직(2-pass + 문맥 참조) 그대로 사용
    if document_type == "BUSINESS_CARD":
        return classify_all_blocks(text_blocks)

    # 문서 종류별 분류 함수 선택
    if document_type == "POSTER":
        classify_fn = classify_text_block_for_poster
    elif document_type == "RECEIPT":
        # 영수증은 라벨과 값이 **다른 블록**으로 쪼개져 오는 것이 기본이라 전용 후처리를 쓴다.
        return _classify_receipt_blocks(text_blocks)
    elif document_type == "TICKET":
        classify_fn = classify_text_block_for_ticket
        # 티켓은 분류 후 복합 필드 분리 후처리 필요
        return _classify_and_split_ticket_blocks(text_blocks)
    else:
        # ETC: 스키마 미정의 → 모든 블록을 unknown으로
        return [{"text": b["text"], "confidence": b.get("confidence", 0.0),
                 "bbox": b.get("bbox"), "block_index": b["block_index"],
                 "field": "unknown"} for b in text_blocks]

    # 각 블록을 분류하고 결과 리스트 생성
    results = []
    title_candidates: list[dict] = []
    for block in text_blocks:
        text = block["text"].strip()
        field = classify_fn(text)
        # 전화번호/이메일/URL + 티켓 필드 → extract_clean_value로 노이즈 제거
        clean_fields = (
            "contact_phone", "contact_email", "website_url", "total_amount",
            "transport_type", "departure_location", "departure_date",
            "departure_time", "arrival_location", "arrival_date", "arrival_time",
        )
        clean_text = extract_clean_value(text, field) if field in clean_fields else text
        entry = {"text": clean_text, "confidence": block.get("confidence", 0.0),
                 "bbox": block.get("bbox"), "block_index": block["block_index"], "field": field}
        results.append(entry)

        # 포스터 기간 표기는 **한 블록에 시작·종료가 같이 온다.**
        #   "접수기간2026.05.15.(금) ~06.12.(금)"
        # 이 블록은 event_end_date 하나로만 라벨되므로 _clean_event_date 가 role="end"
        # 로만 돌고, 시작일(05.15)은 볼 기회조차 없다. 실측에서 접수 시작일이 통째로
        # 누락됐다. 날짜 토큰이 2개 이상이면 반대쪽 역할의 항목을 하나 더 만든다.
        # _clean_event_date 가 이미 role 로 앞/뒤를 골라주고, 종료일 연도 상속까지 한다.
        #
        # 잘못 뽑힌 값은 스스로 사라진다: _clean_event_date 는 날짜가 아니면 ""를
        # 돌려주고 services._aggregate 가 빈 값을 드롭한다. 그래서 "(19-39세)" 같은
        # 오탐이 이 분기를 타도 필드가 생기지 않는다.
        if document_type == "POSTER" and field in ("event_start_date", "event_end_date"):
            if len(DATE_PATTERN.findall(text)) >= 2:
                other = "event_end_date" if field == "event_start_date" else "event_start_date"
                results.append({
                    "text": text,          # 원문을 넘긴다 — 정제는 _aggregate 가 role 로 한다
                    "confidence": block.get("confidence", 0.0),
                    "bbox": block.get("bbox"),
                    "block_index": block["block_index"],
                    "field": other,
                })

        if document_type == "POSTER" and field == "unknown":
            title_candidates.append(entry)

    # 포스터: 날짜를 **가장 가까운 섹션 라벨**에 귀속시킨다.
    if document_type == "POSTER":
        _reassign_poster_dates(results)

    # 포스터에서 title이 명시적으로 분류된 블록이 없으면 후보를 title로 승격
    if document_type == "POSTER" and title_candidates:
        has_title = any(r["field"] == "title" for r in results)
        if not has_title:
            for entry in _pick_poster_title(title_candidates):
                entry["field"] = "title"

    return results


def _bbox_center(bbox):
    """폴리곤 bbox 의 중심 (cx, cy). 형식이 이상하면 None."""
    if not bbox:
        return None
    try:
        xs = [float(p[0]) for p in bbox]
        ys = [float(p[1]) for p in bbox]
    except (TypeError, IndexError, ValueError):
        return None
    if not xs or not ys:
        return None
    return (sum(xs) / len(xs), sum(ys) / len(ys))


def _reassign_poster_dates(results: list[dict]) -> None:
    """날짜 블록을 가장 가까운 섹션 라벨에 귀속시킨다 (results 를 제자리 수정).

    **왜 텍스트만으로는 안 되는가.** 포스터 한 장에 날짜가 여러 벌 있고, 텍스트만
    보면 전부 똑같은 날짜다. 실측(성별균형 국민제안 공모전):
        [공모기간]  2026.  6.10.(수)  ~7.31.(금)
        [결과발표]  2026. 9월
    "2026.9월" 이 confidence 로 이겨 행사 시작일 자리를 차지하고 "6.10.(수)" 를
    밀어냈다. 구별의 근거는 텍스트가 아니라 **어느 라벨 밑에 있는가**다.

    판정:
      · 가장 가까운 라벨이 기간 라벨(_PERIOD_LABELS)   → 행사일로 유지
      · 가장 가까운 라벨이 비기간 라벨(_NON_PERIOD_LABELS) → unknown 으로 내린다
        (결과발표·시상 일정은 행사일이 아니다)
      · 라벨이 하나도 없거나 bbox 가 없으면 **아무것도 하지 않는다** —
        비-OCR 경로(합성 테스트)와 라벨 없는 포스터에서 회귀가 없다.

    **거리는 유클리드가 아니다.** 포스터 섹션은 세로 열(column)로 나뉘고 라벨이
    값보다 **위**에 온다. 그래서
      · 가로 차이(x)를 훨씬 무겁게 본다 — 같은 열이 같은 섹션이다
      · 라벨보다 위에 있는 값은 그 라벨 소속이 아니다 (아래로만 귀속)
    실측 좌표가 이 규칙을 요구했다:
        공모기간(152,858)  6.10(161,1052)  ~7.31(150,1084)   ← x 거의 같음, 아래
        결과발표(539,858)  2026.9월(538,900)                  ← 같은 열, 아래
        최우수상(501,1047)                                    ← 6.10 과 y 는 5 차이지만 x 가 340
    유클리드로 재면 "최우수상" 이 6.10 을 가져간다. 실제로 첫 시도가 그렇게 틀렸다.
    """
    labels = []   # (cx, cy, is_period)
    for r in results:
        c = _bbox_center(r.get("bbox"))
        if c is None:
            continue
        t = r.get("text") or ""
        if _NON_PERIOD_LABELS.search(t):
            labels.append((c[0], c[1], False))
        elif _PERIOD_LABELS.search(t):
            labels.append((c[0], c[1], True))
    if not labels:
        return

    def score(label, c):
        """작을수록 가깝다. 같은 열 + 라벨 아래를 강하게 선호한다."""
        dx = abs(label[0] - c[0])
        dy = c[1] - label[1]          # 양수 = 값이 라벨 아래
        if dy < 0:
            # 라벨보다 위에 있는 값. 섹션 소속으로 보기 어렵다 — 크게 벌점.
            return abs(dy) * 6 + dx * 8 + 10000
        return dy + dx * 8

    date_fields = ("event_start_date", "event_end_date")
    for r in results:
        if r.get("field") not in date_fields:
            continue
        c = _bbox_center(r.get("bbox"))
        if c is None:
            continue
        # 라벨 자신이 날짜를 품은 경우("접수기간 6.10~7.31")는 건드리지 않는다.
        if _PERIOD_LABELS.search(r.get("text") or ""):
            continue
        best = min(labels, key=lambda L: score(L, c))
        if not best[2]:
            r["field"] = "unknown"


# 포스터 제목 후보에서 제외할 문구.
#
# 각주·안내·조건문은 본문에서 가장 길기 쉬워서 "가장 긴 unknown" 규칙의 단골 오답이다.
# 실측(대구 동구 청년창업 경진대회 포스터): 제목이
# "※동구생활권자 신청가능(직장및 학교,교육기관수강자등증빙자료 제출)" 로 뽑혔다.
_TITLE_EXCLUDE = re.compile(
    r"^\s*[※*·•]"                       # 각주 기호로 시작
    r"|신청\s*가능|제출|증빙|참조|문의|바로가기"
    r"|^\s*\(?\s*주\s*\)?\s*[:：]"       # "주:" 단서
    r"|^\s*\d+\s*[.)]"                   # "1." "2)" 항목 번호
)


def _bbox_height(bbox) -> float:
    """폴리곤 bbox 의 세로 높이. 폰트 크기의 프록시다. 형식이 이상하면 0."""
    if not bbox:
        return 0.0
    try:
        ys = [float(p[1]) for p in bbox]
    except (TypeError, IndexError, ValueError):
        return 0.0
    return (max(ys) - min(ys)) if ys else 0.0


def _pick_poster_title(candidates: list[dict]) -> list[dict]:
    """unknown 후보 중 포스터 제목 블록들을 고른다 (여러 개일 수 있다).

    **왜 '가장 긴 텍스트' 가 아닌가.** 종전 규칙은 길이만 봤고, 실측 2건이 모두
    틀렸다 — 영문 부제("Advance Data Analytics Semi-Professional")와 각주
    ("※동구생활권자 신청가능…")가 각각 본문 제목을 이겼다. 포스터 제목의 진짜
    신호는 길이가 아니라 **글자 크기와 위치**다.

    **왜 여러 블록을 돌려주는가.** 포스터 제목은 큰 글자라 OCR 이 줄 단위로 쪼갠다
    ("제1회 대구 동구 2026" / "청년 창업" / "아이디어 경진대회"). 한 블록만 고르면
    제목의 일부만 남는다 — 실측에서 "청년창업" 만 잡혔다. 같은 크기 대역 + 세로로
    인접한 블록을 함께 제목으로 묶고, _JOIN_FIELDS(services._aggregate)가
    block_index 순으로 이어 붙인다.

    판정 순서:
      1) 각주/안내 문구를 후보에서 뺀다(_TITLE_EXCLUDE).
      2) 한국 포스터의 제목은 한글이다 — 한글이 섞인 후보가 있으면 영문 전용
         블록(슬로건/로고/영문 부제)은 후보에서 뺀다.
      3) bbox 가 있으면 **글자 높이(폰트 크기 프록시)** 최대의 80% 이상인 블록을
         모으고, 그중 가장 위(anchor)에서 세로로 2.5 글자높이 안에 있는 것만 남긴다.
         멀리 떨어진 같은 크기 블록(하단 주최기관명 등)이 딸려오는 것을 막는다.
      4) bbox 가 하나도 없으면(비-OCR 경로/합성 테스트) 종전대로 길이 폴백 1개.
         그 경로에서는 회귀가 없다.
    """
    pool = [c for c in candidates if not _TITLE_EXCLUDE.search(c["text"])]
    if not pool:
        pool = candidates
    if not pool:
        return []

    korean = [c for c in pool if re.search(r"[가-힣]", c["text"])]
    if korean:
        pool = korean

    sized = [(c, _bbox_height(c.get("bbox"))) for c in pool]
    sized = [(c, h) for c, h in sized if h > 0]
    if not sized:
        return [max(pool, key=lambda c: len(c["text"]))]

    max_h = max(h for _, h in sized)
    big = [(c, h) for c, h in sized if h >= max_h * 0.8]

    def top(entry) -> float:
        return min(float(p[1]) for p in entry["bbox"])

    anchor_top = min(top(c) for c, _ in big)
    band = [c for c, _ in big if top(c) - anchor_top <= 2.5 * max_h]
    band.sort(key=lambda c: c.get("block_index", 0))
    return band


def classify_all_blocks(text_blocks: list[dict]) -> list[dict]:
    """
    명함 전용. 전체 텍스트 블록을 순회하며 분류 결과를 추가.
    전처리: 복합 블록 분리 → 2-pass 분류 → 값 추출.
    """
    # 전처리: 혼합 블록 분할(공유 세그멘터).
    # 다중패턴(전화+이메일 등) 분할 + 단일패턴+이름/회사 분리("강미경 010..").
    text_blocks = segment_text_blocks(text_blocks)

    # 1st pass: 확실한 패턴 먼저 분류 (이메일, 휴대폰)
    # → 2nd pass에서 이미 분류된 블록을 문맥으로 참조할 수 있게 함
    for block in text_blocks:
        text = block["text"].strip()
        if EMAIL_PATTERN.search(text):
            block["_classified"] = "email"
        elif MOBILE_PATTERN.search(text) and not FAX_KEYWORDS.search(text):
            block["_classified"] = "mobile_phone"

    # 2nd pass: 나머지 블록 분류 (문맥 참조 가능)
    # 예: 유선번호가 mobile_phone 이미 있으면 office_phone으로 추정
    for block in text_blocks:
        if "_classified" not in block:
            block["_classified"] = classify_text_block(
                block["text"], all_blocks=text_blocks, block_index=block["block_index"]
            )

    # 결과 정리: _classified 임시 키를 제거하고 clean value 추출
    results = []
    for block in text_blocks:
        field = block.pop("_classified")
        clean_text = extract_clean_value(block["text"], field)
        results.append({
            "text": clean_text,
            "confidence": block.get("confidence", 0.0),
            "bbox": block.get("bbox"),
            "block_index": block["block_index"],
            "field": field,
        })

    return results


# ════════════════════════════════════════════
# 세그멘터 self-test (py ocr/src/classifier/rule_based.py 로 실행)
# 정찰 false_split_tests 전수를 assert. 라벨링이 아닌 '분할'만 검증한다.
# ════════════════════════════════════════════
if __name__ == "__main__":
    # (입력, 기대 세그먼트 리스트) — _segment_core 의 순수 분할 결과를 검증.
    _CASES = [
        # ── 분할O ──
        ("강미경 010.6498.5121", ["강미경", "010.6498.5121"]),
        ("(주)린텍 010-1234-5678", ["(주)린텍", "010-1234-5678"]),
        ("김철수 hong@naver.com", ["김철수", "hong@naver.com"]),
        # ── 분할O, 회귀보존(2+ 패턴) ──
        ("T 052.227.0500 F 052.266.8284",
         ["T 052.227.0500", "F 052.266.8284"]),
        ("F.053-813-1212E.ukneeon@naver.com",
         ["F.053-813-1212", "E.ukneeon@naver.com"]),
        ("동793)T.053-813-8900,053-815-9100",
         ["동793)T.053-813-8900", ",053-815-9100"]),
        # ── 분할X (키워드 가드) ──
        ("Mobile.010.4965.4540", ["Mobile.010.4965.4540"]),
        ("Fax. 052.267.4925", ["Fax. 052.267.4925"]),
        ("E-mail.long0656@hanmail.net", ["E-mail.long0656@hanmail.net"]),
        ("H P 010.8540.7303", ["H P 010.8540.7303"]),
        ("M 010 2818 3868", ["M 010 2818 3868"]),
        ("T 053 521 8778", ["T 053 521 8778"]),
        # ── 분할X (M.P/C.P/MP/CP 모바일 라벨 가드, 블로킹#1 회귀고정) ──
        ("M.P 010-1234-5678", ["M.P 010-1234-5678"]),
        ("C.P 010-1234-5678", ["C.P 010-1234-5678"]),
        ("MP 010-1234-5678", ["MP 010-1234-5678"]),
        ("CP 010-1234-5678", ["CP 010-1234-5678"]),
        # ── 분할X (단독 패턴, 앞텍스트 없음) ──
        ("010-3695-7600", ["010-3695-7600"]),
        ("052.266.1183", ["052.266.1183"]),
        # ── 분할X (주소/우편번호 오매칭 방지) ──
        ("대구 동구 1462-10번지", ["대구 동구 1462-10번지"]),
        ("41566 대구광역시", ["41566 대구광역시"]),
        # ── 분할X (긴 숫자토큰 경계가드, 블로킹#2 데이터손상 회귀고정) ──
        ("8809599360081", ["8809599360081"]),                  # 바코드
        ("2602272636000113100007", ["2602272636000113100007"]),  # 영수증 거래번호
        ("AID: A0000000031010", ["AID: A0000000031010"]),       # 카드 AID
        ("POS 3346 거래 00123456789012", ["POS 3346 거래 00123456789012"]),
        ("우리은행 1002-345-678901", ["우리은행 1002-345-678901"]),  # 은행계좌
        # ── URL 단독 ──
        ("www.mora.co.kr", ["www.mora.co.kr"]),
        # ── 분할O 경계(패턴앞 전체 비키워드 텍스트 1조각) ──
        ("담당자 강미경 010.1234.5678",
         ["담당자 강미경", "010.1234.5678"]),
    ]

    _failed = 0
    for _inp, _exp in _CASES:
        _got = _segment_core(_inp)
        _ok = _got == _exp
        if not _ok:
            _failed += 1
        print(f"[{'OK ' if _ok else 'FAIL'}] {_inp!r}\n      got={_got!r}\n      exp={_exp!r}")

    # ── 구두점 접두 조각은 버려지고 패턴만 남는지(결과는 분할 형태로 OK) ──
    _g = _segment_core("· 010-1234-5678")
    assert _g == ["010-1234-5678"], _g
    print(f"[OK ] '· 010-1234-5678' -> {_g!r}")

    # ── 앞 '0' 1글자<2자 → 버려지고 패턴세그먼트만(이름 오분할 없음) ──
    _g = _segment_core("0010.8262.2514")
    assert all(MOBILE_PATTERN.search(s) or LANDLINE_PATTERN.search(s) for s in _g), _g
    assert not any(s in ("0", "00") for s in _g), _g
    print(f"[OK ] '0010.8262.2514' -> {_g!r}")

    # ── segment_text_blocks: block_index 보존 + dict 동형 ──
    _blocks = [{"text": "강미경 010.6498.5121", "confidence": 0.9,
                "bbox": [[0, 0]], "block_index": 3}]
    _out = segment_text_blocks(_blocks)
    assert len(_out) == 2, _out
    assert all(b["block_index"] == 3 for b in _out), _out
    assert [b["text"] for b in _out] == ["강미경", "010.6498.5121"], _out
    assert all(b["confidence"] == 0.9 and b["bbox"] == [[0, 0]] for b in _out), _out
    print(f"[OK ] segment_text_blocks block_index/keys preserved")

    # ── segment_text_blocks: 단일패턴 무관 블록은 원본 객체 그대로 통과 ──
    _single = [{"text": "010-3695-7600", "confidence": 0.5,
                "bbox": None, "block_index": 1}]
    assert segment_text_blocks(_single)[0] is _single[0]
    print(f"[OK ] segment_text_blocks pass-through (no split)")

    # ── segment_lines: 평탄화 + 순서/빈줄 보존 ──
    _lines = ["강미경 010.6498.5121", "", "Mobile.010.4965.4540", "안녕하세요"]
    _ls = segment_lines(_lines)
    assert _ls == ["강미경", "010.6498.5121", "",
                   "Mobile.010.4965.4540", "안녕하세요"], _ls
    print(f"[OK ] segment_lines flatten/order/empty preserved")

    # ── _split_multi_pattern_blocks 별칭이 segment_text_blocks 인지 ──
    assert _split_multi_pattern_blocks is segment_text_blocks
    print(f"[OK ] _split_multi_pattern_blocks aliases segment_text_blocks")

    if _failed:
        print(f"\n=== SELF-TEST FAILED: {_failed} case(s) ===")
        raise SystemExit(1)
    print(f"\n=== SELF-TEST PASSED: {len(_CASES)} cases + 6 extra asserts ===")
