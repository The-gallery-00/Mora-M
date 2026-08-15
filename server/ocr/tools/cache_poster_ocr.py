"""포스터 이미지의 OCR 결과를 한 번만 계산해 캐시한다.

파싱 규칙을 고칠 때마다 전체를 다시 OCR 하면 155장에 13분이 든다. 그런데 규칙을
바꿔도 OCR 출력(블록 텍스트·bbox·confidence)은 변하지 않는다. 한 번 계산해 두면
tools/bench_posters.py 가 초 단위로 끝나고, 그래야 고치고 재는 주기가 짧아진다.

**앱 업로드 조건을 재현해서 넣는다** (장변 1280px, JPEG q85). 원본 해상도로 OCR 하면
실제 앱에서 나올 결과와 달라져 벤치가 거짓말을 한다.

  py tools/cache_poster_ocr.py <이미지 디렉터리> [출력.json]

리사이즈 파라미터(MAX_SIDE/QUALITY)나 OCR 엔진 설정을 바꾸면 캐시를 지워야 한다 —
그 경우 출력이 실제로 달라지기 때문이다.
"""
import json
import os
import sys

sys.path.insert(0, os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")))

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_OUT = os.path.join(HERE, "poster_ocr_cache.json")
WORK = os.path.join(HERE, "_ocr_cache_work")

MAX_SIDE = 1280
QUALITY = 85


def prep(src: str, dst: str) -> None:
    with Image.open(src) as im:
        im = im.convert("RGB")
        w, h = im.size
        if max(w, h) > MAX_SIDE:
            r = MAX_SIDE / max(w, h)
            im = im.resize((int(w * r), int(h * r)), Image.LANCZOS)
        im.save(dst, "JPEG", quality=QUALITY)


def main():
    if len(sys.argv) < 2 or not os.path.isdir(sys.argv[1]):
        print("사용법: py tools/cache_poster_ocr.py <이미지 디렉터리> [출력.json]")
        sys.exit(1)
    img_dir = sys.argv[1]
    out = sys.argv[2] if len(sys.argv) > 2 else DEFAULT_OUT

    os.makedirs(WORK, exist_ok=True)
    cache = {}
    if os.path.isfile(out):
        with open(out, encoding="utf-8") as f:
            cache = json.load(f)

    from services import pipeline

    names = [n for n in sorted(os.listdir(img_dir))
             if n.lower().endswith((".jpg", ".jpeg", ".png", ".webp"))]
    todo = [n for n in names if n not in cache]
    print(f"전체 {len(names)}장 · 캐시 {len(cache)}장 · 계산 {len(todo)}장", flush=True)

    for i, name in enumerate(todo, 1):
        dst = os.path.join(WORK, name + ".jpg")
        if not os.path.isfile(dst):
            try:
                prep(os.path.join(img_dir, name), dst)
            except Exception as exc:  # noqa: BLE001 — 깨진 이미지 하나가 전체를 멈추면 안 된다
                print(f"  [skip] {name} {type(exc).__name__}", flush=True)
                continue
        blocks = pipeline.run(dst).get("raw_blocks", [])
        # bbox 가 numpy 일 수 있다 → JSON 직렬화 가능한 형태로 낮춘다.
        cache[name] = [
            {
                "text": b["text"],
                "confidence": float(b.get("confidence", 0.0)),
                "bbox": [[float(p[0]), float(p[1])] for p in (b.get("bbox") or [])],
                "block_index": int(b["block_index"]),
            }
            for b in blocks
        ]
        if i % 20 == 0:
            print(f"  ...{i}/{len(todo)}", flush=True)
            with open(out, "w", encoding="utf-8") as f:
                json.dump(cache, f, ensure_ascii=False)

    with open(out, "w", encoding="utf-8") as f:
        json.dump(cache, f, ensure_ascii=False)
    print(f"WROTE {out}  ({len(cache)}장)", flush=True)


if __name__ == "__main__":
    main()
