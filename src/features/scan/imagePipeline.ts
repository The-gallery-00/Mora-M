import { File as FsFile } from 'expo-file-system';
import { ImageManipulator, SaveFormat, type ImageRef } from 'expo-image-manipulator';

import {
  type AdjustedImage,
  type CropRect,
  type PreparedImage,
  ScanPipelineError,
} from './types';

/**
 * SCAN-03 / SCAN-04 이미지 전처리.
 *
 * 정본: wiki/tech/Camera and Scan.md §5 (크롭·회전) · §6 (IMG-01~07 + 재압축 사다리)
 *
 * 확정 수치 (§6-1)
 *  IMG-01 최대 장변 1280px  — 서버가 `MAX_IMAGE_SIDE = 1280` 으로 즉시 축소하므로 초과 전송은 이득 0
 *  IMG-02 최소 장변 1024px  — 감열 영수증 8~10pt 글자의 PaddleOCR 인식 하한. 사다리 바닥값
 *  IMG-03 포맷 JPEG        — 서버가 `.convert("RGB")` 후 JPEG 재저장
 *  IMG-04 품질 0.85
 *  IMG-05 목표 용량 ≤ 1.2MB
 *  IMG-06 하드 상한 8MB    — Spring `max-request-size: 10MB` 에서 멀티파트 오버헤드 2MB 를 뺀 값
 *  IMG-07 EXIF/GPS 전부 제거
 *
 * ── SDK 57 API 결정 ───────────────────────────────────────────────────────────
 * 위키 §6-3 예시는 `manipulateAsync` + `expo-file-system/legacy` 를 쓰지만, 이 프로젝트의
 * 실제 설치 버전(expo-image-manipulator 57 / expo-file-system 57)에서는
 *  1. `manipulateAsync` 가 deprecated 이고 내부적으로 컨텍스트 API 를 호출하는 얇은 래퍼다.
 *  2. `expo-file-system/legacy` 의 `InfoOptions` 에 `size` 키가 없어져 위키 예시
 *     `getInfoAsync(uri, { size: true })` 는 **타입 에러**가 된다.
 * 따라서 컨텍스트 API(`ImageManipulator.manipulate(...)`) + 신규 `File(uri).size` 를 쓴다.
 * 알고리즘(사다리·수치)은 위키와 100% 동일하다.
 *
 * 컨텍스트 API 를 쓰는 실질 이득이 하나 더 있다: 크롭·회전 결과를 `ImageRef` 로 메모리에 들고
 * 그 위에서 사다리를 돌릴 수 있어 **디코드 1회 / 디스크 쓰기 1회**로 끝난다
 * (스캔 세션 피크 메모리 예산 250MB — §14).
 */

const MAX_SIDE = 1280;
const MIN_SIDE = 1024;
const TARGET_BYTES = 1.2 * 1024 * 1024;
const HARD_LIMIT_BYTES = 8 * 1024 * 1024;

/** §6-2 재압축 사다리. 3회차까지 실패하면 SCF-04. */
const LADDER = [
  { side: MAX_SIDE, compress: 0.85, limit: TARGET_BYTES },
  { side: MAX_SIDE, compress: 0.7, limit: 2.5 * 1024 * 1024 },
  { side: MIN_SIDE, compress: 0.7, limit: HARD_LIMIT_BYTES },
] as const;

/** multipart 파트 파일명. 확장자가 없으면 OCR 의 `Path(filename).suffix` 추출이 실패한다. */
export const UPLOAD_FILE_NAME = 'scan.jpg';

export const IMAGE_SPEC = {
  maxSide: MAX_SIDE,
  minSide: MIN_SIDE,
  quality: LADDER[0].compress,
  targetBytes: TARGET_BYTES,
  hardLimitBytes: HARD_LIMIT_BYTES,
} as const;

/** 파일 바이트. 존재하지 않으면 0 (신규 File API 의 `size` 계약). */
function fileBytes(uri: string): number {
  try {
    const file = new FsFile(uri);
    return file.exists ? file.size : 0;
  } catch {
    return 0;
  }
}

/** `release()` 를 빠뜨리면 네이티브 비트맵이 GC 까지 살아남는다. 항상 finally 로 정리한다. */
function safeRelease(target: { release: () => void } | null): void {
  try {
    target?.release();
  } catch {
    // 이미 해제된 SharedObject. 무시해도 안전하다.
  }
}

/**
 * 원본 픽셀 크기를 읽는다. 촬영/피커 결과에 width/height 가 함께 오므로
 * 가능하면 그 값을 넘겨 이 함수(= 추가 디코드 1회)를 건너뛰는 것이 좋다.
 */
export async function readImageSize(uri: string): Promise<{ width: number; height: number }> {
  const context = ImageManipulator.manipulate(uri);
  let ref: ImageRef | null = null;
  try {
    ref = await context.renderAsync();
    return { width: ref.width, height: ref.height };
  } catch (e) {
    throw toPipelineError(e);
  } finally {
    safeRelease(ref);
    safeRelease(context);
  }
}

/**
 * 회전 각도를 0/90/180/270 으로 정규화한다. 음수 회전도 허용한다.
 * v1 은 **90° 단위 회전만** 제공한다 (§5 결정 — 4점 원근 보정은 범위 밖).
 */
export function normalizeRotation(degrees: number): 0 | 90 | 180 | 270 {
  const step = Math.round(degrees / 90) * 90;
  const wrapped = ((step % 360) + 360) % 360;
  return wrapped === 90 || wrapped === 180 || wrapped === 270 ? wrapped : 0;
}

export type PrepareOptions = {
  /** 이미 알고 있는 원본 픽셀 크기. 있으면 디코드 1회를 아낀다. */
  size?: { width: number; height: number } | null;
  /** 90° 단위 회전. 크롭보다 **먼저** 적용된다. */
  rotate?: number;
  /**
   * 크롭 사각형. 좌표계는 **회전이 적용된 뒤**의 이미지 기준이다
   * (크롭 UI 가 화면에 보이는 회전된 이미지 위에서 박스를 잡으므로).
   */
  crop?: CropRect | null;
};

/**
 * SCAN-04. 크롭/회전 → 장변 축소 → JPEG 압축을 한 번에 수행하고 업로드 파일을 만든다.
 *
 * 결과 URI 는 `/api/scan` 과 `/api/commit` 에 **같은 파일 그대로** 재전송한다 (재압축 금지 —
 * 두 요청의 이미지가 달라지면 `ner_dataset` 라벨과 실제 OCR 입력이 어긋난다, §6-3 결정).
 *
 * @throws {ScanPipelineError} `SCF-03`(저장공간/디코드 실패) 또는 `SCF-04`(사다리 3회차도 8MB 초과)
 */
export async function prepareForUpload(
  uri: string,
  options: PrepareOptions = {},
): Promise<PreparedImage> {
  const rotation = normalizeRotation(options.rotate ?? 0);
  const crop = options.crop ?? null;

  // 1) 크롭/회전을 1패스로 적용하고 결과를 메모리 ImageRef 로 들고 있는다.
  //    디스크 저장을 하지 않으므로 중간 파일과 이중 인코딩 손실이 없다.
  const baseContext = ImageManipulator.manipulate(uri);
  if (rotation !== 0) baseContext.rotate(rotation);
  if (crop) baseContext.crop(crop);

  let baseRef: ImageRef | null = null;
  try {
    baseRef = await baseContext.renderAsync();
  } catch (e) {
    safeRelease(baseContext);
    throw toPipelineError(e);
  }
  safeRelease(baseContext);

  const source = baseRef;
  const srcWidth = source.width;
  const srcHeight = source.height;
  const landscape = srcWidth >= srcHeight;
  const longestSide = Math.max(srcWidth, srcHeight);

  try {
    for (const step of LADDER) {
      const context = ImageManipulator.manipulate(source);
      // 확대 금지: 원본이 이미 목표 장변보다 작으면 리사이즈를 건너뛴다.
      if (longestSide > step.side) {
        context.resize(landscape ? { width: step.side } : { height: step.side });
      }

      let ref: ImageRef | null = null;
      try {
        ref = await context.renderAsync();
        const saved = await ref.saveAsync({
          compress: step.compress,
          format: SaveFormat.JPEG, // IMG-03 — 서버가 어차피 RGB JPEG 로 재저장한다
        });
        const bytes = fileBytes(saved.uri);
        if (bytes > 0 && bytes <= step.limit) {
          return {
            uri: saved.uri,
            name: UPLOAD_FILE_NAME,
            type: 'image/jpeg',
            width: saved.width,
            height: saved.height,
            bytes,
          };
        }
      } catch (e) {
        throw toPipelineError(e);
      } finally {
        safeRelease(ref);
        safeRelease(context);
      }
    }
  } finally {
    safeRelease(baseRef);
  }

  // 파노라마·스크린샷 합성 같은 이상값만 여기 도달한다 (§6-2).
  throw new ScanPipelineError('SCF-04', '재압축 3회차까지 8MB 를 넘었습니다.');
}

/**
 * SCAN-03 크롭/회전 미리보기 파일을 만든다.
 *
 * 프로덕션 경로는 `prepareForUpload(uri, { crop, rotate })` 로 **한 번에** 처리하는 것을 권한다.
 * 이 함수를 거치면 JPEG 인코딩이 한 번 더 일어나(세대 손실) OCR 정확도에 불리하다.
 * 크롭 화면이 "적용된 결과"를 파일로 보여줘야 할 때만 쓴다.
 *
 * @throws {ScanPipelineError} `SCF-03`
 */
export async function cropAndRotate(
  uri: string,
  rect: CropRect | null,
  degrees = 0,
): Promise<AdjustedImage> {
  const rotation = normalizeRotation(degrees);
  const context = ImageManipulator.manipulate(uri);
  if (rotation !== 0) context.rotate(rotation);
  if (rect) context.crop(rect);

  let ref: ImageRef | null = null;
  try {
    ref = await context.renderAsync();
    // 미리보기 전용이라 품질을 넉넉히 둔다. 최종 압축은 prepareForUpload 가 담당한다.
    const saved = await ref.saveAsync({ compress: 0.95, format: SaveFormat.JPEG });
    return { uri: saved.uri, width: saved.width, height: saved.height };
  } catch (e) {
    throw toPipelineError(e);
  } finally {
    safeRelease(ref);
    safeRelease(context);
  }
}

/**
 * SCF-03: 저장공간 부족 / 디코드 실패 / `content://` 접근 실패를 하나로 묶는다.
 * 사용자에게 보여줄 문구는 useScan 의 매핑표가 결정한다.
 */
function toPipelineError(error: unknown): ScanPipelineError {
  if (error instanceof ScanPipelineError) return error;
  const detail = error instanceof Error ? error.message : String(error);
  return new ScanPipelineError('SCF-03', detail);
}
