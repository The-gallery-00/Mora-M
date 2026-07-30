# ═══════════════════════════════════════════════════════════════
# services.py — 공유 서비스 (싱글톤 OCR 파이프라인 + 파싱 스킬)
# ═══════════════════════════════════════════════════════════════
#
# [역할]
# OCR 파이프라인과 파싱 스킬을 싱글톤으로 생성하여 앱 전체에서
# 공유한다. PaddleOCR 엔진은 초기화 비용이 높으므로 한 번만
# 생성하고 재사용하는 것이 핵심이다.
# ParsingSkill 클래스는 OCR로 추출된 텍스트 블록을 규칙 기반
# 분류기로 명함 필드(이름, 회사, 직책, 전화 등)에 매핑하고,
# 가장 confidence가 높은 블록을 최종 결과로 선택한다.
#
# [코드 흐름]
# 1) PaddlePaddle 관련 환경변수를 설정한다 (OneDNN, PIR 비활성화)
# 2) BusinessCardPipeline과 classify_all_blocks를 import한다
# 3) ParsingSkill 클래스를 정의한다:
#    a) execute()에서 텍스트 블록을 classify_all_blocks()로 분류
#    b) 같은 필드가 여러 개면 confidence가 높은 것을 선택
#    c) 내부 필드명(person_name 등)을 외부 필드명(name 등)으로 변환
# 4) pipeline과 parsing_skill을 싱글톤으로 생성한다
#
# [메서드 목록]
# - ParsingSkill.execute(text_blocks):
#     텍스트 블록 리스트를 받아 분류하고, 필드별 최고 confidence
#     블록을 선택하여 {classified_blocks, parsed} 딕셔너리를 반환
#
# [사용된 라이브러리]
# ───────────────────────────────────────────
# os.environ[key] = value
#   PaddlePaddle 내부 플래그를 비활성화하는 환경변수 설정.
#   FLAGS_use_mkldnn="0": OneDNN(MKL-DNN) 가속 비활성화 (버그 우회)
#   FLAGS_enable_pir_api="0": PIR(Program IR) API 비활성화
#   FLAGS_enable_pir_in_executor="0": Executor에서 PIR 비활성화
# ───────────────────────────────────────────
# src.pipeline.extract_pipeline.BusinessCardPipeline
#   이미지 → OCR → 필드 분류 → 구조화된 결과를 생성하는 파이프라인.
#   lang="korean"으로 한국어 명함 인식에 최적화됨.
# ───────────────────────────────────────────
# src.classifier.rule_based.classify_all_blocks(text_blocks)
#   텍스트 블록 리스트를 정규식/휴리스틱으로 분류하여
#   각 블록에 field(email, phone_number 등)를 부여한다.
# ───────────────────────────────────────────
#
# ═══════════════════════════════════════════════════════════════

"""공유 서비스 — 싱글톤 OCR 파이프라인 + 파싱 스킬."""
import os

# PaddlePaddle 내부 플래그 비활성화 (import 전에 설정해야 적용됨)
os.environ["FLAGS_use_mkldnn"] = "0"
os.environ["FLAGS_enable_pir_api"] = "0"
os.environ["FLAGS_enable_pir_in_executor"] = "0"
os.environ["PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK"] = "True"

from src.pipeline.extract_pipeline import BusinessCardPipeline
from src.classifier.rule_based import classify_all_blocks

# "unknown" 라벨의 블록은 최종 결과에서 제외됨
UNKNOWN_LABEL = "unknown"


class ParsingSkill:
    """OCR 텍스트 블록을 명함 필드로 분류/파싱."""
    def execute(self, text_blocks: list[dict]) -> dict:
        # 빈 입력이면 빈 결과 반환
        if not text_blocks:
            return {"classified_blocks": [], "parsed": {}}

        # 규칙 기반 분류기로 각 블록에 필드(field)를 부여
        classified = classify_all_blocks(text_blocks)

        # 같은 필드가 여러 개일 때 confidence가 가장 높은 블록만 선택
        best = {}
        for block in classified:
            field = block["field"]
            if field == UNKNOWN_LABEL:
                continue  # unknown은 건너뜀
            if field not in best or block["confidence"] > best[field]["confidence"]:
                best[field] = block

        # 내부 필드명 → 프론트엔드에서 사용하는 외부 필드명으로 매핑
        field_map = {
            "person_name": "name", "company_name": "company",
            "job_title": "position", "phone_number": "phone",
            "fax_number": "fax", "email": "email",
        }
        parsed = {field_map.get(k, k): v["text"] for k, v in best.items()}

        return {"classified_blocks": classified, "parsed": parsed}


# ── 싱글톤 인스턴스 ──
# 모듈 로드 시 한 번만 생성되어 앱 전체에서 재사용됨
pipeline = BusinessCardPipeline(lang="korean")
parsing_skill = ParsingSkill()
