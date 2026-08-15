# ═══════════════════════════════════════════════════════════════
# src/classifier/doc_type.py — 문서 종류 판정
# ═══════════════════════════════════════════════════════════════
#
# [역할]
# 업로드된 이미지가 명함/포스터/영수증/티켓 중 무엇인지 판정한다.
# 두 단계다 — 티켓은 OCR 텍스트 키워드로 먼저 걸러내고, 나머지를 이미지 분류기가 나눈다.
#
# [왜 두 단계인가]
# 이미지 분류기의 클래스가 namecard/poster/recipt **3종뿐**이라 티켓 클래스가 없다.
# 실측(데이터셋 티켓 10장): 분류기에 넣으면 명함 8 / 포스터 2 로 흩어진다.
# 반면 티켓은 텍스트 신호가 매우 강하다("승차권", "KTX", "좌석번호", "출발일"…).
# 실측: 키워드 2개 이상 규칙으로 티켓 10/10 검출, 비티켓 76장 오검출 0.
# 그래서 키워드를 앞에 두고, 걸리지 않은 것만 이미지 분류기로 보낸다.
# (원본 웹 ocr/routers/ocr.py 의 순서와 같다.)
#
# [왜 torch 가 아니라 ONNX 인가]
# 웹은 torch + torchvision 으로 ResNet18 을 돌린다. 그대로 가져오면 CPU wheel 만으로도
# 이미지가 200MB+ 커지고 런타임 상주가 250~350MB 늘어난다. 이 서비스의 Cloud Run
# 예산 2Gi 는 OOM 때문에 방금 깎은 값이고 여유가 약 1.1GB 뿐이다(ADR-002 §0).
# onnxruntime 는 그 1/10 수준이고, ResNet18 은 연산자가 단순해 변환 위험이 낮다.
#
# 변환 동치는 무작위 입력 200개로 검증했다: argmax 불일치 0/200,
# softmax 최대 오차 5.96e-07. 즉 **같은 입력에 같은 답을 낸다.**
# 변환 스크립트는 tools/convert_classifier_to_onnx.py 에 있다.
#
# [실패해도 서비스는 살아야 한다]
# 모델 파일이 없거나 onnxruntime 이 없으면 판정을 포기하고 None 을 돌려준다.
# 호출부(routers/ocr.py)는 그때 종전처럼 "판정하지 않음"(classified=false)으로 응답한다.
# 분류기가 없다고 스캔 자체가 실패하면 안 된다 — 파싱은 종류 없이도 기본값으로 돌아간다.
#
# [메서드 목록]
# - detect_ticket(text_blocks): OCR 블록에 티켓 키워드가 2개 이상인가.
# - classify_image(image_path): 이미지 → (document_type, confidence). 실패 시 None.
# - classify_document(image_path, text_blocks): 위 둘을 합친 최종 판정. 실패 시 None.
#
# ═══════════════════════════════════════════════════════════════

"""문서 종류 판정 — 티켓 키워드 선판정 + ONNX ResNet18 이미지 분류."""
import json
import logging
import os
import threading

logger = logging.getLogger(__name__)

_THIS_DIR = os.path.dirname(os.path.abspath(__file__))
MODEL_DIR = os.environ.get(
    "OCR_DOC_CLASSIFIER_DIR",
    os.path.normpath(os.path.join(_THIS_DIR, "..", "..", "models")),
)
_ONNX_PATH = os.path.join(MODEL_DIR, "image_classifier.onnx")
_META_PATH = os.path.join(MODEL_DIR, "image_classifier.json")

# 분류기 클래스명 → 앱/DB 문서 종류.
# "recipt" 오타는 학습 시 폴더명 그대로라 **고칠 수 없다** — 체크포인트에 박혀 있다.
CLASS_TO_TYPE = {
    "namecard": "BUSINESS_CARD",
    "poster": "POSTER",
    "recipt": "RECEIPT",
}

# 티켓 감지 키워드. 원본 웹 routers/ocr.py 의 목록을 그대로 옮겼다.
TICKET_KEYWORDS = [
    # 공통
    "탑승권", "승차권", "편명", "항공편명", "좌석번호", "좌석",
    "탑승구", "탑승장", "호차", "열차정보", "열차번호",
    # 열차
    "KTX", "SRT", "ITX", "무궁화", "새마을",
    # 항공사 코드
    "OZ", "LJ", "TW", "7C", "BX", "ZE", "RS",
    # 공항 코드
    "ICN", "GMP", "CJU", "PUS", "TAE", "KPO",
    "LAX", "NRT", "KIX", "CXR",
    # 맥락
    "출발일", "출발시간", "도착", "구간",
    "예약번호", "승차권 번호", "e티켓",
    "모바일 탑승권", "스마트티켓",
]

# 2개 이상 일치해야 티켓으로 본다. 1개면 "도착"/"좌석" 같은 흔한 낱말 하나로
# 명함·포스터가 티켓이 된다. 실측에서 2 는 검출 10/10 · 오검출 0/76 이었다.
TICKET_MIN_MATCH = 2

_session = None
_meta = None
_load_failed = False
_lock = threading.Lock()


def _load():
    """최초 호출 때 1회 로드. 실패는 한 번만 로그하고 이후 조용히 포기한다."""
    global _session, _meta, _load_failed
    if _session is not None or _load_failed:
        return _session
    with _lock:
        if _session is not None or _load_failed:
            return _session
        try:
            import onnxruntime as ort  # 지연 import — 없으면 여기서 실패한다
            with open(_META_PATH, encoding="utf-8") as f:
                meta = json.load(f)
            sess = ort.InferenceSession(_ONNX_PATH, providers=["CPUExecutionProvider"])
            _meta = meta
            _session = sess
            logger.info("doc classifier loaded (classes=%d)", len(meta["classes"]))
        except Exception as exc:  # noqa: BLE001 — 판정 실패가 스캔 실패가 되면 안 된다
            _load_failed = True
            logger.warning("doc classifier unavailable (%s)", type(exc).__name__)
    return _session


def detect_ticket(text_blocks: list[dict]) -> bool:
    """OCR 블록에 티켓 키워드가 TICKET_MIN_MATCH 개 이상 있는가."""
    if not text_blocks:
        return False
    all_text = " ".join((b.get("text") or "") for b in text_blocks).upper()
    hits = sum(1 for kw in TICKET_KEYWORDS if kw.upper() in all_text)
    return hits >= TICKET_MIN_MATCH


def classify_image(image_path: str):
    """이미지 → (document_type, confidence). 분류기가 없거나 실패하면 None."""
    sess = _load()
    if sess is None:
        return None
    try:
        import numpy as np
        from PIL import Image

        size = _meta.get("input_size", 224)
        mean = np.array(_meta["mean"], dtype=np.float32)
        std = np.array(_meta["std"], dtype=np.float32)

        with Image.open(image_path) as im:
            im = im.convert("RGB").resize((size, size), Image.BILINEAR)
            arr = np.asarray(im, dtype=np.float32) / 255.0
        arr = (arr - mean) / std
        x = arr.transpose(2, 0, 1)[None].astype(np.float32)

        logits = sess.run(["logits"], {"input": x})[0][0]
        e = np.exp(logits - logits.max())
        probs = e / e.sum()
        idx = int(probs.argmax())
        cls = _meta["classes"][idx]
        doc_type = CLASS_TO_TYPE.get(cls)
        if doc_type is None:
            return None
        return doc_type, float(probs[idx])
    except Exception as exc:  # noqa: BLE001
        logger.warning("doc classification failed (%s)", type(exc).__name__)
        return None


def classify_document(image_path: str, text_blocks: list[dict]):
    """최종 판정. (document_type, confidence) 또는 None(판정 불가).

    티켓을 먼저 본다 — 이미지 분류기에 티켓 클래스가 없기 때문이다(모듈 주석 참조).
    티켓 confidence 는 **1.0 이 아니라 None 이 아닌 실측처럼 보이면 안 된다.**
    키워드 매칭은 확률이 아니므로 0.0 을 돌려주고, 호출부가 그 사실을
    응답의 confidence 로 그대로 전달한다. 앱은 CLS-05 로 이 경우를 이미 다룬다
    (src/features/scan/scanStore.ts 의 'keyword' tier).
    """
    if detect_ticket(text_blocks):
        return "TICKET", 0.0
    return classify_image(image_path)
