# ═══════════════════════════════════════════════════════════════
# routers/ocr.py — OCR 스캔 API 라우터
# ═══════════════════════════════════════════════════════════════
#
# [역할]
# 클라이언트가 업로드한 이미지를 받아 OCR을 수행하고,
# 규칙 기반 파싱으로 명함 필드(이름, 회사, 전화번호 등)를
# 분류한 결과를 JSON으로 반환하는 API 엔드포인트를 정의한다.
#
# [코드 흐름]
# 1) 클라이언트가 POST /api/scan 으로 이미지 파일을 업로드한다
# 2) 파일명을 UUID로 변환하여 uploads 디렉토리에 저장한다
# 3) pipeline.run()으로 OCR을 수행하여 텍스트 블록을 추출한다
# 4) parsing_skill.execute()로 텍스트 블록을 명함 필드로 분류한다
# 5) 파싱 결과, 원본 블록, 이미지 URL을 JSON으로 반환한다
# 6) 에러 발생 시 500 상태 코드와 에러 메시지를 반환한다
#
# [메서드 목록]
# - scan(file): POST /scan 엔드포인트.
#     업로드된 이미지를 저장 → OCR → 파싱 → 결과 반환
#
# [사용된 라이브러리]
# ───────────────────────────────────────────
# uuid.uuid4().hex
#   랜덤 UUID를 생성하고 하이픈 없는 32자리 16진수 문자열로 변환.
#   업로드 파일명 충돌을 방지하기 위해 사용.
# ───────────────────────────────────────────
# shutil.copyfileobj(src, dst)
#   파일 객체에서 다른 파일 객체로 내용을 복사한다.
#   업로드된 파일 스트림을 디스크의 파일로 저장할 때 사용.
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
#
# ═══════════════════════════════════════════════════════════════

"""OCR router — POST /scan only."""
import uuid
import shutil
from pathlib import Path

from fastapi import APIRouter, File, UploadFile
from fastapi.responses import JSONResponse

# services.py에서 싱글톤으로 생성된 파이프라인과 파싱 스킬을 가져옴
from services import pipeline, parsing_skill

router = APIRouter()

# 업로드 디렉토리 경로 설정 (프로젝트 루트/uploads)
UPLOAD_DIR = Path(__file__).resolve().parent.parent.parent / "uploads"
UPLOAD_DIR.mkdir(exist_ok=True)  # 디렉토리가 없으면 생성


@router.post("/scan")
async def scan(file: UploadFile = File(...)):
    """이미지를 받아 OCR + 규칙 기반 파싱 결과를 반환."""

    # 원본 확장자를 유지하면서 UUID 기반 고유 파일명 생성
    suffix = Path(file.filename).suffix
    img_name = f"{uuid.uuid4().hex}{suffix}"
    img_path = UPLOAD_DIR / img_name

    # 업로드된 파일 스트림을 디스크에 저장
    with open(img_path, "wb") as f:
        shutil.copyfileobj(file.file, f)

    try:
        # OCR 파이프라인 실행 → 이미지에서 텍스트 블록 추출
        ocr_result = pipeline.run(str(img_path))
        text_blocks = ocr_result.get("raw_blocks", [])

        # 텍스트 블록을 명함 필드(이름, 회사, 전화 등)로 분류/파싱
        parsed_result = parsing_skill.execute(text_blocks)
        parsed = parsed_result["parsed"]

        # 성공 응답: 파싱 결과 + 원본 블록 + 이미지 URL
        return JSONResponse(content={
            "success": True,
            "data": {
                "parsed": parsed,
                "raw_blocks": text_blocks,
                "image_url": f"/uploads/{img_name}",
            }
        })
    except Exception as e:
        # 에러 발생 시 500 응답
        return JSONResponse(status_code=500, content={"success": False, "error": str(e)})
