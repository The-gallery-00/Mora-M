# ═══════════════════════════════════════════════════════════════
# routers/ocr.py — OCR 스캔 API 라우터
# ═══════════════════════════════════════════════════════════════
#
# [역할]
# 클라이언트가 업로드한 이미지를 받아 OCR을 수행하고,
# 규칙 기반 파싱으로 명함 필드(이름, 회사, 전화번호 등)를
# 분류한 결과를 JSON으로 반환하는 API 엔드포인트를 정의한다.
# 추가로 추론 경로가 실제로 살아있는지 확인하는 헬스 엔드포인트도 제공한다.
#
# [코드 흐름]
# 1) 클라이언트가 POST /api/scan 으로 이미지 파일을 업로드한다
# 2) 파일명을 UUID로 변환하여 uploads 디렉토리에 저장한다 (storage.save_upload_file)
# 3) pipeline.run()으로 OCR을 수행하여 텍스트 블록을 추출한다
# 4) parsing_skill.execute()로 텍스트 블록을 명함 필드로 분류한다
# 5) 파싱 결과, 원본 블록, 이미지 URL, 그리고 **분류 미수행 플래그(classified:false)** 를
#    JSON으로 반환한다 (이 서비스에는 문서 종류 분류기가 없다 — scan() 주석 참조)
# 6) 에러 발생 시 500 상태 코드와 에러 메시지를 반환한다
# 7) POST /api/commit 은 사용자가 필드를 확인한 뒤 원본 이미지를 확정 저장한다
#
# [메서드 목록]
# - scan(file): POST /scan 엔드포인트.
#     업로드된 이미지를 저장 → OCR → 파싱 → 결과 반환
# - commit(...): POST /commit 엔드포인트. 사용자 확인 후 원본 이미지를 영속화한다.
# - SelftestHarnessError: 셀프테스트 **이미지를 만들지 못한** 경우의 전용 예외.
#     추론이 죽은 것과 다른 사건이라 health() 가 구분해서 보고한다.
# - _selftest_font(): 셀프테스트용 폰트를 확보한다 (Pillow 내장 TTF → 비트맵 폴백). 인자 없음.
# - _ocr_selftest(): **글자가 그려진** 합성 이미지를 실제 파이프라인에 태워보는 자가진단.
#     소요 시간(ms)과 검출 블록 수를 반환하고, 실패 시 예외를 그대로 올린다.
# - health(): GET /health 엔드포인트 (health_router, prefix 없음).
#     자가진단 성공(=블록 1개 이상) 200 / 검출 0개·추론 예외·하네스 실패 503.
#     세 실패를 ocr 필드로 구분한다: "no-text" / "fail" / "selftest-error".
#     성공은 30초, 실패는 5초 캐시한다 (실패 폭주 방지 + 복구 반영 지연 최소화).
#     추론이 병렬로 겹치지 않도록 반드시 async 핸들러여야 한다.
#
# [사용된 라이브러리]
# ───────────────────────────────────────────
# uuid.uuid4().hex
#   랜덤 UUID를 생성하고 하이픈 없는 32자리 16진수 문자열로 변환.
#   업로드 파일명 충돌을 방지하기 위해 사용.
# ───────────────────────────────────────────
# storage.save_upload_file(file, image_name)
#   업로드 스트림을 디스크에 저장하고 그 경로를 돌려준다 (내부에서 shutil.copyfileobj 사용).
#   이 파일은 shutil 을 직접 import 하지 않는다 — 실제 복사는 storage.py 가 한다.
# ───────────────────────────────────────────
# fastapi.Form(default)
#   multipart/form-data 의 폼 필드를 선언한다. commit() 이 document_type/raw_blocks/
#   corrected_fields 를 파일과 같은 요청 본문에서 받기 위해 사용.
# ───────────────────────────────────────────
# tempfile.NamedTemporaryFile(suffix, delete=False)
#   자가진단 합성 이미지를 저장할 임시 파일을 만든다. pipeline.run() 이 경로 문자열만
#   받기 때문에 메모리 이미지를 한 번 디스크로 내려야 한다 (finally 에서 반드시 지운다).
# ───────────────────────────────────────────
# pathlib.Path(filename).suffix
#   파일명에서 확장자를 추출한다. (예: ".jpg", ".png")
#   원본 확장자를 유지하면서 파일명만 UUID로 교체하기 위해 사용.
# ───────────────────────────────────────────
# fastapi.APIRouter()
#   FastAPI의 라우터 인스턴스를 생성한다.
#   라우터에 엔드포인트를 정의한 뒤 app.include_router()로 등록.
# ───────────────────────────────────────────
# fastapi.File(...)
#   엔드포인트 매개변수가 파일 업로드임을 선언하는 기본값.
#   ...는 필수 매개변수를 의미 (파일 업로드 생략 불가).
# ───────────────────────────────────────────
# fastapi.UploadFile
#   업로드된 파일의 메타데이터(filename 등)와 파일 스트림(.file)을
#   제공하는 FastAPI의 파일 업로드 타입.
# ───────────────────────────────────────────
# fastapi.responses.JSONResponse(content, status_code)
#   JSON 형식의 HTTP 응답을 생성한다.
#   content에 딕셔너리를 전달하면 자동으로 JSON 직렬화됨.
# ───────────────────────────────────────────
# PIL.Image.new(mode, size, color)
#   메모리 상에 새 이미지를 만든다. 헬스 자가진단용 흰 배경 캔버스 생성에 사용.
# ───────────────────────────────────────────
# PIL.ImageDraw.Draw(img) / draw.text(xy, text, fill, font) / draw.textbbox(...)
#   캔버스에 글자를 그린다. textbbox 로 실제 잉크 영역을 재서 가운데 정렬한다.
#   자가진단 이미지에 **글자가 반드시 있어야** 인식(rec) 단계가 실행된다.
# ───────────────────────────────────────────
# PIL.ImageFont.load_default(size=N) / load_default()
#   Pillow 내장 폰트를 얻는다. 컨테이너에 시스템 TTF 가 없어도 동작하는 유일한 경로다.
#   **size 를 주면 FreeType 이 없을 때 폴백하지 않고 예외를 던진다** — Pillow 는
#   size 가 주어지면 FreeType 유무와 무관하게 truetype() 분기로 가기 때문이다.
#   그래서 _selftest_font() 가 예외를 잡아 인자 없는 load_default() 로 내려가야
#   크기 고정(잉크 약 11px) 비트맵 폰트를 얻는다. 상세 근거는 _selftest_font() 주석 참조.
# ───────────────────────────────────────────
# time.monotonic() / time.perf_counter()
#   monotonic: 시스템 시각 변경에 영향받지 않는 단조 증가 시계. 캐시 만료 판정용.
#   perf_counter: 고해상도 경과 시간 측정. 자가진단 소요 시간(ms) 산출용.
# ───────────────────────────────────────────
#
# ═══════════════════════════════════════════════════════════════

"""OCR router — scan, commit and health endpoints."""
import json
import logging
import os
import tempfile
import time
import uuid
from pathlib import Path

from fastapi import APIRouter, File, Form, UploadFile
from fastapi.responses import JSONResponse
from PIL import Image, ImageDraw, ImageFont

# services.py에서 싱글톤으로 생성된 파이프라인과 파싱 스킬을 가져옴
from services import pipeline, parsing_skill
from storage import is_gcs_enabled, persist_image, save_upload_file

router = APIRouter()

# /health 는 /api prefix 아래가 아니라 루트여야 한다 (앱 진단 화면 계약).
# 그래서 scan/commit 용 router 와 분리된 라우터로 두고 app.py 에서 prefix 없이 등록한다.
health_router = APIRouter()

logger = logging.getLogger(__name__)

# 헬스 응답에 실어 보내는 서비스 식별자.
# app.py 가 FastAPI(title=SERVICE_NAME, version=SERVICE_VERSION) 로 이 상수를 그대로 쓰므로
# 정본은 여기 한 곳이다 — /docs 표기와 /health 응답이 갈라지지 않는다.
SERVICE_NAME = "MORA OCR Service"
SERVICE_VERSION = "3.0"

# ── 자가진단 합성 이미지 ─────────────────────────────────────────────────────
#
# **흰 배경이면 안 된다.** 2차까지의 셀프테스트는 흰 64×64 였고, 그러면 검출(det)이
# 텍스트를 0개 찾는다. 그때 src/pipeline/extract_pipeline.py:125 의 조기 반환이 걸려
# 인식(rec)·classify_all_blocks·ParsingSkill 이 **한 번도 실행되지 않은 채** 성공으로
# 처리됐다. 그래서 rec 가중치 로드에 실패한 인스턴스(모델을 런타임에 받는다 —
# Dockerfile 에 사전 다운로드가 없다)에서 모든 POST /api/scan 이 500 인데
# /health 는 200 "ocr":"ok" 를 내는 **새 거짓 초록불**이 만들어졌다.
# → 글자를 그린 이미지를 쓰고, 성공 조건에 blocks >= 1 을 넣는다.
SELFTEST_TEXT = "MORA OCR"
SELFTEST_WIDTH_PX = 192
SELFTEST_HEIGHT_PX = 64

# 폰트 크기 요청값. FreeType 이 있을 때만 반영되고, 없으면 크기 고정 비트맵 폰트로 폴백한다.
#
# **두 경로 모두 이 캔버스에서 검출·인식되는 것을 재실측했다** (2026-08-05, 192×64 캔버스,
# paddleocr 3.4.0 + PP-OCRv5_mobile_det + korean_PP-OCRv5_mobile_rec, 이 파일의 엔진 설정 그대로):
#   FreeType 32px           → blocks=1, latency 155~163ms
#   비트맵 폴백(courB08)     → blocks=1, "MORA OCR" conf 0.9199, latency 161~236ms
#                             (잉크 실측 48×11px — 캔버스 192×64 한가운데라 여백이 넉넉하다)
# 비트맵 쪽은 ImageFont.core 를 DeferredError 로 바꿔 FreeType 미포함 빌드를 재현한 뒤 쟀다.
# 즉 폴백 폰트로도 blocks >= 1 판정이 성립하므로, 폴백이 걸려도 /health 는 정상 200 이다.
SELFTEST_FONT_PX = 32

# 성공한 자가진단 결과를 재사용하는 시간(초).
# 헬스체크가 남용돼도 추론이 매번 도는 일이 없게 막는다. Cloud Run 인스턴스마다 캐시가
# 따로 노는 것은 무방하다 — 어차피 죽는 것도 인스턴스 단위다.
#
# [셀프테스트가 비싸졌는데 30초가 여전히 타당한가 — 재검토]
# 흰 이미지 시절 60ms 에서, 글자 1블록을 실제로 인식하게 되어 로컬 실측 150~270ms 로 올랐다.
# Cloud Run 1 vCPU 는 이 측정 PC 보다 느리므로 보수적으로 0.5초로 잡는다.
# 그래도 30초 TTL 이면 헬스가 아무리 자주 들어와도 CPU 점유율은 0.5/30 ≈ 1.7% 다.
# 값을 올릴 이유(비용)도, 내릴 이유(신선도)도 없어 그대로 둔다.
# 아래 실패 TTL 5초는 0.5/5 = 10% 로 더 비싸지만, 이 상태는 어차피 인스턴스가 곧
# 교체되는 짧은 구간이고 복구를 빨리 보여주는 값이 더 중요하다.
HEALTH_CACHE_TTL_SEC = 30.0

# 실패한 자가진단 결과를 재사용하는 시간(초). 성공 TTL 과 **일부러 다른 상수**다.
#
# 왜 실패도 캐시하는가: /health 는 무인증이고 매 호출이 추론 1회다. 인스턴스가 메모리
# 압박으로 셀프테스트에 실패하는 상태에서 폴러·진단 화면 연타가 들어오면
# "요청 1건 = 추론 1회" 가 되어 가장 취약한 순간에 압박을 스스로 증폭시킨다.
# Spring 쪽에서 "재시도하면 갓 살아난 인스턴스를 다시 죽인다"는 이유로 재시도를 뺐는데
# 여기만 무제한이면 비대칭이다.
#
# 왜 30초가 아니라 5초인가: 죽었다 살아난 인스턴스가 30초 동안 계속 빨간불로 보이면
# 그것도 거짓 신호다. 5초는 폭주는 막으면서 복구는 거의 즉시 반영되는 절충값이다.
HEALTH_FAIL_CACHE_TTL_SEC = 5.0

# 마지막 자가진단 payload 와 그 시각(monotonic), 그리고 그때의 HTTP 상태 코드.
# 성공/실패를 한 슬롯에 같이 담되 TTL 만 상태별로 다르게 적용한다.
_health_cache: dict | None = None
_health_cache_at: float = 0.0
_health_cache_status: int = 200


def _cleanup(img_path: Path) -> None:
    """업로드 임시본을 지운다.

    Cloud Run 의 쓰기 가능 파일시스템은 실제로는 메모리(tmpfs)다. 지우지 않으면
    업로드가 쌓이는 만큼 인스턴스 메모리가 줄어든다. persist_image() 가 이미
    GCS 로 원본을 올린 뒤이므로 로컬 사본은 남길 이유가 없다.
    단, GCS 미설정(LAN 개발) 모드에서는 이 파일이 곧 /uploads 정적 서빙 대상이라 지우면 안 된다.
    """
    if not is_gcs_enabled():
        return
    try:
        img_path.unlink(missing_ok=True)
    except OSError:
        logger.warning("temp cleanup failed")


@router.post("/scan")
async def scan(file: UploadFile = File(...)):
    """이미지를 받아 OCR + 규칙 기반 파싱 결과를 반환."""

    # 원본 확장자를 유지하면서 UUID 기반 고유 파일명 생성
    suffix = Path(file.filename).suffix
    img_name = f"{uuid.uuid4().hex}{suffix}"
    img_path = save_upload_file(file, img_name)

    try:
        # OCR 파이프라인 실행 → 이미지에서 텍스트 블록 추출
        ocr_result = pipeline.run(str(img_path))
        text_blocks = ocr_result.get("raw_blocks", [])

        # 텍스트 블록을 명함 필드(이름, 회사, 전화 등)로 분류/파싱
        parsed_result = parsing_skill.execute(text_blocks)
        parsed = parsed_result["parsed"]

        # ── 성공 응답: 파싱 결과 + 원본 블록 + 이미지 URL + 문서 종류 3종 키 ──────────
        #
        # 대전제: **이 서비스에는 문서 종류 분류기가 없다.** 명함 전용 파이프라인이다.
        # (src/classifier/rule_based.py 는 명함 *필드* 분류용 정규식이지 문서 종류
        #  분류기가 아니다.) type/confidence/classified 세 키는 그 사실을 왜곡 없이
        # 표현하기 위한 것이지, 판정 결과가 아니다.
        #
        # [type = "BUSINESS_CARD"] 클라이언트 계약상 필수다 — 없으면 앱 unwrapScan
        # (src/features/scan/api.ts) 이 'ETC' 로 떨어뜨리고, ETC 는 저장 화이트리스트에
        # 없어 tier 가 'blocked' 이 되면서 저장 경로가 아예 사라진다.
        # 파이프라인이 명함 전용인 것은 사실이므로 **판정이 아니라 기본값 제시**로 보낸다.
        #
        # [confidence = 0.0] 0 은 "신뢰도가 낮다" 가 아니라 **"측정값이 없다"** 는 뜻이다.
        # 여기에 OCR **인식(rec)** 신뢰도 평균을 넣었던 것이 1차 수정이 만든 회귀였다:
        # 영수증을 찍어도 BUSINESS_CARD + 0.97 이 내려가 확인 절차 없이 명함 폼으로
        # 직행하면서 있지도 않은 "신뢰도 97%" 까지 표시했다. 전형적인 거짓 신호다.
        # **가짜 숫자를 만들지 마라.** 분류를 한 적이 없으므로 0 이 유일하게 정직한 값이다.
        # 인식 신뢰도는 이미 raw_blocks[].confidence 로 블록 단위로 나가고 있으니
        # 별도 키(ocr_confidence 등)로 중복 노출하지 않는다 — 앱이 읽지도 않는 값을
        # 최상위에 두면 다음 사람이 또 분류 신뢰도로 오해한다.
        #
        # [classified = False] **2026-08-05 4차 신설.** 위 두 값만으로는 앱이
        # "분류했는데 신뢰도가 0" 과 "애초에 분류를 안 했다" 를 구별할 수 없었다.
        # 그 간극이 세 라운드 내내 문제를 만들었다:
        #   · 2차에서 confidence 를 0 으로 정정했더니 앱이 그것을 "신뢰도 바닥" 으로 읽어
        #     tier 를 'pick' 으로 떨어뜨렸고, 폼 전체가 잠겨 저장이 불가능해졌다 —
        #     정직해졌지만 막다른 길이었다.
        #   · 3차에서 배너 문구만 "한 번 눌러 확인해 주세요" 로 고친 것도, 그 잠금 때문에
        #     사용자가 실제로 수행할 수 없는 안내였다.
        # 이 플래그의 의미는 **"이 서비스는 문서 종류를 판정하지 않았다"** 이다.
        # 앱은 이것을 분류 미수행 전용 상태로 다뤄 확인 바만 띄우고 폼 편집·저장은
        # 열어둔다 (src/features/scan/types.ts 의 'unclassified' tier).
        # 서버가 분류를 **안 한** 것은 "신뢰도가 낮다" 와 다르다 — 명함 전용 파이프라인이
        # 명함 필드를 뽑아냈으니 BUSINESS_CARD 를 기본값으로 제시하고 사용자가 바꿀 수
        # 있게 하는 것이 정직하면서 막다른 길도 아닌 유일한 조합이다.
        #
        # **하위호환**: 이 키가 없는 구버전 응답을 앱은 classified=true 로 읽어 종전
        # 동작을 유지한다 (src/features/scan/api.ts unwrapScan). 그러므로 실제 분류기를
        # 붙이는 날에는 여기를 True 로 바꾸고 confidence 에 진짜 측정값을 넣으면 되며,
        # 앱 코드는 손대지 않아도 된다.
        #
        # 앱 쪽은 파일명·심볼명만 적고 줄번호는 적지 않는다 — 줄번호는 앱이 한 번 바뀔
        # 때마다 거짓이 되고, 이 주석이 계속 틀린 곳을 가리켜 온 것이 지난 라운드들의
        # 실패였다.
        return JSONResponse(content={
            "success": True,
            "data": {
                "type": "BUSINESS_CARD",
                "confidence": 0.0,
                "classified": False,
                "parsed": parsed,
                "raw_blocks": text_blocks,
                "image_url": persist_image(img_path, img_name, file.content_type),
            }
        })
    except Exception as exc:
        # Exception text can contain OCR text, filenames, or provider details.
        logger.error("OCR scan failed (type=%s)", type(exc).__name__)
        return JSONResponse(
            status_code=500,
            content={"success": False, "error": "OCR processing failed"},
        )
    finally:
        _cleanup(img_path)


@router.post("/commit")
async def commit(
    file: UploadFile = File(...),
    document_type: str = Form("ETC"),
    raw_blocks: str = Form("[]"),
    corrected_fields: str = Form("{}"),
):
    """Persist an original image after the user confirms extracted fields."""
    suffix = Path(file.filename).suffix
    safe_type = document_type if document_type in {"BUSINESS_CARD", "POSTER", "TICKET", "RECEIPT"} else "ETC"
    img_name = f"{safe_type.lower()}_{uuid.uuid4().hex}{suffix}"
    img_path = save_upload_file(file, img_name)

    try:
        blocks = json.loads(raw_blocks)
        fields = json.loads(corrected_fields)
        count = len(blocks) if isinstance(blocks, list) else 0

        return JSONResponse(content={
            "success": True,
            "data": {
                "image_url": persist_image(img_path, img_name, file.content_type),
                "count": count + (len(fields) if isinstance(fields, dict) else 0),
            }
        })
    except Exception as exc:
        logger.error("OCR commit failed (type=%s)", type(exc).__name__)
        return JSONResponse(
            status_code=500,
            content={"success": False, "error": "OCR commit failed"},
        )
    finally:
        _cleanup(img_path)


class SelftestHarnessError(RuntimeError):
    """셀프테스트용 합성 이미지를 **만들지 못했다** (폰트/캔버스 단계 실패).

    추론이 죽은 것과는 다른 사건이다. 이 예외가 나면 pipeline.run() 은 호출조차 되지
    않았으므로 "추론이 살아있다/죽었다" 중 어느 쪽도 증명되지 않은 상태다.
    health() 가 이것을 일반 추론 실패와 구분해서 보고하도록 전용 타입으로 둔다.
    """


def _selftest_font():
    """자가진단용 폰트를 얻는다 (Pillow 내장 TTF → 비트맵 폴백).

    컨테이너(python:3.11-slim)에는 시스템 TTF 가 없다 —
    Dockerfile 이 fonts-* 패키지를 설치하지 않으므로 ImageFont.truetype("...ttf") 는
    파일 부재로 실패한다. 그래서 시스템 폰트는 아예 찾지 않고 Pillow 내장만 쓴다.

    [폴백 예외 종류를 실측으로 정정했다 — 2026-08-05]
    직전까지 이 자리는 `except TypeError` 하나였고, 주석은 "FreeType 미포함 빌드는
    TypeError 를 내므로 잡아서 비트맵으로 폴백한다" 고 적었다.
    **그 경로는 TypeError 를 내지 않는다.** 로컬 Pillow 12.1.1 소스를 직접 읽고
    재현해서 확인한 사실:
      · ImageFont.py:1089 `if isinstance(core, ModuleType) or size is not None:`
        → size 를 주면 FreeType 유무와 **무관하게** truetype(...) 분기로 간다.
        즉 "size 는 FreeType 이 있을 때만 받는다" 는 종전 서술 자체가 틀렸다.
      · ImageFont.py:231-232 FreeTypeFont.__init__ 첫 줄
        `if isinstance(core, DeferredError): raise core.ex`
        → FreeType 이 없으면 _imagingft 의 import 실패 예외, 즉 **ImportError** 가 난다.
      · truetype() 은 OSError 만 잡고(ImageFont.py:860-864), 그마저도 인자가 BytesIO 라
        is_path() 가 False 여서 폰트 디렉토리 재탐색 없이 그대로 다시 올라온다.
      · TypeError 는 load_default() 가 인자를 받지 않던 **Pillow < 10.1** 에서만 난다.
    재현(ImageFont.core 를 DeferredError 로 바꿔 FreeType 미포함 빌드를 흉내):
        load_default(size=32) → ImportError: No module named 'PIL._imagingft'
        load_default()        → OK, ImageFont(비트맵 courB08)

    → 그래서 종전 코드는 FreeType 미포함 이미지에서 폴백에 **실패**하고 ImportError 를
    그대로 올려보냈고, health() 가 그것을 503 "ocr":"fail" 로 칠했다.
    POST /api/scan 은 멀쩡한데(추론 경로는 Pillow 폰트를 전혀 쓰지 않는다) 서버를
    죽었다고 신고하는 거짓 신호였고, deploy-ocr.ps1 의 livenessProbe YAML 을 적용하면
    정상 인스턴스가 주기적으로 재시작됐을 것이다. 세 예외를 모두 잡아 실제로 폴백한다.

    **폴백 경로에서도 검출/인식이 되는 것을 재실측으로 확인했다** (상수 정의부 참조).
    """
    try:
        return ImageFont.load_default(size=SELFTEST_FONT_PX)
    except (ImportError, OSError, TypeError):
        # ImportError : FreeType(_imagingft) 미포함 Pillow 빌드 — 실제로 나는 예외
        # OSError     : truetype() 이 "파일을 읽지 못함" 으로 정의상 올리는 예외
        # TypeError   : Pillow < 10.1 (load_default 가 size 인자를 받지 않던 시절)
        return ImageFont.load_default()


def _ocr_selftest() -> dict:
    """글자가 그려진 합성 이미지를 실제 파이프라인에 태워 추론 경로가 살아있는지 확인한다.

    [왜 pipeline.run() 을 그대로 쓰는가 — 엔진 직접 호출로 우회하지 않은 이유]
    extract_pipeline.py:125 의 "텍스트 0개면 조기 반환" 분기는 **글자가 있는 이미지에서는
    애초에 걸리지 않는다.** 우회할 필요가 없으므로 우회하지 않았다.
    pipeline.run() 을 쓰면 det → rec → classify_all_blocks 까지 scan() 과 같은 코드를 타고,
    아래에서 parsing_skill.execute() 까지 한 번 더 태워 **scan() 의 호출 체인 전체**를 덮는다.
    엔진(pipeline.ocr_engine.extract)만 직접 부르면 분류/파싱 쪽 고장을 놓친다.

    [판정 기준]
    "예외 없이 끝났는가" 만으로는 부족하다 — 그것이 이번에 발견된 거짓 초록불의 원인이었다.
    **blocks >= 1** 을 함께 본다. 검출이 0개면 rec 가중치 로드 실패 등으로 인식 경로가
    죽었을 가능성이 높으므로 degraded 로 본다 (판정은 호출부 health() 에서 한다).

    [하네스 실패를 추론 실패와 분리한다]
    합성 이미지를 **만드는** 단계(폰트/캔버스/저장)가 깨지는 것은 추론이 죽은 것과
    전혀 다른 사건이다. 그 구간만 SelftestHarnessError 로 감싸서 health() 가 다르게
    보고하게 한다 — 이번에 발견된 폰트 폴백 버그가 정확히 이 혼동이었다
    (멀쩡한 추론 + 깨진 하네스 → "ocr":"fail", 즉 멀쩡한 서버를 죽었다고 신고).

    pipeline.run() 은 경로 문자열을 받으므로 임시 파일이 필요하다.
    Cloud Run 의 쓰기 가능 파일시스템은 실제로는 메모리(tmpfs)라
    남겨두면 헬스체크가 도는 만큼 인스턴스 메모리를 갉아먹는다 → finally 로 반드시 지운다.
    """
    tmp = tempfile.NamedTemporaryFile(suffix=".png", delete=False)
    tmp_path = tmp.name
    tmp.close()

    try:
        # ── 하네스 구간: 여기서 나는 예외는 "추론 실패" 가 아니다 ──────────────────
        try:
            # 흰 배경 + 검은 글자. 명함 스캔과 같은 극성(밝은 배경/어두운 글자)이라
            # det 가 실제 트래픽과 같은 조건에서 동작한다.
            canvas = Image.new("RGB", (SELFTEST_WIDTH_PX, SELFTEST_HEIGHT_PX), "white")
            draw = ImageDraw.Draw(canvas)
            font = _selftest_font()

            # textbbox 로 실제 잉크 영역을 재서 가운데 정렬한다. 폰트가 폴백으로
            # 달라져도(FreeType 32px vs 비트맵 잉크 48×11) 글자가 캔버스 밖으로 나가거나
            # 가장자리에 붙지 않는다 — 가장자리에 붙으면 det 가 잘라내 blocks=0 이 될 수 있다.
            box = draw.textbbox((0, 0), SELFTEST_TEXT, font=font)
            text_w, text_h = box[2] - box[0], box[3] - box[1]
            origin = (
                (SELFTEST_WIDTH_PX - text_w) / 2 - box[0],
                (SELFTEST_HEIGHT_PX - text_h) / 2 - box[1],
            )
            draw.text(origin, SELFTEST_TEXT, fill="black", font=font)
            canvas.save(tmp_path)
        except Exception as exc:
            # 폰트 폴백까지 실패했다는 것은 사실상 Pillow 자체가 깨졌다는 뜻이다.
            # 원문을 담지 않고 타입만 감싸 올린다 — /health 는 무인증이라 응답에 새면 안 된다.
            raise SelftestHarnessError(type(exc).__name__) from exc
        # ── 여기부터가 실제 추론 경로 ────────────────────────────────────────────

        started = time.perf_counter()
        result = pipeline.run(tmp_path)
        blocks = result.get("raw_blocks", [])
        # scan() 이 실제로 부르는 마지막 단계까지 덮는다. 순수 파이썬이라 비용은 무시할 만하다.
        parsing_skill.execute(blocks)
        latency_ms = int((time.perf_counter() - started) * 1000)

        return {"latency_ms": latency_ms, "blocks": len(blocks)}
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            logger.warning("health selftest temp cleanup failed")


@health_router.get("/health")
async def health():
    """추론까지 실제로 돌려보는 헬스 엔드포인트 (인증 없음).

    기존 GET / 는 dict 하나를 되돌려줄 뿐이라 **추론이 100% 죽은 상태에서도 200** 이었다.
    이번 OOM 장애 내내 앱 진단 화면이 "정상" 이었던 이유가 이것이다.
    그래서 여기서는 매번 파이프라인을 한 번 태워보고, 그 결과로만 상태를 판정한다.

    - 성공(blocks >= 1): 200 {"status":"ok", ..., "ocr":"ok", "latency_ms":N, "blocks":N}
    - 검출 0개:          503 {"status":"degraded", ..., "ocr":"no-text", "latency_ms":N, "blocks":0}
    - 추론 예외:         503 {"status":"degraded", ..., "ocr":"fail", "error":"OCR selftest failed"}
    - 하네스 실패:       503 {"status":"degraded", ..., "ocr":"selftest-error", ...}

    **"fail" 과 "selftest-error" 를 나눈 이유.** 앞의 셋은 추론 경로를 실제로 태운 결과지만,
    마지막 것은 합성 이미지를 만들지 못해 **추론을 시도조차 못 한** 경우다. 둘을 한 값으로
    합치면 운영자가 정반대 방향을 파게 된다 — 이번에 발견된 폰트 폴백 버그가 바로 그
    사례로, 추론은 멀쩡한데 "ocr":"fail" 이 떠서 모델/메모리를 의심하게 만들었다.
    "selftest-error" 는 "모델이 아니라 이미지 생성 코드를 봐라" 는 신호다.

    [하네스 실패에 굳이 503 을 내는 이유 — 200 이 더 안전해 보이지만 아니다]
    이 상태에서 우리는 추론이 살아있다는 **증거가 없다**. 200 을 내면 그것은 확인하지 않은
    사실을 확인했다고 말하는 것이고, 이 라운드가 없애려는 거짓 초록불 그 자체다.
    503 은 livenessProbe 재시작을 유발하고 재시작으로 폰트가 고쳐지지도 않지만,
    그 대가는 "고장을 시끄럽게 만드는 것" 이고 ocr 값이 원인을 정확히 가리킨다.
    폴백 예외를 넓힌 지금 이 분기에 닿으려면 Pillow 자체가 깨져야 하므로,
    그것은 실제로 배포를 멈춰야 하는 사건이 맞다.

    **blocks >= 1 을 성공 조건에 넣는 것이 이 함수의 핵심이다.** 셀프테스트 이미지에는
    글자가 그려져 있으므로(SELFTEST_TEXT) 검출 0개는 정상이 아니다. 0개면 인식(rec)이
    아예 실행되지 않았다는 뜻이고, 그 상태로 200 을 내면 rec 가중치가 죽은 인스턴스가
    계속 트래픽을 받는다 — 정확히 이번에 발견된 새 거짓 초록불이다.

    **`async def` 여야 한다 (sync `def` 로 되돌리지 마라).** FastAPI 는 sync 핸들러를
    워커 스레드풀로 보낸다. 그러면 이 핸들러가 scan()/commit() 과 동시에 돌 수 있고,
    싱글톤 `pipeline` 의 predict() 가 병렬 호출되어 요청당 peak 메모리가 겹친다.
    deploy-ocr.ps1 의 2Gi 는 단일 요청 peak 약 1.0GB 를 기준으로 잡은 값이라 그 겹침을
    감당할 여유가 없다. scan()/commit() 이 async 라 이벤트 루프에서 직렬 실행되는
    구조를 여기서도 똑같이 유지한다 — 셀프테스트는 192x64 1블록이라 루프를 오래 막지 않는다
    (로컬 실측 150~270ms).

    실패 응답에는 예외 원문·경로를 절대 넣지 않는다. 헬스는 무인증이라
    그대로 유출 경로가 된다 — 3efa5b7 에서 한 번 제거한 실수를 되풀이하지 않는다.
    로그에도 type(exc).__name__ 만 남긴다.
    """
    global _health_cache, _health_cache_at, _health_cache_status

    # TTL 안이면 추론을 다시 돌리지 않고 캐시된 값을 즉시 반환한다.
    # 성공/실패에 서로 다른 TTL 을 적용한다 (상수 정의부의 근거 참조).
    # cached 플래그를 붙여서 "방금 측정한 값" 과 구별되게 한다 — 이것도 거짓 신호 방지다.
    now = time.monotonic()
    if _health_cache is not None:
        ttl = HEALTH_CACHE_TTL_SEC if _health_cache_status == 200 else HEALTH_FAIL_CACHE_TTL_SEC
        if now - _health_cache_at < ttl:
            return JSONResponse(
                status_code=_health_cache_status,
                content={**_health_cache, "cached": True},
            )

    try:
        probe = _ocr_selftest()
    except SelftestHarnessError as exc:
        # 합성 이미지를 만들지 못했다 — 추론은 호출되지도 않았다.
        # exc.args[0] 은 원인 예외의 **클래스명뿐**이라 로그에 남겨도 유출이 아니다.
        # 반드시 아래 일반 except 보다 위에 와야 한다 (SelftestHarnessError 도 Exception 이다).
        logger.error("OCR selftest harness failed (cause=%s)", exc)
        payload = {
            "status": "degraded",
            "service": SERVICE_NAME,
            "version": SERVICE_VERSION,
            "ocr": "selftest-error",
            "error": "OCR selftest image could not be built",
        }
        _health_cache = payload
        _health_cache_at = now
        _health_cache_status = 503
        return JSONResponse(status_code=503, content=payload)
    except Exception as exc:
        logger.error("OCR selftest failed (type=%s)", type(exc).__name__)
        payload = {
            "status": "degraded",
            "service": SERVICE_NAME,
            "version": SERVICE_VERSION,
            "ocr": "fail",
            "error": "OCR selftest failed",
        }
        # 실패도 캐시한다 — 가장 취약한 순간에 추론이 무제한으로 도는 것을 막는다.
        _health_cache = payload
        _health_cache_at = now
        _health_cache_status = 503
        return JSONResponse(status_code=503, content=payload)

    # 예외는 없었지만 글자를 하나도 못 찾은 경우 — 인식(rec) 경로가 실행되지 않았다.
    # latency_ms/blocks 는 우리가 직접 잰 값이라 내부 정보 유출이 아니다. 오히려 이 둘이
    # 있어야 운영자가 "크래시" 와 "검출 실패" 를 구분할 수 있다.
    if probe["blocks"] < 1:
        logger.error("OCR selftest detected no text (latency_ms=%d)", probe["latency_ms"])
        payload = {
            "status": "degraded",
            "service": SERVICE_NAME,
            "version": SERVICE_VERSION,
            "ocr": "no-text",
            "error": "OCR selftest found no text",
            "latency_ms": probe["latency_ms"],
            "blocks": 0,
        }
        _health_cache = payload
        _health_cache_at = now
        _health_cache_status = 503
        return JSONResponse(status_code=503, content=payload)

    payload = {
        "status": "ok",
        "service": SERVICE_NAME,
        "version": SERVICE_VERSION,
        "ocr": "ok",
        "latency_ms": probe["latency_ms"],
        "blocks": probe["blocks"],
    }
    _health_cache = payload
    _health_cache_at = now
    _health_cache_status = 200
    return JSONResponse(content=payload)
