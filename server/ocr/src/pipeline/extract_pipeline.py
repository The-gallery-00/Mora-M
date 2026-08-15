# ═══════════════════════════════════════════════════════════════
# src/pipeline/extract_pipeline.py — OCR 텍스트 추출 파이프라인
# ═══════════════════════════════════════════════════════════════
#
# [역할]
# 이미지를 입력받아 PaddleOCR 로 텍스트 블록을 뽑는다. **여기까지만 한다.**
#
# 분류/파싱은 services.ParsingSkill 이 맡는다. 이 모듈이 그것을 못 하는 이유는
# **문서 종류를 모르기 때문**이다 — 종류는 요청과 함께 들어오고,
# 그것을 아는 곳은 routers/ocr.py 의 scan() 이다.
#
# [클래스명이 BusinessCardPipeline 인 것은 역사적 잔재다]
# 이 파이프라인은 이제 명함 전용이 아니다. 이름을 바꾸지 않은 이유는
# services.py·routers/ocr.py·app.py 가 이 심볼을 참조하고 있어
# 개명이 이번 변경의 범위를 넘기 때문이다. 하는 일은 OCR 추출뿐이다.
#
# [코드 흐름]
# 1) BusinessCardPipeline 인스턴스 생성 시 PaddleOCREngine을 초기화
# 2) run() 호출 시 OCR 엔진으로 텍스트 블록을 추출해 raw_blocks 로 반환
# 3) run_and_save()는 run() 결과를 JSON 파일로도 저장
# 4) print_result()는 블록 수만 출력한다 (OCR 원문은 개인정보다)
# 5) CLI 직접 실행 시 이미지 경로 + 문서 종류를 인자로 받아 파싱까지 보여준다
#
# [메서드 목록]
# - __init__():
#     PaddleOCREngine을 초기화. 인식 언어는 인자가 아니라 엔진이 못박은
#     text_recognition_model_name 이 결정한다 (paddleocr 3.4.0 은 lang 을 무시한다).
# - run(image_path):
#     이미지 → OCR → {image_file, raw_blocks} 반환.
#     텍스트가 없으면 error 키를 포함한 빈 결과 반환.
# - run_and_save(image_path, output_dir):
#     run() 실행 후 결과를 JSON 파일로 저장.
# - print_result(result):
#     블록 수만 출력 (CLI용, 메타데이터 전용).
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
# sys.argv
#   커맨드라인 인자 리스트. CLI 실행 시 이미지 경로와 문서 종류를 전달받음.
# ───────────────────────────────────────────
#
# ═══════════════════════════════════════════════════════════════

"""OCR 파이프라인: 이미지 입력 → 텍스트 블록 추출.

분류/파싱은 이 모듈이 하지 않는다 — services.ParsingSkill 이 문서 종류를 받아서 한다.
"""
import json
from pathlib import Path

from src.ocr.paddle_ocr_engine import PaddleOCREngine


class BusinessCardPipeline:
    def __init__(self):
        # OCR 엔진 초기화 (한 번만 생성하여 재사용)
        #
        # lang 인자는 받지 않는다. paddleocr 3.4.0 은 모델명을 명시하면 lang 을
        # 무시하므로(UserWarning), 여기서 lang 을 받아 넘기면 "바꿔도 아무 일도
        # 일어나지 않는" 죽은 파라미터를 한 겹 더 만드는 것에 불과했다.
        # 인식 언어의 정본은 PaddleOCREngine 의 text_recognition_model_name 이다.
        self.ocr_engine = PaddleOCREngine()

    def run(self, image_path: str) -> dict:
        """
        이미지 → OCR 텍스트 블록 추출.

        **분류는 여기서 하지 않는다.** 문서 종류를 모르기 때문이다 —
        종류는 요청과 함께 들어오고, 그것을 아는 곳은 routers/ocr.py 의 scan() 이다.
        예전에는 이 메서드가 명함 분류기를 돌려 result/result_korean 까지 만들었는데,
        scan() 이 그 셋을 통째로 버리고 ParsingSkill 로 같은 분류를 한 번 더 돌렸다.
        요청당 정규식 전수 통과가 두 번 일어났고(segment_text_blocks 포함),
        두 경로의 판정이 어긋나도 아무도 알아채지 못하는 구조였다.

        Args:
            image_path: 이미지 경로

        Returns:
            {
                "image_file": "card_001.jpg",
                "raw_blocks": [...],   # OCR 원본 블록 (text/confidence/bbox/block_index)
            }
            텍스트를 하나도 못 찾으면 여기에 "error" 키가 추가된다.
        """
        # OCR 수행 — 이미지에서 텍스트 블록 추출
        ocr_result = self.ocr_engine.extract(image_path)
        text_blocks = ocr_result["text_blocks"]

        # 텍스트가 감지되지 않은 경우 빈 결과 + 에러 메시지 반환
        if not text_blocks:
            return {
                "image_file": ocr_result["image_file"],
                "raw_blocks": [],
                "error": "텍스트를 감지하지 못했습니다.",
            }

        return {
            "image_file": ocr_result["image_file"],
            "raw_blocks": text_blocks,
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
        """진단용 요약 출력 (CLI용)."""
        if "error" in result:
            print("OCR failed")
            return

        # OCR output commonly contains names, email addresses and phone
        # numbers. Diagnostics must remain metadata-only.
        print(f"OCR completed (block_count={len(result.get('raw_blocks', []))})")


# --- CLI 실행용 ---
#
# 파싱까지 보고 싶으면 문서 종류를 인자로 준다 — 이 파이프라인은 종류를 판정하지
# 않으므로 사람이 알려줘야 한다. services 는 여기서 import 한다(모듈 최상단에서
# 하면 services → extract_pipeline → services 순환 import 가 된다).
if __name__ == "__main__":
    import sys

    if len(sys.argv) < 2:
        print("사용법: python -m src.pipeline.extract_pipeline <이미지 경로> [문서종류]")
        print("  문서종류: BUSINESS_CARD(기본) | POSTER | RECEIPT | TICKET | ETC")
        sys.exit(1)

    image_path = sys.argv[1]
    document_type = sys.argv[2] if len(sys.argv) > 2 else "BUSINESS_CARD"
    output_dir = "data/ocr_outputs"

    from services import parsing_skill

    pipeline = BusinessCardPipeline()
    result = pipeline.run_and_save(image_path, output_dir)
    pipeline.print_result(result)

    parsed = parsing_skill.execute(result.get("raw_blocks", []), document_type)["parsed"]
    print(f"parsed (type={document_type}, field_count={len(parsed)})")
