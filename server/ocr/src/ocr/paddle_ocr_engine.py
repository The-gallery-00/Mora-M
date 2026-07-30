# ═══════════════════════════════════════════════════════════════
# src/ocr/paddle_ocr_engine.py — PaddleOCR 엔진 래퍼
# ═══════════════════════════════════════════════════════════════
#
# [역할]
# PaddleOCR 라이브러리를 감싸서 이미지에서 텍스트 블록을 추출하고,
# 표준 딕셔너리 포맷으로 변환하여 반환한다.
# 이미지가 너무 크면 자동으로 리사이즈하여 처리 속도를 최적화한다.
#
# [코드 흐름]
# 1) PaddleOCREngine 인스턴스 생성 시 PaddleOCR을 초기화한다
# 2) extract() 호출 시:
#    a) _preprocess_image()로 이미지 크기를 확인/리사이즈한다
#    b) PaddleOCR의 predict()로 OCR을 수행한다
#    c) 결과에서 텍스트, 신뢰도, 바운딩 박스를 추출한다
#    d) 표준 딕셔너리 포맷의 text_blocks 리스트를 반환한다
# 3) extract_and_save()는 extract() 결과를 JSON 파일로도 저장한다
#
# [메서드 목록]
# - __init__(lang):
#     PaddleOCR 엔진 초기화. lang으로 인식 언어 지정
# - _preprocess_image(image_path):
#     이미지의 긴 변이 MAX_SIDE(1280)을 초과하면 비율 유지 리사이즈.
#     리사이즈된 이미지를 임시 파일로 저장하고 경로 반환.
# - extract(image_path):
#     이미지에서 OCR 수행. 텍스트/신뢰도/bbox를 표준 포맷으로 반환.
# - extract_and_save(image_path, output_dir):
#     extract() 실행 후 결과를 JSON 파일로 저장.
#
# [사용된 라이브러리]
# ───────────────────────────────────────────
# json.dump(obj, file, ensure_ascii=False, indent=2)
#   파이썬 객체를 JSON 형태로 파일에 기록한다.
#   ensure_ascii=False: 한글이 유니코드 이스케이프 없이 그대로 저장됨.
#   indent=2: 보기 좋게 들여쓰기.
# ───────────────────────────────────────────
# tempfile.NamedTemporaryFile(suffix, delete)
#   시스템 임시 디렉토리에 고유 이름의 임시 파일을 생성한다.
#   delete=False: 파일 객체를 닫아도 삭제되지 않음.
#   리사이즈된 이미지를 임시 저장할 때 사용.
# ───────────────────────────────────────────
# pathlib.Path(path).name / .stem
#   .name: 파일명+확장자 (예: "card.jpg")
#   .stem: 확장자 제외 파일명 (예: "card")
#   출력 파일명 생성에 사용.
# ───────────────────────────────────────────
# PIL.Image.open(path)
#   이미지 파일을 열어 Image 객체로 반환한다.
#   .size 속성으로 (width, height) 튜플을 얻을 수 있다.
# ───────────────────────────────────────────
# img.resize(new_size, Image.LANCZOS)
#   이미지를 지정 크기로 리사이즈한다.
#   LANCZOS는 고품질 다운샘플링 필터 (안티앨리어싱).
# ───────────────────────────────────────────
# img.save(path, quality=95)
#   이미지를 파일로 저장한다.
#   quality=95: JPEG 압축 품질 (1~95, 높을수록 고품질).
# ───────────────────────────────────────────
# PaddleOCR(lang, use_doc_orientation_classify, use_doc_unwarping)
#   PaddleOCR 엔진을 초기화한다.
#   lang="korean": 한국어 인식 모델 사용.
#   use_doc_orientation_classify=False: 문서 방향 감지 비활성화.
#   use_doc_unwarping=False: 문서 왜곡 보정 비활성화.
#   (명함은 대부분 정방향이라 비활성화하여 속도 향상)
# ───────────────────────────────────────────
# self.ocr.predict(image_path)
#   이미지 경로를 받아 OCR을 수행한다.
#   반환값은 결과 객체의 리스트. 각 객체에서 rec_texts(텍스트),
#   rec_scores(신뢰도), rec_polys(바운딩 폴리곤)를 꺼낼 수 있다.
# ───────────────────────────────────────────
# hasattr(obj, "tolist")
#   객체가 tolist 메서드를 가지고 있는지 확인한다.
#   numpy 배열인 경우 .tolist()로 파이썬 리스트로 변환하기 위해 사용.
# ───────────────────────────────────────────
#
# ═══════════════════════════════════════════════════════════════

"""PaddleOCR 래퍼: 이미지에서 텍스트 블록을 추출하여 표준 포맷으로 반환."""
import json
import tempfile
from pathlib import Path

from PIL import Image
from paddleocr import PaddleOCR

# 이미지 긴 변의 최대 허용 크기 (이를 초과하면 리사이즈)
MAX_SIDE = 1280


class PaddleOCREngine:
    def __init__(self, lang="korean"):
        # PaddleOCR 엔진 초기화 (문서 방향 감지/왜곡 보정 비활성화로 속도 향상)
        self.ocr = PaddleOCR(
            lang=lang,
            use_doc_orientation_classify=False,
            use_doc_unwarping=False,
        )

    def _preprocess_image(self, image_path: str) -> str:
        """이미지 긴 변이 MAX_SIDE를 초과하면 비율 유지 리사이즈."""
        img = Image.open(image_path)
        max_dim = max(img.size)  # width와 height 중 큰 값

        # 최대 크기 이하이면 원본 그대로 사용
        if max_dim <= MAX_SIDE:
            return image_path

        # 비율을 유지하면서 긴 변을 MAX_SIDE에 맞춤
        ratio = MAX_SIDE / max_dim
        new_size = (int(img.size[0] * ratio), int(img.size[1] * ratio))
        img_resized = img.resize(new_size, Image.LANCZOS)

        # 리사이즈된 이미지를 임시 파일로 저장
        tmp = tempfile.NamedTemporaryFile(suffix=".jpg", delete=False)
        img_resized.save(tmp.name, quality=95)
        return tmp.name

    def extract(self, image_path: str) -> dict:
        """이미지에서 OCR 수행 후 텍스트 블록 리스트를 표준 포맷으로 반환."""
        # 전처리: 필요 시 이미지 리사이즈
        processed_path = self._preprocess_image(image_path)

        # PaddleOCR 실행
        results = self.ocr.predict(processed_path)

        text_blocks = []
        for res in results:
            # 결과 객체에서 딕셔너리 데이터 추출 (버전 호환성 처리)
            data = getattr(res, "json", res)
            if isinstance(data, dict) and "res" in data:
                data = data["res"]

            # 텍스트, 신뢰도, 바운딩 폴리곤 추출 (없으면 빈 리스트)
            rec_texts = data.get("rec_texts", []) if isinstance(data, dict) else []
            rec_scores = data.get("rec_scores", []) if isinstance(data, dict) else []
            rec_polys = data.get("rec_polys", []) if isinstance(data, dict) else []

            # 각 인식된 텍스트를 표준 블록 포맷으로 변환
            for idx, text in enumerate(rec_texts):
                confidence = float(rec_scores[idx]) if idx < len(rec_scores) else 0.0
                bbox = rec_polys[idx] if idx < len(rec_polys) else []

                # numpy 배열이면 파이썬 리스트로 변환 (JSON 직렬화 호환)
                if hasattr(bbox, "tolist"):
                    bbox = bbox.tolist()

                text_blocks.append({
                    "text": text,
                    "confidence": round(confidence, 4),
                    "bbox": bbox,
                    "block_index": len(text_blocks),  # 0부터 시작하는 순서 인덱스
                })

        return {
            "image_file": Path(image_path).name,
            "ocr_engine": "PaddleOCR",
            "text_blocks": text_blocks,
        }

    def extract_and_save(self, image_path: str, output_dir: str) -> dict:
        """extract() 실행 후 결과를 JSON 파일로 저장."""
        result = self.extract(image_path)

        # 출력 파일 경로: output_dir/원본파일명_ocr.json
        output_path = Path(output_dir) / f"{Path(image_path).stem}_ocr.json"
        output_path.parent.mkdir(parents=True, exist_ok=True)

        # JSON으로 저장 (한글 그대로 보존)
        with open(output_path, "w", encoding="utf-8") as f:
            json.dump(result, f, ensure_ascii=False, indent=2)
        return result
