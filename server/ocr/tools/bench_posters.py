"""포스터 필드 정확도 회귀 게이트.

정답 라벨(gt)이 있는 포스터 세트로 필드별 정확률을 재고, 직전 실행과 비교해
**어느 필드가 좋아지고 어느 필드가 나빠졌는지**를 찍는다.

**왜 필요한가.** 규칙은 서로 간섭한다. 실제로 location 규칙을 좁혔더니
event_start_date / event_end_date 가 각 1건씩 나빠졌다 — 장소로 흡수되던 블록이
날짜 분기까지 흘러갔기 때문이다. 필드 하나만 보고 고치면 이런 손실을 못 본다.

**OCR 은 캐시한다.** 규칙을 바꿔도 OCR 출력은 변하지 않는데, 매번 다시 돌리면
155장에 13분이 든다. 캐시가 있으면 초 단위로 끝나고, 그래야 고치고 재는 주기가
짧아진다. 캐시는 tools/cache_poster_ocr.py 가 만든다.

  py tools/bench_posters.py                 # 측정 + 직전 대비 증감
  py tools/bench_posters.py --save baseline # 현재 결과를 기준선으로 저장

정확률 = (정확 + 부분) / 정답보유. 부분일치를 세는 이유는 title 처럼 "일부만 잡는"
실패가 "아예 못 잡는" 실패와 성격이 다르기 때문이다 — 둘을 한 숫자로 뭉치면
어느 쪽을 고쳐야 하는지 보이지 않는다.
"""
import json
import os
import re
import sys

sys.path.insert(0, os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")))

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_GT = os.environ.get("POSTER_GT_DIR", "")
DEFAULT_CACHE = os.path.join(HERE, "poster_ocr_cache.json")
BASELINE = os.path.join(HERE, "poster_bench_baseline.json")

FIELDS = ["title", "organizer_name", "event_start_date", "event_end_date",
          "contact_phone", "contact_email", "location", "website_url"]


def norm(s: str) -> str:
    """비교용 정규화. 공백·구두점 차이는 같은 값으로 본다."""
    return re.sub(r"[\s\-.()·,]+", "", (s or "").strip().lower())


def measure(cache: dict, gt_dir: str) -> dict:
    from services import parsing_skill

    stat = {f: {"gt": 0, "exact": 0, "partial": 0, "wrong": 0, "missing": 0} for f in FIELDS}
    n = 0
    for name, blocks in cache.items():
        gtp = os.path.join(gt_dir, os.path.splitext(name)[0] + ".json")
        if not os.path.isfile(gtp):
            continue
        with open(gtp, encoding="utf-8") as f:
            gt = json.load(f)
        parsed = parsing_skill.execute([dict(b) for b in blocks], "POSTER")["parsed"]
        n += 1
        for field in FIELDS:
            g = (gt.get(field) or "").strip()
            p = (parsed.get(field) or "").strip()
            if not g:
                continue
            s = stat[field]
            s["gt"] += 1
            if not p:
                s["missing"] += 1
            elif norm(p) == norm(g):
                s["exact"] += 1
            elif norm(p) in norm(g) or norm(g) in norm(p):
                s["partial"] += 1
            else:
                s["wrong"] += 1
    return {"n": n, "stat": stat}


def rate(s: dict) -> float:
    return (s["exact"] + s["partial"]) / s["gt"] * 100 if s["gt"] else 0.0


def main():
    gt_dir = ""
    cache_path = DEFAULT_CACHE
    save = "--save" in sys.argv
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if args:
        gt_dir = args[0]
    if len(args) > 1:
        cache_path = args[1]
    gt_dir = gt_dir or DEFAULT_GT

    if not gt_dir or not os.path.isdir(gt_dir):
        print("사용법: py tools/bench_posters.py <gt 디렉터리> [ocr 캐시.json] [--save]")
        print("  또는 POSTER_GT_DIR 환경변수로 gt 경로를 지정한다.")
        print("  캐시는 tools/cache_poster_ocr.py 로 먼저 만든다.")
        sys.exit(1)
    if not os.path.isfile(cache_path):
        print(f"OCR 캐시가 없다: {cache_path}")
        print("  py tools/cache_poster_ocr.py <이미지 디렉터리> 로 먼저 만든다.")
        sys.exit(1)

    with open(cache_path, encoding="utf-8") as f:
        cache = json.load(f)

    cur = measure(cache, gt_dir)
    prev = None
    if os.path.isfile(BASELINE):
        with open(BASELINE, encoding="utf-8") as f:
            prev = json.load(f)

    print(f"=== 포스터 {cur['n']}장 · 정답 대조")
    header = f"{'필드':18s} {'정답':>4s} {'정확':>4s} {'부분':>4s} {'오답':>4s} {'누락':>4s} {'정확률':>7s}"
    if prev:
        header += "   기준선 대비"
    print(header)

    for field in FIELDS:
        s = cur["stat"][field]
        if not s["gt"]:
            continue
        line = (f"{field:18s} {s['gt']:4d} {s['exact']:4d} {s['partial']:4d} "
                f"{s['wrong']:4d} {s['missing']:4d} {rate(s):6.1f}%")
        if prev and field in prev.get("stat", {}):
            d = rate(s) - rate(prev["stat"][field])
            mark = "  " if abs(d) < 0.05 else ("↑ " if d > 0 else "↓ ")
            line += f"   {mark}{d:+5.1f}%p"
        print(line)

    # 전체 오답/누락 합 — 개별 필드가 좋아져도 총량이 늘면 회귀다.
    tw = sum(cur["stat"][f]["wrong"] for f in FIELDS)
    tm = sum(cur["stat"][f]["missing"] for f in FIELDS)
    line = f"\n  오답 합계 {tw}   누락 합계 {tm}"
    if prev:
        pw = sum(prev["stat"][f]["wrong"] for f in FIELDS if f in prev["stat"])
        pm = sum(prev["stat"][f]["missing"] for f in FIELDS if f in prev["stat"])
        line += f"   (기준선 {pw} / {pm}  →  {tw - pw:+d} / {tm - pm:+d})"
    print(line)

    if save:
        with open(BASELINE, "w", encoding="utf-8") as f:
            json.dump(cur, f, ensure_ascii=False, indent=2)
        print(f"\n기준선 저장: {BASELINE}")


if __name__ == "__main__":
    main()
