"""웹의 ResNet18 문서종류 분류기(.pt)를 ONNX 로 변환하고 동치를 검증한다.

왜 ONNX 인가: 서버에 torch 를 넣으면 CPU wheel 만으로도 이미지가 200MB+ 커지고
런타임 상주 메모리도 250~350MB 늘어난다. Cloud Run 2Gi 예산은 OOM 때문에 방금
깎은 값이라 여유가 약 1.1GB뿐이다. onnxruntime 는 그 1/10 수준이고,
ResNet18 추론은 연산자가 단순해 변환 위험도 낮다.

검증은 "변환됐다"가 아니라 **같은 입력에 같은 답을 내는가**로 한다.
"""
import json
import os
import sys

import numpy as np
import torch
import torch.nn as nn
from torchvision import models

# 원본 체크포인트 경로. 웹 저장소(The-gallery-00/Mora)의 ocr/models/image_classifier.pt 다.
#   py tools/convert_classifier_to_onnx.py <원본.pt 경로>
# torch/torchvision 은 **이 변환에만** 필요하다. 서버 런타임에는 onnxruntime 만 쓴다.
_HERE = os.path.dirname(os.path.abspath(__file__))
SRC = (
    sys.argv[1] if len(sys.argv) > 1
    else os.environ.get("CLASSIFIER_PT", "")
)
OUT_DIR = os.path.normpath(os.path.join(_HERE, "..", "models"))
OUT = os.path.join(OUT_DIR, "image_classifier.onnx")
META = os.path.join(OUT_DIR, "image_classifier.json")


def build():
    ckpt = torch.load(SRC, map_location="cpu", weights_only=True)
    classes = ckpt["classes"]
    m = models.resnet18(weights=None)
    m.fc = nn.Sequential(nn.Dropout(0.3), nn.Linear(m.fc.in_features, len(classes)))
    m.load_state_dict(ckpt["model_state"])
    m.eval()
    return m, classes


def main():
    if not SRC or not os.path.isfile(SRC):
        print("사용법: py tools/convert_classifier_to_onnx.py <image_classifier.pt 경로>")
        print("  또는 CLASSIFIER_PT 환경변수로 지정한다.")
        print("  원본은 웹 저장소의 ocr/models/image_classifier.pt 다.")
        sys.exit(1)
    os.makedirs(OUT_DIR, exist_ok=True)

    model, classes = build()
    print("classes:", classes, flush=True)

    dummy = torch.randn(1, 3, 224, 224)
    torch.onnx.export(
        model, dummy, OUT,
        input_names=["input"], output_names=["logits"],
        dynamic_axes={"input": {0: "batch"}, "logits": {0: "batch"}},
        opset_version=17,
    )
    with open(META, "w", encoding="utf-8") as f:
        json.dump({"classes": classes, "input_size": 224,
                   "mean": [0.485, 0.456, 0.406], "std": [0.229, 0.224, 0.225]},
                  f, ensure_ascii=False, indent=2)

    size_pt = os.path.getsize(SRC) / 1e6
    size_onnx = os.path.getsize(OUT) / 1e6
    print(f"pt={size_pt:.1f}MB -> onnx={size_onnx:.1f}MB", flush=True)

    # ── 동치 검증: 무작위 입력 200개에서 argmax 와 softmax 가 일치하는가 ──
    import onnxruntime as ort
    sess = ort.InferenceSession(OUT, providers=["CPUExecutionProvider"])

    rng = np.random.default_rng(42)
    mismatch = 0
    max_prob_diff = 0.0
    for _ in range(200):
        x = rng.standard_normal((1, 3, 224, 224), dtype=np.float32)
        with torch.no_grad():
            t = model(torch.from_numpy(x)).numpy()
        o = sess.run(["logits"], {"input": x})[0]

        def softmax(v):
            e = np.exp(v - v.max())
            return e / e.sum()

        pt_p, ox_p = softmax(t[0]), softmax(o[0])
        if int(pt_p.argmax()) != int(ox_p.argmax()):
            mismatch += 1
        max_prob_diff = max(max_prob_diff, float(np.abs(pt_p - ox_p).max()))

    print(f"argmax 불일치: {mismatch}/200", flush=True)
    print(f"softmax 최대 오차: {max_prob_diff:.2e}", flush=True)
    if mismatch or max_prob_diff > 1e-4:
        print("FAIL — 동치가 아니다", flush=True)
        sys.exit(1)
    print("OK — 동치 확인", flush=True)


if __name__ == "__main__":
    main()
