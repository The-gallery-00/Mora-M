# ═══════════════════════════════════════════════════════════════
# src/pipeline/extract_pipeline.py — 명함 인식 엔드투엔드 파이프라인
# ═══════════════════════════════════════════════════════════════
#
# [역할]
# 명함 이미지를 입력받아 OCR → 필드 분류 → 구조화된 결과 출력까지
# 전체 파이프라인을 하나의 클래스로 관리한다.
# PaddleOCR 엔진과 규칙 기반 분류기를 조합하여 최종 연락처 정보를
# 영문 키(company_name 등)와 한국어 키(회사이름 등) 두 가지 형태로 반환.
#
# [코드 흐름]
# 1) BusinessCardPipeline 인스턴스 생성 시 PaddleOCREngine을 초기화
# 2) run() 호출 시:
#    a) Step 1: OCR 엔진으로 이미지에서 텍스트 블록을 추출
#    b) Step 2: classify_all_blocks()로 각 블록을 필드에 매핑
#    c) Step 3: 같은 필드가 여러 개면 confidence가 높은 것을 선택하여
#       구조화된 결과(result) 생성
#    d) Step 4: 영문 필드명 → 한국어 라벨로 변환 (result_korean)
#    e) raw_blocks, classified_blocks, result, result_korean을 반환
# 3) run_and_save()는 run() 결과를 JSON 파일로도 저장
# 4) print_result()는 터미널에 한국어 결과를 출력
# 5) CLI 직접 실행 시 커맨드라인 인자로 이미지 경로를 받아 처리
#
# [메서드 목록]
# - __init__(lang):
#     PaddleOCREngine을 초기화. lang으로 인식 언어 지정.
# - run(image_path):
#     이미지 → OCR → 분류 → 구조화된 결과 딕셔너리 반환.
#     텍스트가 없으면 error 키를 포함한 빈 결과 반환.
# - run_and_save(image_path, output_dir):
#     run() 실행 후 결과를 JSON 파일로 저장.
# - print_result(result):
#     한국어 라벨로 결과를 터미널에 출력 (CLI용).
#
# [사용된 라이브러리]
# ───────────────────────────────────────────
# json.dump(obj, file, ensure_ascii=False, indent=2)
#   파이썬 객체를 JSON 형태로 파일에 기록한다.
#   ensure_ascii=False: 한글이 유니코드 이스케이프 없이 그대로 저장됨.
# ───────────────────────────────────────────
# pathlib.Path(path).stem
#   파일 경로에서 확장자를 제외한 파일명만 추출.
#   예: Path("card_001.jpg").stem → "card_001"
# ───────────────────────────────────────────
# pathlib.Path.mkdir(parents=True, exist_ok=True)
#   디렉토리를 생성한다.
#   parents=True: 중간 디렉토리도 함께 생성.
#   exist_ok=True: 이미 존재해도 에러 없음.
# ───────────────────────────────────────────
# src.ocr.paddle_ocr_engine.PaddleOCREngine
#   PaddleOCR을 감싼 엔진 클래스.
#   extract(image_path)로 이미지에서 텍스트 블록을 추출.
# ───────────────────────────────────────────
# src.classifier.rule_based.classify_all_blocks(text_blocks)
#   텍스트 블록 리스트를 정규식/휴리스틱으로 분류하여
#   각 블록에 field(email, phone_number 등)를 부여.
# ───────────────────────────────────────────
# sys.argv
#   커맨드라인 인자 리스트. CLI 실행 시 이미지 경로를 전달받음.
# ───────────────────────────────────────────
#
# ═══════════════════════════════════════════════════════════════

"""
엔드투엔드 파이프라인: 이미지 입력 → OCR → 필드 분류 → 구조화된 결과 출력
"""
import json
from pathlib import Path

from src.ocr.paddle_ocr_engine import PaddleOCREngine
from src.classifier.rule_based import classify_all_blocks

# 영문 필드명 → 한국어 라벨 매핑 (사용자 표시용)
FIELD_LABELS = {
    "company_name": "회사이름",
    "person_name": "이름",
    "job_title": "직책",
    "phone_number": "전화번호",
    "fax_number": "팩스번호",
    "email": "이메일",
}
UNKNOWN_LABEL = "unknown"


class BusinessCardPipeline:
    def __init__(self, lang="korean"):
        # OCR 엔진 초기화 (한 번만 생성하여 재사용)
        self.ocr_engine = PaddleOCREngine(lang=lang)

    def run(self, image_path: str) -> dict:
        """
        명함 이미지 → 구조화된 연락처 정보 추출.

        Args:
            image_path: 명함 이미지 경로

        Returns:
            {
                "image_file": "card_001.jpg",
                "raw_blocks": [...],          # OCR 원본 결과
                "classified_blocks": [...],   # 분류된 블록
                "result": {                   # 최종 구조화 결과
                    "company_name": {"text": "...", "confidence": 0.97},
                    "person_name": {"text": "...", "confidence": 0.95},
                    ...
                },
                "result_korean": {            # 사용자 표시용 한국어 결과
                    "회사이름": "...",
                    "이름": "...",
                    ...
                }
            }
        """
        # Step 1: OCR 수행 — 이미지에서 텍스트 블록 추출
        ocr_result = self.ocr_engine.extract(image_path)
        text_blocks = ocr_result["text_blocks"]

        # 텍스트가 감지되지 않은 경우 빈 결과 + 에러 메시지 반환
        if not text_blocks:
            return {
                "image_file": ocr_result["image_file"],
                "raw_blocks": [],
                "classified_blocks": [],
                "result": {},
                "result_korean": {},
                "error": "텍스트를 감지하지 못했습니다.",
            }

        # Step 2: 필드 분류 — 각 텍스트 블록을 명함 필드에 매핑
        classified = classify_all_blocks(text_blocks)

        # Step 3: 구조화된 결과 생성 — 같은 필드가 여러 개면 confidence 최고값 선택
        result = {}
        for block in classified:
            field = block["field"]
            if field == UNKNOWN_LABEL:
                continue  # 분류 불가 블록은 제외
            # 같은 필드가 여러 개면 confidence가 높은 것 우선
            if field not in result or block["confidence"] > result[field]["confidence"]:
                result[field] = {
                    "text": block["text"],
                    "confidence": block["confidence"],
                }

        # Step 4: 한국어 사용자 표시용 변환 (영문 키 → 한국어 라벨)
        result_korean = {}
        for field_key, data in result.items():
            korean_label = FIELD_LABELS.get(field_key, field_key)
            result_korean[korean_label] = data["text"]

        return {
            "image_file": ocr_result["image_file"],
            "raw_blocks": ocr_result["text_blocks"],
            "classified_blocks": classified,
            "result": result,
            "result_korean": result_korean,
        }

    def run_and_save(self, image_path: str, output_dir: str) -> dict:
        """파이프라인 실행 후 결과를 JSON 파일로 저장."""
        result = self.run(image_path)

        # 출력 파일 경로: output_dir/원본파일명_result.json
        output_path = Path(output_dir) / f"{Path(image_path).stem}_result.json"
        output_path.parent.mkdir(parents=True, exist_ok=True)

        # JSON으로 저장 (한글 그대로 보존)
        with open(output_path, "w", encoding="utf-8") as f:
            json.dump(result, f, ensure_ascii=False, indent=2)
        return result

    def print_result(self, result: dict):
        """사용자에게 보여줄 한국어 결과 출력 (CLI용)."""
        print("=" * 40)
        print("  명함 인식 결과")
        print("=" * 40)

        if "error" in result:
            print(f"  오류: {result['error']}")
            return

        korean_result = result.get("result_korean", {})
        if not korean_result:
            print("  인식된 정보가 없습니다.")
            return

        for label, value in korean_result.items():
            print(f"  {label}: {value}")

        print("=" * 40)


# --- CLI 실행용 ---
if __name__ == "__main__":
    import sys

    if len(sys.argv) < 2:
        print("사용법: python -m src.pipeline.extract_pipeline <이미지 경로>")
        sys.exit(1)

    image_path = sys.argv[1]
    output_dir = "data/ocr_outputs"

    pipeline = BusinessCardPipeline()
    result = pipeline.run_and_save(image_path, output_dir)
    pipeline.print_result(result)
