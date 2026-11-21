import * as ort from 'onnxruntime-web';
import type { DetectionBox, InferenceResult } from '../types';

let session: ort.InferenceSession | null = null;
let isLoading = false;

// Configure ONNX Runtime wasm paths
ort.env.wasm.numThreads = 2;
ort.env.wasm.simd = true;

const MODEL_PATH = '/models/helmet_yolov8.onnx';
const INPUT_SIZE = 640;
const CONF_THRESHOLD = 0.50; // High confidence to prevent false positive helmet triggers
const IOU_THRESHOLD = 0.45;

const CLASS_NAMES: Record<number, string> = {
  0: 'With Helmet',
  1: 'Without Helmet',
};

export async function initHelmetModel(onProgress?: (msg: string) => void): Promise<boolean> {
  if (session) return true;
  if (isLoading) return false;

  try {
    isLoading = true;
    onProgress?.('Loading Helmet YOLOv8 Model...');
    session = await ort.InferenceSession.create(MODEL_PATH, {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all',
    });
    console.log('[HelmetInference] ONNX Session created successfully');
    onProgress?.('Model loaded successfully!');
    isLoading = false;
    return true;
  } catch (err) {
    console.error('[HelmetInference] Failed to load model:', err);
    onProgress?.('Model load failed. Check console.');
    isLoading = false;
    return false;
  }
}

// Reusable offscreen canvas & context to eliminate GC pressure & frame stutter
let offscreenCanvas: HTMLCanvasElement | null = null;
let offscreenCtx: CanvasRenderingContext2D | null = null;

function getOffscreenContext(): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  if (!offscreenCanvas) {
    offscreenCanvas = document.createElement('canvas');
    offscreenCanvas.width = INPUT_SIZE;
    offscreenCanvas.height = INPUT_SIZE;
    offscreenCtx = offscreenCanvas.getContext('2d', { willReadFrequently: true });
  }
  return { canvas: offscreenCanvas, ctx: offscreenCtx! };
}

function preprocess(
  source: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement
): { tensor: ort.Tensor; scale: number; padX: number; padY: number } {
  const { ctx } = getOffscreenContext();

  // Letterbox resize maintaining aspect ratio
  const srcW = 'videoWidth' in source ? (source.videoWidth || source.width) : source.width;
  const srcH = 'videoHeight' in source ? (source.videoHeight || source.height) : source.height;

  const scale = Math.min(INPUT_SIZE / srcW, INPUT_SIZE / srcH);
  const newW = Math.round(srcW * scale);
  const newH = Math.round(srcH * scale);
  const padX = Math.floor((INPUT_SIZE - newW) / 2);
  const padY = Math.floor((INPUT_SIZE - newH) / 2);

  ctx.fillStyle = '#727272'; // neutral gray padding
  ctx.fillRect(0, 0, INPUT_SIZE, INPUT_SIZE);
  ctx.drawImage(source, 0, 0, srcW, srcH, padX, padY, newW, newH);

  const imgData = ctx.getImageData(0, 0, INPUT_SIZE, INPUT_SIZE);
  const { data } = imgData;

  // Convert RGBA to Float32 CHW normalized [0, 1]
  const floatData = new Float32Array(3 * INPUT_SIZE * INPUT_SIZE);
  const planeSize = INPUT_SIZE * INPUT_SIZE;

  for (let i = 0; i < planeSize; i++) {
    const r = data[i * 4] / 255.0;
    const g = data[i * 4 + 1] / 255.0;
    const b = data[i * 4 + 2] / 255.0;

    floatData[i] = r;
    floatData[planeSize + i] = g;
    floatData[2 * planeSize + i] = b;
  }

  const tensor = new ort.Tensor('float32', floatData, [1, 3, INPUT_SIZE, INPUT_SIZE]);
  return { tensor, scale, padX, padY };
}

function iou(b1: DetectionBox, b2: DetectionBox): number {
  const x1 = Math.max(b1.x, b2.x);
  const y1 = Math.max(b1.y, b2.y);
  const x2 = Math.min(b1.x + b1.width, b2.x + b2.width);
  const y2 = Math.min(b1.y + b1.height, b2.y + b2.height);

  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const area1 = b1.width * b1.height;
  const area2 = b2.width * b2.height;
  const union = area1 + area2 - inter;

  return union > 0 ? inter / union : 0;
}

function nms(boxes: DetectionBox[], iouThresh: number): DetectionBox[] {
  boxes.sort((a, b) => b.score - a.score);
  const selected: DetectionBox[] = [];

  for (const box of boxes) {
    let keep = true;
    for (const chosen of selected) {
      if (iou(box, chosen) > iouThresh) {
        keep = false;
        break;
      }
    }
    if (keep) selected.push(box);
  }
  return selected;
}

export async function detectHelmet(
  source: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement
): Promise<InferenceResult> {
  if (!session) {
    const initialized = await initHelmetModel();
    if (!initialized || !session) {
      return { detections: [], inferenceTimeMs: 0, helmetDetected: false, unprotectedDetected: false };
    }
  }

  const startTime = performance.now();
  const { tensor, scale, padX, padY } = preprocess(source);

  const feeds: Record<string, ort.Tensor> = {};
  feeds[session.inputNames[0]] = tensor;

  const results = await session.run(feeds);
  const output = results[session.outputNames[0]]; // Shape: [1, 6, 8400]
  const data = output.data as Float32Array;

  // [1, 6, 8400] -> 6 rows: xc, yc, w, h, score_class0, score_class1
  const numDetections = 8400;
  const candidateBoxes: DetectionBox[] = [];

  for (let i = 0; i < numDetections; i++) {
    const xc = data[0 * numDetections + i];
    const yc = data[1 * numDetections + i];
    const w = data[2 * numDetections + i];
    const h = data[3 * numDetections + i];
    const score0 = data[4 * numDetections + i]; // With helmet
    const score1 = data[5 * numDetections + i]; // Without helmet

    let classId = 0;
    let maxScore = score0;
    if (score1 > score0) {
      classId = 1;
      maxScore = score1;
    }

    if (maxScore >= CONF_THRESHOLD) {
      // Map back from letterbox 640x640 to original source coordinates
      const origX = (xc - w / 2 - padX) / scale;
      const origY = (yc - h / 2 - padY) / scale;
      const origW = w / scale;
      const origH = h / scale;

      candidateBoxes.push({
        x: Math.max(0, origX),
        y: Math.max(0, origY),
        width: origW,
        height: origH,
        score: maxScore,
        classId,
        label: CLASS_NAMES[classId] || `Class ${classId}`,
      });
    }
  }

  const finalDetections = nms(candidateBoxes, IOU_THRESHOLD);
  const elapsed = Math.round(performance.now() - startTime);

  let helmetDetected = false;
  let unprotectedDetected = false;

  for (const det of finalDetections) {
    if (det.classId === 0) helmetDetected = true;
    if (det.classId === 1) unprotectedDetected = true;
  }

  return {
    detections: finalDetections,
    inferenceTimeMs: elapsed,
    helmetDetected,
    unprotectedDetected,
  };
}
