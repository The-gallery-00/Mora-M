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
# 6) /uploads 경로에 정적 파일 서빙을 마운트한다
# 7) 루트 경로(/)에 서비스 정보를 반환하는 엔드포인트를 정의한다
# 8) 직접 실행 시 uvicorn으로 서버를 기동한다
#
# [메서드 목록]
# - root(): GET / 엔드포인트. 서비스명, 버전, docs URL을 JSON으로 반환
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
# ───────────────────────────────────────────
# app.mount(path, StaticFiles(directory), name)
#   지정 디렉토리의 파일을 특정 URL 경로에서 정적으로 서빙한다.
#   업로드된 이미지를 /uploads/파일명 으로 접근 가능하게 함.
# ───────────────────────────────────────────
# uvicorn.run(app, host, port)
#   ASGI 서버인 uvicorn으로 FastAPI 앱을 실행한다.
#   host="0.0.0.0"은 외부 접속 허용, port=8000은 서비스 포트.
# ───────────────────────────────────────────
#
# ═══════════════════════════════════════════════════════════════

"""
OCR Microservice — PaddleOCR + rule-based classification.
"""
import os
import sys
from pathlib import Path

# .env 파일 자동 로드
from dotenv import load_dotenv
load_dotenv(Path(__file__).resolve().parent.parent / ".env")

# PaddlePaddle OneDNN 버그 우회
os.environ["FLAGS_use_mkldnn"] = "0"
os.environ["PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK"] = "True"

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

# ── Path Setup ──
# backend 디렉토리를 sys.path에 추가하여 routers 패키지를 import 가능하게 함
BACKEND_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(BACKEND_DIR))

from routers import ocr  # noqa: E402

# ── App Setup ──
# FastAPI 인스턴스 생성 (Swagger UI에서 title/version 표시됨)
app = FastAPI(title="MORA OCR Service", version="3.0")

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

# ── 이미지 파일 서빙 ──
# 업로드된 이미지를 /uploads/파일명 URL로 접근 가능하게 정적 서빙
UPLOAD_DIR = BACKEND_DIR.parent / "uploads"
UPLOAD_DIR.mkdir(exist_ok=True)  # 디렉토리가 없으면 생성
app.mount("/uploads", StaticFiles(directory=str(UPLOAD_DIR)), name="uploads")


@app.get("/")
def root():
    """서비스 상태 확인용 루트 엔드포인트."""
    return {"service": "MORA OCR Service", "version": "3.0", "docs": "/docs"}


if __name__ == "__main__":
    # 직접 실행 시 uvicorn ASGI 서버로 기동 (개발 모드)
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
