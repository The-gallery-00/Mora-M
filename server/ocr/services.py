# ═══════════════════════════════════════════════════════════════
# services.py — 공유 서비스 (싱글톤 OCR 파이프라인 + 파싱 스킬)
# ═══════════════════════════════════════════════════════════════
#
# [역할]
# OCR 파이프라인과 파싱 스킬을 싱글톤으로 생성하여 앱 전체에서
# 공유한다. PaddleOCR 엔진은 초기화 비용이 높으므로 한 번만
# 생성하고 재사용하는 것이 핵심이다.
# ParsingSkill 은 OCR 텍스트 블록을 **문서 종류별** 필드로 분류하고,
# 필드별로 값을 집계하여 외부(앱) 필드명으로 매핑한다.
#
# [코드 흐름]
# 1) PaddlePaddle 관련 환경변수를 설정한다 (OneDNN, PIR 비활성화)
# 2) BusinessCardPipeline 과 분류기/필드스키마를 import 한다
# 3) ParsingSkill 클래스를 정의한다:
#    a) execute(text_blocks, document_type) 가 종류별 분류기를 호출
#    b) _aggregate() 가 필드별로 값을 모아 최종 parsed 를 만든다
#    c) DOCUMENT_FIELDS[document_type] 로 내부→외부 필드명 변환
# 4) pipeline 과 parsing_skill 을 싱글톤으로 생성한다
#
# [메서드 목록]
# - ParsingSkill.execute(text_blocks, document_type="BUSINESS_CARD"):
#     텍스트 블록을 문서 종류에 맞게 분류·집계하여
#     {classified_blocks, parsed} 를 반환
# - ParsingSkill._aggregate(classified, field_map):
#     필드별 값 집계. _JOIN_FIELDS 는 여러 줄을 잇고, 나머지는 최고
#     confidence 한 줄만 쓴다. 정제 결과가 빈값이면 필드를 누락한다.
#
# [사용된 라이브러리]
# ───────────────────────────────────────────
# os.environ[key] = value
#   PaddlePaddle 내부 플래그를 비활성화하는 환경변수 설정.
#   FLAGS_use_mkldnn="0": OneDNN(MKL-DNN) 가속 비활성화 (버그 우회)
#   FLAGS_enable_pir_api="0": PIR(Program IR) API 비활성화
#   FLAGS_enable_pir_in_executor="0": Executor에서 PIR 비활성화
# ───────────────────────────────────────────
# collections.defaultdict(list)
#   없는 키에 접근하면 빈 리스트를 자동 생성하는 딕셔너리.
#   _aggregate 에서 필드별 블록 묶음을 만들 때 사용.
# ───────────────────────────────────────────
# src.classifier.rule_based.classify_all_blocks_for_type(blocks, document_type)
#   문서 종류에 따라 서로 다른 규칙 분류기로 분기한다.
#   BUSINESS_CARD/POSTER/RECEIPT/TICKET/ETC 5갈래.
# ───────────────────────────────────────────
# src.classifier.rule_based.extract_clean_value(text, field)
#   분류된 필드에서 값만 정제해 뽑는다. 유효한 값이 없으면 빈 문자열을
#   돌려주므로, 호출부가 그것을 "필드 누락" 신호로 쓴다.
# ───────────────────────────────────────────
# src.classifier.field_schema.DOCUMENT_FIELDS
#   문서 종류별 {내부 필드명: 외부 필드명} 매핑의 단일 진실 공급원.
# ───────────────────────────────────────────
#
# ═══════════════════════════════════════════════════════════════

"""공유 서비스 — 싱글톤 OCR 파이프라인 + 문서종류별 파싱 스킬."""
import os
from collections import defaultdict

# PaddlePaddle 내부 플래그 비활성화 (import 전에 설정해야 적용됨)
os.environ["FLAGS_use_mkldnn"] = "0"
os.environ["FLAGS_enable_pir_api"] = "0"
os.environ["FLAGS_enable_pir_in_executor"] = "0"
os.environ["PADDLE_PDX_ENABLE_MKLDNN_BYDEFAULT"] = "0"
os.environ["PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK"] = "True"

from src.pipeline.extract_pipeline import BusinessCardPipeline
from src.classifier.rule_based import (
    classify_all_blocks_for_type,
    extract_clean_value,
)
from src.classifier.field_schema import DOCUMENT_FIELDS

# "unknown" 라벨의 블록은 최종 결과에서 제외됨
UNKNOWN_LABEL = "unknown"

# 한 값이 OCR 에서 여러 줄로 쪼개질 수 있는 "텍스트형" 필드.
# (예: "국토교통부 창조센터" 가 국토/교통부/창조센터 3블록으로 분리)
# 이 필드들은 같은 필드 블록을 reading order(block_index)로 합쳐 한 값으로 만든다.
# 전화/이메일/URL/날짜/시간/금액/우편번호/역명 등 "원자" 필드는 여기 없으며
# 최고 confidence 한 줄만 사용한다(합치면 값이 깨지므로).
_JOIN_FIELDS = frozenset({
    # 명함
    "company_name", "department", "job_title", "address",
    # 포스터
    "title", "organizer_name", "location",
    # 영수증
    "store_name",
})


class ParsingSkill:
    """OCR 텍스트 블록을 문서 종류별 필드로 분류/파싱.

    **문서 종류는 이 서비스가 판정하지 않는다.** 호출부(routers/ocr.py)가
    클라이언트에게서 받은 값을 그대로 넘긴다. 원본 웹은 ResNet18 이미지
    분류기로 종류를 정하지만, 이 서비스에는 그 모델이 없다 —
    대신 앱의 문서 유형 선택을 정본으로 삼는다.
    알 수 없는 종류는 DOCUMENT_FIELDS 에 없으므로 field_map 이 비고,
    classify_all_blocks_for_type 도 전부 unknown 을 돌려줘 parsed 가 빈다.
    """

    def execute(self, text_blocks: list[dict], document_type: str = "BUSINESS_CARD") -> dict:
        # 빈 입력이면 빈 결과 반환
        if not text_blocks:
            return {"classified_blocks": [], "parsed": {}}

        # 문서 종류에 맞는 규칙 분류기로 각 블록에 필드(field)를 부여
        classified = classify_all_blocks_for_type(text_blocks, document_type)

        # 내부 필드명 → 앱이 쓰는 외부 필드명 매핑.
        # 정본은 src/classifier/field_schema.py 의 DOCUMENT_FIELDS 다.
        # 예전에는 이 파일 안에 명함 6키짜리 dict 가 하드코딩되어 있었고,
        # 그래서 포스터/영수증/티켓 필드는 물론 명함 12필드 중 6개도
        # 구조적으로 내보낼 수 없었다.
        field_map = DOCUMENT_FIELDS.get(document_type, {})
        parsed = self._aggregate(classified, field_map)

        return {"classified_blocks": classified, "parsed": parsed}

    # ── 필드별 값 집계 (멀티라인 합치기 + 원자필드 최고 confidence) ──
    @staticmethod
    def _aggregate(classified: list[dict], field_map: dict) -> dict:
        """분류된 블록을 필드별로 묶어 최종 값(parsed)을 만든다.

        - _JOIN_FIELDS(회사/부서/주소/제목 등 여러 줄로 쪼개지는 값): 같은 필드
          블록을 block_index(reading order)로 정렬해 공백으로 합친다. 인접한
          동일 텍스트는 제거. 예) 국토 + 교통부 + 창조센터 → "국토 교통부 창조센터".
        - 그 외(전화/이메일/URL/날짜/금액/우편번호/역명 등 원자 필드): 최고
          confidence 블록 한 줄만 사용(합치면 값이 깨진다).

        마지막에 extract_clean_value 를 한 번 더 걸어 라벨/괄호/노이즈를 떼고,
        **정제 결과가 빈 문자열이면 그 필드를 아예 내보내지 않는다.**
        빈 칸이 'tel.' 이나 라벨 조각 같은 쓰레기보다 사람이 고쳐 쓰기 쉽다.
        """
        groups = defaultdict(list)
        for block in classified:
            field = block["field"]
            if field == UNKNOWN_LABEL:
                continue
            groups[field].append(block)

        parsed = {}
        for field, blocks in groups.items():
            if field in _JOIN_FIELDS and len(blocks) > 1:
                ordered = sorted(blocks, key=lambda b: b.get("block_index", 0))
                parts = []
                for b in ordered:
                    t = (b.get("text") or "").strip()
                    if t and (not parts or parts[-1] != t):  # 인접 중복 제거
                        parts.append(t)
                value = " ".join(parts)
            else:
                best = max(blocks, key=lambda b: b.get("confidence", 0.0))
                value = best["text"]

            value = (extract_clean_value(value, field) or "").strip()
            if not value:
                continue
            parsed[field_map.get(field, field)] = value
        return parsed


# ── 싱글톤 인스턴스 ──
# 모듈 로드 시 한 번만 생성되어 앱 전체에서 재사용됨.
#
# lang="korean" 을 넘기지 않는다. paddleocr 3.4.0 은 모델명을 명시하면 lang 을
# 무시하고 UserWarning 만 내므로, 넘겨봤자 아무 효과가 없는데 "언어가 여기서
# 정해진다"는 잘못된 인상만 준다 (다음 사람이 "en" 으로 바꿔도 한국어 모델이 돈다).
# 인식 언어의 정본은 src/ocr/paddle_ocr_engine.py 의
# text_recognition_model_name="korean_PP-OCRv5_mobile_rec" 한 곳이다.
pipeline = BusinessCardPipeline()
parsing_skill = ParsingSkill()
