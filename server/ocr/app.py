# ═══════════════════════════════════════════════════════════════
# app.py — FastAPI 애플리케이션 진입점 (메인 서버 설정)
# ═══════════════════════════════════════════════════════════════
#
# [역할]
# MORA OCR 서비스의 메인 진입 파일.
# FastAPI 앱 인스턴스를 생성하고, CORS 미들웨어 설정,
# OCR 라우터 등록, 정적 파일(업로드 이미지) 서빙을 구성한다.
#
# [코드 흐름]
# 1) .env 파일에서 환경변수를 로드한다 (dotenv)
# 2) PaddlePaddle의 OneDNN 관련 버그를 우회하기 위해 환경변수를 설정한다
# 3) FastAPI 앱 인스턴스를 생성한다
# 4) CORS 미들웨어를 추가하여 프론트엔드에서의 교차 출처 요청을 허용한다
# 5) OCR 라우터를 /api 경로에 등록한다
# 6) 헬스 라우터를 prefix 없이 등록한다 (최종 경로가 /health 여야 한다)
# 7) /uploads/{image_name} 을 GET/DELETE 라우트로 정의한다 (storage 가 GCS 또는 로컬을 고른다)
# 8) 루트 경로(/)에 서비스 정보를 반환하는 엔드포인트를 정의한다
# 9) 직접 실행 시 uvicorn으로 서버를 기동한다
#
# [메서드 목록]
# - root(): GET / 엔드포인트. 서비스명, 버전, docs URL을 JSON으로 반환.
#     **살아있음의 증거가 아니다** — 추론이 죽어도 200을 낸다. 하위호환용으로만 남긴다.
# - uploaded_image(name) / delete_uploaded_image(name):
#     GET/DELETE /uploads/{image_name}. 운영에서는 GCS, 로컬 개발에서는 디스크를 읽는다.
# - (routers/ocr.py) health(): GET /health 엔드포인트.
#     **192x64** 합성 이미지에 글자(SELFTEST_TEXT = "MORA OCR")를 그려 실제 파이프라인에
#     태워보고 200(ok)/503(degraded)을 낸다. 성공 조건은 "예외 없음" 이 아니라
#     **blocks >= 1** 이다 — 글자 없는 흰 이미지는 det 가 0개를 찾고 rec 가 실행되지
#     않은 채 성공 처리되어 거짓 초록불이 된다(그것이 예전 64x64 흰 이미지의 결함이었다).
#     앱 진단 화면은 이 엔드포인트를 봐야 하며, / 를 보면 거짓 초록불이 뜬다.
#
# [사용된 라이브러리]
# ───────────────────────────────────────────
# os.environ[key] = value
#   운영체제 환경변수를 설정한다.
#   PaddlePaddle이 내부적으로 읽는 플래그를 미리 꺼서 버그를 우회함.
# ───────────────────────────────────────────
# sys.path.insert(0, path)
#   Python 모듈 검색 경로 리스트의 맨 앞에 경로를 추가한다.
#   backend 디렉토리를 추가해서 routers 패키지를 import 가능하게 함.
# ───────────────────────────────────────────
# pathlib.Path(__file__).resolve().parent
#   현재 파일의 절대 경로를 구한 뒤 부모 디렉토리를 반환한다.
#   프로젝트 내 상대 경로 계산에 사용.
# ───────────────────────────────────────────
# dotenv.load_dotenv(path)
#   지정된 .env 파일을 읽어 환경변수(os.environ)에 자동 로드한다.
#   API 키, 설정값 등을 코드 밖에서 관리할 수 있게 해준다.
# ───────────────────────────────────────────
# FastAPI(title, version)
#   FastAPI 애플리케이션 인스턴스를 생성한다.
#   title/version은 자동 생성되는 /docs Swagger UI에 표시됨.
# ───────────────────────────────────────────
# app.add_middleware(CORSMiddleware, ...)
#   CORS(Cross-Origin Resource Sharing) 미들웨어를 추가한다.
#   allow_origins=["*"]로 모든 출처의 요청을 허용함.
#   프론트엔드(React 등)에서 API를 호출할 수 있게 해준다.
# ───────────────────────────────────────────
# app.include_router(router, prefix, tags)
#   라우터 모듈에 정의된 엔드포인트들을 앱에 등록한다.
#   prefix="/api"이면 라우터의 /scan이 /api/scan이 된다.
#   prefix를 생략하면 라우터에 적힌 경로가 그대로 최종 경로가 된다 (/health).
# ───────────────────────────────────────────
# storage.get_upload_response(image_name) / storage.delete_image(image_name)
#   업로드 원본을 읽어 응답으로 돌려주거나 삭제한다.
#   운영(GCS 설정됨)에서는 버킷을, 로컬 개발에서는 디스크를 대상으로 한다.
#   **StaticFiles 마운트를 쓰지 않는다** — 원본이 인스턴스 디스크가 아니라 GCS 에 있고,
#   Cloud Run 의 쓰기 가능 파일시스템은 tmpfs(=메모리)라 정적 서빙 대상이 될 수 없다.
#   (예전 주석은 app.mount(StaticFiles) 를 쓴다고 적었지만 그런 코드는 이 파일에 없다.)
# ───────────────────────────────────────────
# uvicorn.run(app, host, port)
#   ASGI 서버인 uvicorn으로 FastAPI 앱을 실행한다.
#   host="0.0.0.0"은 외부 접속 허용, port=8000은 서비스 포트.
# ───────────────────────────────────────────
#
# ═══════════════════════════════════════════════════════════════

"""OCR Microservice — PaddleOCR + rule-based **field** parsing.

주의: "classification" 은 명함 *필드*(이름/회사/전화…) 분류를 말한다.
**문서 종류 분류기는 이 서비스에 없다** — 파이프라인은 명함 전용이고, 그래서
/api/scan 은 `"classified": false` 를 함께 내려보낸다 (routers/ocr.py 의 scan() 주석 참조).
"""
import os
import sys
from pathlib import Path

# .env 파일 자동 로드
from dotenv import load_dotenv
load_dotenv(Path(__file__).resolve().parent.parent / ".env")

# PaddlePaddle OneDNN 버그 우회
os.environ["FLAGS_use_mkldnn"] = "0"
os.environ["FLAGS_enable_pir_api"] = "0"
os.environ["FLAGS_enable_pir_in_executor"] = "0"
os.environ["PADDLE_PDX_ENABLE_MKLDNN_BYDEFAULT"] = "0"
os.environ["PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK"] = "True"

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# ── Path Setup ──
# backend 디렉토리를 sys.path에 추가하여 routers 패키지를 import 가능하게 함
BACKEND_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(BACKEND_DIR))

from routers import ocr  # noqa: E402
from storage import get_upload_response, delete_image  # noqa: E402

# ── App Setup ──
# FastAPI 인스턴스 생성 (Swagger UI에서 title/version 표시됨).
# title/version 은 routers/ocr.py 의 상수를 그대로 쓴다 — /health 응답이 같은 값을
# 실어 보내야 하는데 문자열을 양쪽에 따로 적어두면 언젠가 갈라진다.
app = FastAPI(title=ocr.SERVICE_NAME, version=ocr.SERVICE_VERSION)

# 모든 출처에서의 교차 출처 요청을 허용하는 CORS 미들웨어
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],          # 모든 출처 허용
    allow_credentials=True,       # 쿠키/인증 헤더 허용
    allow_methods=["*"],          # 모든 HTTP 메서드 허용
    allow_headers=["*"],          # 모든 요청 헤더 허용
)

# ── Router ──
# OCR 관련 엔드포인트를 /api 경로 아래에 등록
app.include_router(ocr.router, prefix="/api", tags=["OCR"])

# 헬스 엔드포인트는 prefix 없이 등록해 최종 경로를 /health 로 맞춘다.
# 앱 진단 화면·Cloud Run 헬스체크가 보는 경로가 이것이다 (예전에는 404였다).
app.include_router(ocr.health_router, tags=["Health"])

@app.get("/uploads/{image_name}")
def uploaded_image(image_name: str):
    """Serve uploaded originals from GCS in production or disk in local dev."""
    return get_upload_response(image_name)


@app.delete("/uploads/{image_name}")
def delete_uploaded_image(image_name: str):
    # Spring 계정 삭제 로직이 명함 이미지를 지울 때 호출한다
    delete_image(image_name)
    return {"deleted": image_name}


@app.get("/")
def root():
    """서비스 식별용 루트 엔드포인트 (하위호환).

    이 응답은 프로세스가 떠 있다는 사실만 말해준다. 추론이 죽어 있어도 200이므로
    **상태 판정에 쓰면 안 된다** — 실제 살아있음은 GET /health 로 확인한다.
    """
    return {"service": ocr.SERVICE_NAME, "version": ocr.SERVICE_VERSION, "docs": "/docs"}


if __name__ == "__main__":
    # 직접 실행 시 uvicorn ASGI 서버로 기동 (개발 모드)
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
