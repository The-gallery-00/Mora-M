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
# - __init__():
#     PaddleOCR 엔진 초기화. 인식 언어는 인자가 아니라
#     text_recognition_model_name 상수(korean_PP-OCRv5_mobile_rec)가 결정한다.
# - _preprocess_image(image_path):
#     ① 면적이 HARD_MAX_PIXELS 를 넘으면 **디코드하지 않고** ValueError 로 거부한다.
#     ② RESIZE_MAX_PIXELS(4M)를 초과하면 비율 유지 리사이즈 후 임시 JPEG 경로 반환.
#     ③ 그 이하면 원본 경로를 그대로 반환.
#     (검출 단계 입력 축소는 PaddleOCR 의 text_det_limit_side_len 이 담당한다)
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
#   이미지 파일을 **지연(lazy)** 으로 연다. 이 시점에는 헤더만 읽고 픽셀은 디코드하지 않는다.
#   .size 속성으로 (width, height) 튜플을 얻을 수 있다 — 헤더만으로 얻는 값이므로
#   "디코드 전에 크기를 보고 거부" 하는 판정에 쓸 수 있다. (실제 디코드는 .load()/.resize() 시점)
#   with 문으로 감싸 파일 핸들을 반드시 닫는다.
# ───────────────────────────────────────────
# img.draft(mode, size)
#   **JPEG 전용** 힌트. 디코더에게 "어차피 이 크기로 줄일 거니 1/2·1/4·1/8 스케일로 디코드해라"
#   라고 알려준다. 결과 크기는 요청 크기 이상으로 보장된다(내림 나눗셈 기반).
#   JPEG 이 아니면 base Image.draft 가 None 을 돌려주는 **무해한 no-op** 이다.
#   mode="RGB" 는 PIL 구현상 mode 를 실제로 바꾸지 않는다(L/YCbCr 요청일 때만 바꾼다) —
#   즉 여기서는 크기 힌트로만 동작한다.
# ───────────────────────────────────────────
# img.resize(new_size, Image.LANCZOS)
#   이미지를 지정 크기로 리사이즈한다. **내부적으로 load() 를 먼저 부르므로 이 호출이 곧 전체 디코드다.**
#   LANCZOS는 고품질 다운샘플링 필터 (안티앨리어싱).
# ───────────────────────────────────────────
# img.save(path, "JPEG", quality=95)
#   이미지를 파일로 저장한다. 포맷을 확장자 추론에 맡기지 않고 명시한다.
#   quality=95: JPEG 압축 품질 (1~95, 높을수록 고품질).
#   JPEG 은 알파 채널을 저장할 수 없다 → RGBA/LA/P 는 저장 전에 반드시 RGB 로 평탄화해야 한다.
# ───────────────────────────────────────────
# Image.new(...) + paste(rgba, mask=alpha)
#   투명 배경을 흰색으로 합성한다. 단순 convert("RGB")는 알파를 버릴 뿐이라
#   "투명 배경 + 검은 글자" PNG 가 검은 배경 + 검은 글자로 바뀌어 OCR 이 아무것도 못 읽는다.
# ───────────────────────────────────────────
# PaddleOCR(text_detection_model_name, text_det_limit_side_len, ...)
#   PaddleOCR 엔진을 초기화한다.
#   lang 은 넘기지 않는다 — 모델명을 명시하면 paddleocr 3.4.0 이 lang 을 무시하고
#   UserWarning 만 낸다. 인식 언어는 text_recognition_model_name 이 결정한다.
#   use_doc_orientation_classify=False: 문서 방향 감지 비활성화.
#   use_doc_unwarping=False: 문서 왜곡 보정 비활성화.
#   use_textline_orientation=False: 텍스트라인 방향 분류 모델을 아예 로드하지 않는다.
#   (명함은 대부분 정방향이라 비활성화하여 속도 향상)
#   text_detection_model_name="PP-OCRv5_mobile_det": 검출 모델을 경량판으로 고정(85MB→4.8MB).
#   text_recognition_model_name="korean_PP-OCRv5_mobile_rec": det 를 명시하면 lang→rec
#     자동 매핑이 풀리므로 인식 모델도 함께 못박아야 한다.
#   text_det_limit_side_len=960 / text_det_limit_type="max":
#     검출 입력의 긴 변을 960 이하로 clamp 한다. 기본값은 limit_type="min" 이라
#     큰 입력을 축소하지 않는다 — 이것이 요청당 메모리 폭주(=503)의 직접 원인이었다.
#     인식은 원본에서 크롭하므로 이 clamp 로 인식률이 떨어지지 않는다.
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
import logging
import os
import tempfile
from pathlib import Path

from PIL import Image
from paddleocr import PaddleOCR

logger = logging.getLogger(__name__)

# 검출(det) 단계에 넣을 이미지의 긴 변 상한.
# PaddleOCR 이 내부에서 리사이즈하므로 여기서 원본을 건드리지 않는다 → 인식(rec)은 원본 해상도에서 크롭한다.
DET_LIMIT_SIDE_LEN = 960

# ── 리사이즈를 **트리거**하는 면적 (상한이 아니다) ──────────────────────────────
#
# [이 값을 4M 로 유지하는 근거 — 실측, 2026-08]
# "peak 메모리가 W×H 에 선형" 이라는 이 브랜치의 진단은 **수정 전 설정에 한정된 사실**이다.
# 그때는 det 가 원본 해상도로 돌았기 때문에 선형이었다. text_det_limit_side_len=960 /
# limit_type="max" 를 걸고 나면 det 입력이 상수 크기가 되어 선형성이 사라진다.
# 이 파일의 수정된 생성자 설정 그대로, 요청마다 **새 프로세스**로 격리 측정한 값
# (psutil 로 10ms 간격 RSS 샘플링, rec 이 실제로 도는 21블록 이미지):
#     1280×960   (1.23Mpx) → init 738MB / peak  959MB / 10.66s
#     2000×2000  (4.00Mpx) → init 737MB / peak 1035MB /  7.64s
#     4032×3024 (12.19Mpx) → init 738MB / peak  988MB /  9.95s
#     6000×4500 (27.00Mpx) → init 736MB / peak 1030MB /  9.75s
# 즉 1.2Mpx~27Mpx 구간에서 peak 이 약 1.0GB 로 **평평하다**. 4Mpx 가 2Gi 예산을
# 넘긴다는 우려는 실측으로 반증됐으므로 값을 낮추지 않는다. 낮추면 앱이 도달하지도
# 못하는 경로에 LANCZOS 리사이즈 비용만 얹는 꼴이다.
# (소요 시간이 블록 수에 선형이라는 사실은 아래 __init__ 주석의 재측정표를 볼 것.)
#
# [2차 주석의 "이 가드가 디컴프레션 밤을 막는다"는 결론은 틀렸다 — 정정]
# 실측표는 그대로 유효하지만 결론이 뒤집혀 있었다. 이 임계값을 **넘어야만**
# _preprocess_image 가 img.resize() 를 부르고, resize() 가 곧 전체 디코드다.
# 즉 4Mpx **이하** 입력은 이 코드가 디코드조차 하지 않고 그대로 넘기는 반면,
# 초과 입력은 **가드 판정 때문에** 원본 해상도 RGB 버퍼를 통째로 올렸다.
# (100Mpx PNG → 약 300MB. Pillow 자체 방어선인 MAX_IMAGE_PIXELS 는 89.5Mpx 에서
#  경고, 그 2배인 179Mpx 에서야 DecompressionBombError 라 100Mpx 는 통과한다.)
# 밤을 막는 것은 아래 HARD_MAX_PIXELS 이고, 이 상수는 "여기부터는 줄여서 넘긴다"는
# **품질/비용 노브**일 뿐이다. 이름도 MAX_PIXELS → RESIZE_MAX_PIXELS 로 바꿨다 —
# "MAX" 라는 이름 자체가 "이 위는 거부된다"는 거짓 신호였다.
#
# [앱 경로에서는 도달 불가]
# src/features/scan/imagePipeline.ts 의 MAX_SIDE=1280 이 긴 변을 1280 으로 줄여 올리므로
# 앱 트래픽의 최대는 1280×1280 = 1.64Mpx 다. 이 임계값은 앱 외 호출자(직접 curl, 잘못된
# 클라이언트)에게만 의미가 있다.
RESIZE_MAX_PIXELS = 4_000_000

# ── 진짜 상한 (디컴프레션 밤 방어선) ────────────────────────────────────────────
#
# 여기를 넘는 입력은 **한 픽셀도 디코드하지 않고 거부한다.** Image.open() 은 지연 로딩이라
# 헤더만 읽고 .size 를 알려주므로, 디코드 전에 판정할 수 있다는 것이 이 방어선의 전부다.
#
# [50Mpx 로 잡은 근거 — 실측, 2026-08-05]
#   · 상한 바로 아래의 **최악 입력**(draft 가 안 먹는 8000×6000 PNG = 48Mpx)을
#     _preprocess_image 에 넣고 5ms 간격 RSS 샘플링:  **전이 peak +263MB**.
#     (같은 48Mpx 라도 JPEG 은 draft 덕에 +92MB 였다. PNG 가 최악이라 이 값을 기준으로 잡는다.)
#     내역: RGB 디코드 3B/px = 144MB + LANCZOS 2-pass 중간 버퍼(new_w × old_h × 3) 등.
#   · 요청 peak 실측이 약 1.03GB, 배포 예산이 2Gi(=2.15GB) 이므로 여유는 약 1.1GB.
#     최악 +0.26GB 는 그 안에 넉넉히 들어간다.
#   · 그 위(수백 Mpx)는 전이 버퍼만으로 예산을 날린다 → 거부가 유일하게 안전한 처리다.
#     (선형 외삽: 200Mpx PNG ≈ +1.1GB → 2Gi 를 넘긴다. 상한을 올릴 때 이 식을 쓸 것.)
#   · Pillow 자체 DecompressionBombError 문턱(179Mpx)보다 훨씬 낮다. 즉 이 가드가 먼저
#     걸리고, Pillow 의 경고 문턱(89.5Mpx)에도 도달하지 않는다.
#   · 실제 트래픽 기준으로도 과하지 않다: 앱은 1280×1280(1.64Mpx)까지만 올리고,
#     108MP 급 폰 원본을 직접 던지는 호출자만 거부된다.
#
# 면적 기준인 이유: 1280×1280(=1.64Mpx) 같은 정사각 입력은 "긴 변" 기준 가드를 통과한다.
# 메모리를 먹는 것은 긴 변이 아니라 면적이다.
HARD_MAX_PIXELS = 50_000_000


class PaddleOCREngine:
    def __init__(self):
        # PaddleOCR 엔진 초기화 (문서 방향 감지/왜곡 보정 비활성화로 속도 향상)
        #
        # 검출 모델과 입력 상한을 **반드시 명시한다**. 생략하면 lang="korean" 이
        # 중량 PP-OCRv5_server_det 로 해석되고, 게다가 기본 limit_type 이 "min" 이라
        # 큰 입력이 축소되지 않은 채 그대로 추론에 들어간다 → 요청당 peak RSS 가
        # 픽셀당 약 5.1KB 로 선형 증가해 Cloud Run 인스턴스가 죽는다(503).
        #
        # [1280×960 의 소요 시간이 파일 안에서 갈렸던 건 — 재측정으로 확정, 2026-08-05]
        # 위 RESIZE_MAX_PIXELS 표는 "1280×960 → 10.66s", 예전 이 자리 주석은 "1280×960 → 1.87s"
        # 라고 적었다. 같은 입력 크기인데 5.7배 차이라 둘 중 하나는 거짓 신호였다.
        # 원인은 콜드/웜이 아니라 **검출 블록 수**다. rec 은 검출된 크롭마다 1회 도므로
        # 소요 시간은 픽셀 수가 아니라 블록 수에 선형이다. 1280×960 고정, 블록 수만 바꾼 실측
        # (psutil 10ms RSS 샘플링, 조건마다 새 프로세스, 같은 프로세스에서 3회 반복):
        #     블록  1개 → 1차 1.03s / 2차 0.92s   peak 1017MB
        #     블록  4개 → 1차 1.89s / 2차 1.95s   peak 1024MB
        #     블록 10개 → 1차 3.34s / 2차 3.30s   peak 1028MB
        #     블록 21개 → 1차 6.43s / 2차 6.24s   peak 1034MB
        #   → 회귀식 약 t ≈ 0.73s + 0.26s × 블록수. 1·2차(콜드/웜) 차이는 오차 범위다
        #     (모델 로드는 __init__ 에서 이미 끝나 있고 그 비용은 init 2.3s 로 따로 잡힌다).
        #   → peak 은 블록 수와도 사실상 무관하게 약 1.0GB 로 평평하다.
        # 결론: **두 수치는 모순이 아니라 서로 다른 블록 수의 값이다.** 1.87s ≒ 4블록,
        # 10.66s ≒ 21블록(측정 PC 가 달라 절대값은 이 표보다 느렸다). 그러므로
        # 시간을 인용할 때는 **반드시 블록 수를 함께 적는다.**
        # 실측(1280×960, 21블록): 수정 전 peak 7083MB / 23.20s → 수정 후 peak 959MB / 10.66s.
        # 실측(1280×960,  4블록): 수정 후 peak 957MB / 1.87s.
        #
        # 참고: server/spring/.../RestTemplateConfig.java 가 OCR read timeout 90초의 근거로
        #    이 수치를 인용한다. 예전에는 "1.87초에 끝나므로" 라고만 적어 블록 수를 숨겼는데,
        #    같은 브랜치에서 블록 수를 밝히도록 정정됐다. 이 표를 고칠 때는 그쪽도 함께 봐라.
        #
        # text_recognition_model_name 도 함께 명시해야 한다 —
        # text_detection_model_name 을 지정하는 순간 lang → rec 자동 매핑이 풀려
        # 한국어 mobile_rec 대신 server_rec 가 선택된다.
        #
        # **lang 파라미터는 의도적으로 받지 않는다.** paddleocr 3.4.0 은 모델명을
        # 명시하면 lang / ocr_version 을 무시하고 UserWarning 만 낸다
        # ("lang and ocr_version will be ignored when model names ... are not None").
        # 그대로 두면 다음 사람이 lang="en" 으로 바꿔도 한국어 모델이 도는
        # **아무 효과 없는 죽은 파라미터**가 된다 → 체인 전체에서 제거했다.
        # 인식 언어를 바꾸려면 아래 text_recognition_model_name 을 직접 바꿔야 한다.
        self.ocr = PaddleOCR(
            enable_mkldnn=False,
            use_doc_orientation_classify=False,
            use_doc_unwarping=False,
            use_textline_orientation=False,
            text_detection_model_name="PP-OCRv5_mobile_det",
            text_recognition_model_name="korean_PP-OCRv5_mobile_rec",
            text_det_limit_side_len=DET_LIMIT_SIDE_LEN,
            text_det_limit_type="max",
        )

    def _preprocess_image(self, image_path: str) -> str:
        """면적 상한 검사 + 필요 시 비율 유지 리사이즈. 처리할 이미지 경로를 반환한다.

        순서가 중요하다 — **거부 판정이 디코드보다 먼저**여야 한다.
        Image.open() 은 지연 로딩이라 헤더만 읽는다. .size 는 그 헤더에서 나오므로
        여기까지는 픽셀 메모리가 0 이다. 디코드는 resize()(내부적으로 load())에서 처음 일어난다.
        2차까지의 코드는 이 순서가 없어서, 큰 입력일수록 오히려 디코드를 강행했다.

        HARD_MAX_PIXELS 초과는 ValueError 로 올린다. routers/ocr.py 의 scan() 이
        이미 `except Exception` 으로 500 JSON 을 만들고 /health 는 503 으로 떨어뜨리므로,
        여기서 HTTP 를 아는 예외를 쓰지 않는 것이 결합도를 낮춘다.
        거부 사유(픽셀 수)는 **로그에만** 남긴다 — 응답 본문에 내부 임계값을 실어 보내면
        무인증 엔드포인트에서 방어선을 그대로 알려주는 꼴이다.
        """
        with Image.open(image_path) as img:
            width, height = img.size
            pixels = width * height

            # ① 진짜 상한. 디코드하기 전에 거부한다 (디컴프레션 밤 방어).
            if pixels > HARD_MAX_PIXELS:
                logger.warning(
                    "image rejected before decode (%dx%d = %d px > %d)",
                    width, height, pixels, HARD_MAX_PIXELS,
                )
                raise ValueError("input image exceeds the pixel limit")

            # ② 리사이즈 임계 이하이면 원본 그대로 사용 (검출 축소는 엔진이 담당한다).
            #    이 경로는 PIL 디코드를 아예 건너뛴다 — 픽셀은 PaddleOCR 이 한 번만 읽는다.
            if pixels <= RESIZE_MAX_PIXELS:
                return image_path

            # ③ 비율을 유지하면서 총 픽셀 수를 RESIZE_MAX_PIXELS에 맞춤
            ratio = (RESIZE_MAX_PIXELS / pixels) ** 0.5
            new_size = (max(1, int(width * ratio)), max(1, int(height * ratio)))

            # JPEG 이면 디코더에게 축소 스케일(1/2·1/4·1/8)을 먼저 알려 **디코드 버퍼 자체**를 줄인다.
            # draft 는 요청 크기 이상을 보장하므로 아래 resize 는 언제나 축소다(확대되지 않는다).
            # 실측(8000×6000 = 48Mpx, 목표 2309×1732): JPEG +92MB vs 같은 크기 PNG +263MB.
            # JPEG 이 아니면 조용한 no-op 이다 — PNG/BMP 등에는 이 최적화가 없고,
            # 그래서 위 HARD_MAX_PIXELS 방어선이 따로 필요하다.
            img.draft("RGB", new_size)

            # 여기서 처음으로 실제 디코드가 일어난다. resize() 결과는 원본과 독립된 새 Image 라
            # with 블록을 벗어나 파일 핸들이 닫힌 뒤에도 안전하게 쓸 수 있다.
            # 모드 변환(→RGB)은 **축소한 뒤에** 한다. 원본 해상도에서 P→RGBA 로 펴면
            # 1B/px 짜리 팔레트 이미지가 4B/px 로 부풀어 방금 아낀 메모리를 그대로 토해낸다.
            # (그 대가로 P/1 모드는 PIL 이 resample 을 NEAREST 로 강제한다 — 팔레트 이미지는
            #  드물고 det/rec 입력이 어차피 960px 로 clamp 되므로 인식률 영향은 무시할 만하다.)
            img_resized = img.resize(new_size, Image.LANCZOS)

        # JPEG 은 알파를 저장할 수 없다. 평탄화 없이 RGBA 를 저장하면
        # OSError: cannot write mode RGBA as JPEG 로 요청 전체가 500 이 된다 —
        # "4Mpx 초과 + 투명 PNG" 조합에서만 터지므로 눈에 잘 안 띄는 종류의 결함이었다.
        # 단순 convert("RGB") 는 알파를 버릴 뿐이라 투명 배경이 검게 남아 OCR 이 아무것도 못 읽는다.
        # → 흰 배경에 합성한다(명함/문서 스캔의 사실상 표준 배경).
        if img_resized.mode in ("RGBA", "LA", "P", "PA"):
            rgba = img_resized.convert("RGBA")
            flattened = Image.new("RGB", rgba.size, (255, 255, 255))
            flattened.paste(rgba, mask=rgba.getchannel("A"))
            img_resized = flattened
        elif img_resized.mode != "RGB":
            # L(흑백), CMYK, I;16 등. rec 입력은 어차피 3채널이라 여기서 맞춰 둔다.
            img_resized = img_resized.convert("RGB")

        # 리사이즈된 이미지를 임시 파일로 저장.
        # PNG 무손실 저장도 검토했으나 채택하지 않았다 — 4Mpx PNG 는 10MB 이상에 인코딩도 느리고,
        # Cloud Run 의 쓰기 가능 파일시스템은 tmpfs(=메모리)라 파일 크기가 곧 메모리다.
        # q95 JPEG 는 1~2MB 이며 이 파이프라인의 인식률에 영향을 주지 않는다(det/rec 입력은
        # 어차피 960px 로 clamp 된다).
        # NamedTemporaryFile 핸들은 즉시 닫는다 — 열어둔 채 두면 핸들이 샌다.
        tmp = tempfile.NamedTemporaryFile(suffix=".jpg", delete=False)
        tmp.close()
        img_resized.save(tmp.name, "JPEG", quality=95)
        img_resized.close()
        return tmp.name

    def extract(self, image_path: str) -> dict:
        """이미지에서 OCR 수행 후 텍스트 블록 리스트를 표준 포맷으로 반환."""
        # 전처리: 필요 시 이미지 리사이즈
        processed_path = self._preprocess_image(image_path)

        try:
            # PaddleOCR 실행
            results = self.ocr.predict(processed_path)
        finally:
            # 리사이즈로 새 파일을 만든 경우에만 지운다 (원본은 호출부 소유).
            # Cloud Run 의 쓰기 가능 파일시스템은 메모리라 남겨두면 인스턴스 메모리를 갉아먹는다.
            if processed_path != image_path:
                try:
                    os.unlink(processed_path)
                except OSError:
                    pass

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
