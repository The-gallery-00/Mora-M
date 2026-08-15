# ═══════════════════════════════════════════════════════════════
# src/classifier/field_schema.py — 문서 종류별 필드 스키마 정의
# ═══════════════════════════════════════════════════════════════
#
# [역할]
# 문서 종류(명함, 포스터, 영수증, 티켓 등)별로 어떤 필드를 파싱할지,
# 내부 필드명을 프론트엔드에서 사용하는 외부 필드명으로 어떻게
# 매핑할지를 정의하는 단일 진실 공급원(Single Source of Truth).
# 백엔드(services.py, routers/ocr.py)와 프론트엔드 모두
# 이 스키마를 기준으로 필드를 처리한다.
#
# [코드 흐름]
# 1) DOCUMENT_FIELDS: 문서 종류별 {내부 필드명: 외부 필드명} 매핑
#    - services.py의 ParsingSkill.execute()에서 분류 결과를
#      외부 필드명으로 변환할 때 사용
#    - routers/ocr.py에서 응답에 fields 정보를 포함할 때 사용
# 2) FIELD_LABELS_KO: 외부 필드명 → 한국어 라벨
#    - 프론트엔드에서 input 라벨로 표시
#
# [상수 목록]
# - DOCUMENT_FIELDS:  문서 종류별 내부→외부 필드명 매핑 딕셔너리
# - FIELD_LABELS_KO:  외부 필드명 → 한국어 라벨 딕셔너리
#
# ═══════════════════════════════════════════════════════════════

"""문서 종류별 필드 스키마 정의."""

# 내부 필드명 → 외부(프론트엔드) 필드명 매핑
DOCUMENT_FIELDS = {
    "BUSINESS_CARD": {
        "person_name": "name",
        "english_name": "english_name",
        "company_name": "company_name",
        "department": "department",
        "job_title": "job_title",
        "mobile_phone": "mobile_phone",
        "office_phone": "office_phone",
        "fax_number": "fax",
        "email": "email",
        "address": "address",
        "website": "website",
        "zip_code": "zip_code",
    },
    "POSTER": {
        "title": "title",
        "organizer_name": "organizer_name",
        "event_start_date": "event_start_date",
        "event_end_date": "event_end_date",
        "contact_phone": "contact_phone",
        "contact_email": "contact_email",
        "location": "location",
        "website_url": "website_url",
    },
    "RECEIPT": {
        "store_name": "store_name",
        "purchase_date": "purchase_date",
        "total_amount": "total_amount",
    },
    "TICKET": {
        "transport_type": "transport_type",
        "departure_location": "departure_location",
        "departure_date": "departure_date",
        "departure_time": "departure_time",
        "arrival_location": "arrival_location",
        "arrival_date": "arrival_date",
        "arrival_time": "arrival_time",
    },
    "ETC": {},
}

# 영수증 품목(라인아이템) 내부 라벨.
#
# **아직 소비처가 없다.** 원본 웹에는 이 상수를 items[] 로 재구성하는 함수가
# 있다고 주석에 적혀 있었으나 실제로는 웹에도 그런 함수가 없다(_build_receipt_items
# grep 0건). 즉 이 라벨들은 DOCUMENT_FIELDS 에 없어서 _aggregate 의 스칼라 집계에서
# 자연히 빠질 뿐이고, 그 결과 영수증 품목은 어느 쪽에서도 파싱되지 않는다.
# 앱의 receiptItemSchema(src/features/scan/fieldSchema.ts)는 수기 입력 전용이다.
# 여기 남겨두는 이유는 rule_based.py 가 item_name/item_price 라벨을 실제로 내보내기
# 때문이다 — 나중에 items[] 를 만들 때 이 집합이 그 입력이 된다.
RECEIPT_ITEM_LABELS = {"item_name", "item_price"}

# 외부 필드명 → 한국어 라벨
FIELD_LABELS_KO = {
    # 명함
    "name": "이름",
    "english_name": "영문 이름",
    "company_name": "회사명",
    "department": "부서",
    "job_title": "직책",
    "mobile_phone": "휴대폰",
    "office_phone": "사무실 전화",
    "fax": "팩스",
    "email": "이메일",
    "address": "주소",
    "website": "웹사이트",
    "zip_code": "우편번호",
    # 포스터
    "title": "제목",
    "organizer_name": "주최자",
    "event_start_date": "행사 시작일",
    "event_end_date": "행사 종료일",
    "contact_phone": "연락처 전화",
    "contact_email": "연락처 이메일",
    "location": "장소",
    "website_url": "웹사이트 URL",
    # 영수증
    "store_name": "가게 이름",
    "purchase_date": "구매일자",
    "total_amount": "합계금액",
    # 티켓
    "transport_type": "교통수단",
    "departure_location": "출발지",
    "departure_date": "출발일",
    "departure_time": "출발 시간",
    "arrival_location": "도착지",
    "arrival_date": "도착일",
    "arrival_time": "도착 시간",
}
