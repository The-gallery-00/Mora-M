"""전체 데이터셋(86장) OCR+파싱 벤치 + 자동 결함 검출.

정답 라벨이 없으므로 "맞았는가" 는 못 잰다. 대신 **코드가 스스로 지킨다고 약속한
계약**을 어겼는지를 잰다 — 그건 라벨 없이도 판정 가능하고, 실제로 앱을 망가뜨리는
것이 대부분 이쪽이다.

  · date 필드가 ISO(YYYY-MM-DD)가 아니다        → 앱 zod 검증 실패 → 저장 차단
  · 전화 필드가 전화번호 모양이 아니다           → 다시 걸 수 없는 값
  · 이메일 필드에 @ 가 없다
  · 값에 라벨/각주가 그대로 남았다               ("Tel", "※...", "주최:")
  · 값이 비정상적으로 길다                       (_JOIN_FIELDS 과다 병합)
  · 필드 0개                                     (사용자 눈에 '인식 실패')

앱 업로드 조건(장변 1280, JPEG q85)을 재현해 넣는다.
"""
import json
import os
import re
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from PIL import Image

# 데이터셋 경로. 인자 또는 OCR_BENCH_DATASET 환경변수로 준다.
#   py bench_dataset.py <데이터셋경로>
# 폴더 구조는 아래 FOLDER_TYPE 의 키와 같아야 한다(namecard/poster/recipt/…).
HERE = os.path.dirname(os.path.abspath(__file__))
DATASET = (
    sys.argv[1] if len(sys.argv) > 1
    else os.environ.get("OCR_BENCH_DATASET", "")
)
WORK = os.path.join(HERE, "work_full")
os.makedirs(WORK, exist_ok=True)

FOLDER_TYPE = {
    "namecard": "BUSINESS_CARD",
    "poster": "POSTER",
    "recipt": "RECEIPT",
    "ticket_analog": "TICKET",
    "ticket_digital": "TICKET",
}

MAX_SIDE = 1280
QUALITY = 85

DATE_FIELDS = {"event_start_date", "event_end_date", "purchase_date",
               "departure_date", "arrival_date"}
TIME_FIELDS = {"departure_time", "arrival_time", "purchase_time"}
PHONE_FIELDS = {"mobile_phone", "office_phone", "fax", "contact_phone"}
EMAIL_FIELDS = {"email", "contact_email"}

ISO_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
ISO_TIME = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")
PHONE_OK = re.compile(r"^\+?[\d][\d\-.\s()]{6,}\d$")
LABEL_LEAK = re.compile(
    r"^\s*(?:tel|fax|mobile|phone|e-?mail|mail|web|주소|전화|팩스|이메일|"
    r"주최|주관|장소|일시|기간|문의)\s*[:.]", re.IGNORECASE)
FOOTNOTE = re.compile(r"^\s*[※*]")
MAX_LEN = {"title": 80, "company_name": 60, "job_title": 40, "address": 120,
           "location": 80, "organizer_name": 60, "store_name": 60, "name": 20}


def prepare(src: str, dst: str):
    with Image.open(src) as im:
        im = im.convert("RGB")
        w, h = im.size
        if max(w, h) > MAX_SIDE:
            r = MAX_SIDE / max(w, h)
            im = im.resize((int(w * r), int(h * r)), Image.LANCZOS)
        im.save(dst, "JPEG", quality=QUALITY)
        return (w, h), im.size


def audit(parsed: dict) -> list:
    """계약 위반만 모은다. 정답을 모르므로 '틀렸다' 는 판정하지 않는다."""
    issues = []
    for f, v in parsed.items():
        v = (v or "").strip()
        if not v:
            issues.append(("empty_value", f, v))
            continue
        if f in DATE_FIELDS and not ISO_DATE.match(v):
            issues.append(("date_not_iso", f, v))
        if f in TIME_FIELDS and not ISO_TIME.match(v):
            issues.append(("time_not_iso", f, v))
        if f in PHONE_FIELDS and not PHONE_OK.match(v):
            issues.append(("phone_malformed", f, v))
        if f in EMAIL_FIELDS and "@" not in v:
            issues.append(("email_no_at", f, v))
        if LABEL_LEAK.match(v):
            issues.append(("label_leak", f, v))
        if FOOTNOTE.match(v):
            issues.append(("footnote_as_value", f, v))
        cap = MAX_LEN.get(f)
        if cap and len(v) > cap:
            issues.append(("value_too_long", f, v[:60] + "…"))
    return issues


def main():
    if not DATASET or not os.path.isdir(DATASET):
        print("사용법: py bench_dataset.py <데이터셋 경로>", flush=True)
        print("  또는 OCR_BENCH_DATASET 환경변수로 지정한다.", flush=True)
        print(f"  하위 폴더: {' / '.join(FOLDER_TYPE)}", flush=True)
        sys.exit(1)

    from services import pipeline, parsing_skill

    out = []
    total = 0
    for folder, doc_type in FOLDER_TYPE.items():
        d = os.path.join(DATASET, folder)
        if not os.path.isdir(d):
            continue
        for name in sorted(os.listdir(d)):
            if not name.lower().endswith((".jpg", ".jpeg", ".png", ".webp")):
                continue
            total += 1
            src = os.path.join(d, name)
            dst = os.path.join(WORK, f"{folder}__{os.path.splitext(name)[0]}.jpg")
            try:
                orig, sent = prepare(src, dst)
            except Exception as e:  # noqa: BLE001
                out.append({"folder": folder, "file": name, "error": f"prepare: {e!r}"})
                print(f"[skip] {folder}/{name} prepare failed: {e!r}", flush=True)
                continue

            t0 = time.perf_counter()
            try:
                ocr = pipeline.run(dst)
                blocks = ocr.get("raw_blocks", [])
                res = parsing_skill.execute(blocks, document_type=doc_type)
                parsed = res["parsed"]
            except Exception as e:  # noqa: BLE001
                out.append({"folder": folder, "file": name, "error": f"run: {e!r}"})
                print(f"[FAIL] {folder}/{name} {e!r}", flush=True)
                continue
            elapsed = time.perf_counter() - t0

            issues = audit(parsed)
            out.append({
                "folder": folder,
                "document_type": doc_type,
                "file": name,
                "original": list(orig),
                "uploaded": list(sent),
                "elapsed_sec": round(elapsed, 2),
                "block_count": len(blocks),
                "field_count": len(parsed),
                "parsed": parsed,
                "issues": [{"kind": k, "field": f, "value": v} for k, f, v in issues],
                "blocks": [b["text"] for b in blocks],
            })
            flag = "!" if issues else " "
            print(f"[{total:3d}]{flag} {folder}/{name} blocks={len(blocks)} "
                  f"fields={len(parsed)} issues={len(issues)} {elapsed:.1f}s", flush=True)

    path = os.path.join(HERE, "bench_full.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
    print("WROTE " + path, flush=True)


if __name__ == "__main__":
    main()
