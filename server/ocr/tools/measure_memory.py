"""분류기 추가가 상주/피크 메모리를 얼마나 늘리는지 잰다.

배포 판단에 필요한 유일한 미측정 항목이다. Cloud Run 2Gi 예산은 OOM 때문에 깎은
값이고 여유가 약 1.1GB 라, onnxruntime + ResNet18 이 그 안에 들어가는지 확인해야 한다.

같은 프로세스에서 순서대로 재고 증분을 본다:
  1) 기준선(파이썬만)
  2) PaddleOCR 파이프라인 로드 후
  3) OCR 1회 실행 후 (피크)
  4) 분류기 로드 후
  5) 분류 1회 실행 후 (피크)
"""
import os
import sys
import threading
import time

sys.path.insert(0, os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")))

import psutil

P = psutil.Process()
_peak = 0.0
_stop = False


def _sampler():
    global _peak
    while not _stop:
        _peak = max(_peak, P.memory_info().rss / 1e6)
        time.sleep(0.01)


def rss():
    return P.memory_info().rss / 1e6


def mark(label, base=None):
    cur = rss()
    extra = f"  (+{cur - base:.0f}MB)" if base is not None else ""
    print(f"  {label:34s} RSS {cur:7.0f}MB  peak {_peak:7.0f}MB{extra}", flush=True)
    return cur


def main():
    global _stop
    t = threading.Thread(target=_sampler, daemon=True)
    t.start()

    if len(sys.argv) < 2:
        print("사용법: py tools/measure_memory.py <이미지 경로>")
        sys.exit(1)
    img = sys.argv[1]
    print("=== 메모리 측정 (증분)", flush=True)
    base0 = mark("1) 기준선(파이썬만)")

    from services import pipeline
    base1 = mark("2) PaddleOCR 로드 후", base0)

    blocks = pipeline.run(img).get("raw_blocks", [])
    base2 = mark(f"3) OCR 1회 실행 후 (블록 {len(blocks)})", base1)

    from src.classifier.doc_type import classify_document, _load
    _load()
    base3 = mark("4) 분류기(ONNX) 로드 후", base2)

    v = classify_document(img, blocks)
    base4 = mark(f"5) 분류 1회 실행 후 {v}", base3)

    # 분류를 5회 더 — 반복 시 누수가 있는지
    for _ in range(5):
        classify_document(img, blocks)
    mark("6) 분류 5회 더 실행 후", base4)

    _stop = True
    time.sleep(0.05)
    print(f"\n  분류기가 더한 상주 메모리 : {base3 - base2:.0f}MB", flush=True)
    print(f"  전체 피크                : {_peak:.0f}MB", flush=True)
    print(f"  Cloud Run 2Gi(2150MB) 여유: {2150 - _peak:.0f}MB", flush=True)


if __name__ == "__main__":
    main()
