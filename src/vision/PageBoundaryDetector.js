import { loadOpenCV } from './OpenCVLoader.js';

const DEFAULT_OPTIONS = {
  targetMaxDimension: 920,
  minAreaRatio: 0.12,
  maxAreaRatio: 0.96,
  cannyLow: 55,
  cannyHigh: 155,
  blurKernelSize: 5
};

export async function detectPageBoundaryFromCanvas(canvas, options = {}) {
  const startedAt = performance.now();
  const config = { ...DEFAULT_OPTIONS, ...options };

  if (!canvas?.width || !canvas?.height) {
    return createFailedDetection('invalid-canvas', 'Canvas is empty or unavailable.', startedAt, canvas);
  }

  let cv;
  try {
    cv = await loadOpenCV(options.opencvLoader || {});
  } catch (error) {
    return createFailedDetection(
      'opencv-unavailable',
      `OpenCV.js could not be loaded: ${error?.message || error}`,
      startedAt,
      canvas
    );
  }

  const { canvas: workingCanvas, scaleX, scaleY } = createWorkingCanvas(canvas, config.targetMaxDimension);

  let src;
  let gray;
  let blurred;
  let edges;
  let morphed;
  let contours;
  let hierarchy;
  let kernel;

  try {
    src = cv.imread(workingCanvas);
    gray = new cv.Mat();
    blurred = new cv.Mat();
    edges = new cv.Mat();
    morphed = new cv.Mat();
    contours = new cv.MatVector();
    hierarchy = new cv.Mat();
    kernel = cv.Mat.ones(3, 3, cv.CV_8U);

    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY, 0);
    cv.GaussianBlur(
      gray,
      blurred,
      new cv.Size(config.blurKernelSize, config.blurKernelSize),
      0,
      0,
      cv.BORDER_DEFAULT
    );
    cv.Canny(blurred, edges, config.cannyLow, config.cannyHigh, 3, false);
    cv.morphologyEx(edges, morphed, cv.MORPH_CLOSE, kernel);
    cv.dilate(morphed, morphed, kernel, new cv.Point(-1, -1), 1);
    cv.findContours(morphed, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

    const best = findBestQuadrilateral(cv, contours, workingCanvas.width, workingCanvas.height, config);

    if (!best) {
      return createFailedDetection(
        'page-contour-not-found',
        'No strong four-corner page/book contour was detected. Retake with full page visible, higher contrast, and less shadow.',
        startedAt,
        canvas,
        workingCanvas
      );
    }

    const cornersPx = scaleCorners(best.corners, scaleX, scaleY);
    const metrics = calculateBoundaryMetrics(cornersPx, canvas.width, canvas.height);

    return {
      detected: true,
      detectionMode: 'opencv-canny-contour',
      source: 'capture-image',
      status: best.confidence >= 0.72 ? 'detected-good' : 'detected-review',
      confidence: round(best.confidence, 2),
      reason: null,
      imageSize: {
        width: canvas.width,
        height: canvas.height
      },
      processingSize: {
        width: workingCanvas.width,
        height: workingCanvas.height
      },
      cornersPx,
      orientation: metrics.orientation,
      aspectRatio: round(metrics.aspectRatio, 4),
      areaRatio: round(metrics.areaRatio, 4),
      edgeLengthsPx: metrics.edgeLengthsPx,
      canny: {
        low: config.cannyLow,
        high: config.cannyHigh
      },
      processingTimeMs: round(performance.now() - startedAt, 2)
    };
  } catch (error) {
    return createFailedDetection('opencv-processing-error', error?.message || String(error), startedAt, canvas, workingCanvas);
  } finally {
    safeDelete(src);
    safeDelete(gray);
    safeDelete(blurred);
    safeDelete(edges);
    safeDelete(morphed);
    safeDelete(contours);
    safeDelete(hierarchy);
    safeDelete(kernel);
  }
}

function findBestQuadrilateral(cv, contours, width, height, config) {
  const imageArea = width * height;
  let best = null;

  for (let i = 0; i < contours.size(); i += 1) {
    const contour = contours.get(i);
    const area = cv.contourArea(contour);
    const areaRatio = area / imageArea;

    if (areaRatio < config.minAreaRatio || areaRatio > config.maxAreaRatio) {
      contour.delete();
      continue;
    }

    const perimeter = cv.arcLength(contour, true);
    const approx = new cv.Mat();
    const approxLoose = new cv.Mat();

    try {
      cv.approxPolyDP(contour, approx, 0.02 * perimeter, true);
      const polygon = approx.rows === 4 ? approx : null;

      if (!polygon) {
        cv.approxPolyDP(contour, approxLoose, 0.04 * perimeter, true);
      }

      const finalPolygon = polygon || (approxLoose.rows === 4 ? approxLoose : null);
      if (!finalPolygon) continue;

      const rawCorners = readMatPoints(finalPolygon);
      const corners = orderCorners(rawCorners);
      const metrics = calculateBoundaryMetrics(corners, width, height);

      if (!isReasonablePage(metrics)) continue;

      const rectangularity = Math.min(1, area / Math.max(metrics.boundingArea, 1));
      const centerScore = scoreCentered(metrics.center, width, height);
      const areaScore = clamp01((areaRatio - config.minAreaRatio) / 0.45);
      const angleScore = scoreAngles(corners);
      const confidence = clamp01(
        0.38 * areaScore +
        0.24 * rectangularity +
        0.2 * angleScore +
        0.18 * centerScore
      );

      if (!best || confidence > best.confidence) {
        best = { corners, confidence, areaRatio, rectangularity, angleScore };
      }
    } finally {
      contour.delete();
      approx.delete();
      approxLoose.delete();
    }
  }

  return best;
}

function readMatPoints(mat) {
  const points = [];
  for (let row = 0; row < mat.rows; row += 1) {
    points.push({
      x: mat.intPtr(row, 0)[0],
      y: mat.intPtr(row, 0)[1]
    });
  }
  return points;
}

function orderCorners(points) {
  const ordered = [...points].sort((a, b) => a.y - b.y);
  const top = ordered.slice(0, 2).sort((a, b) => a.x - b.x);
  const bottom = ordered.slice(2, 4).sort((a, b) => a.x - b.x);

  return {
    topLeft: top[0],
    topRight: top[1],
    bottomRight: bottom[1],
    bottomLeft: bottom[0]
  };
}

function scaleCorners(corners, scaleX, scaleY) {
  return Object.fromEntries(
    Object.entries(corners).map(([key, point]) => [
      key,
      {
        x: Math.round(point.x / scaleX),
        y: Math.round(point.y / scaleY)
      }
    ])
  );
}

function calculateBoundaryMetrics(corners, imageWidth, imageHeight) {
  const topWidth = distance(corners.topLeft, corners.topRight);
  const bottomWidth = distance(corners.bottomLeft, corners.bottomRight);
  const leftHeight = distance(corners.topLeft, corners.bottomLeft);
  const rightHeight = distance(corners.topRight, corners.bottomRight);
  const widthPx = (topWidth + bottomWidth) / 2;
  const heightPx = (leftHeight + rightHeight) / 2;
  const polygonArea = Math.abs(shoelaceArea([
    corners.topLeft,
    corners.topRight,
    corners.bottomRight,
    corners.bottomLeft
  ]));

  return {
    widthPx,
    heightPx,
    aspectRatio: widthPx / Math.max(heightPx, 1),
    orientation: widthPx >= heightPx ? 'landscape' : 'portrait',
    areaRatio: polygonArea / Math.max(imageWidth * imageHeight, 1),
    boundingArea: widthPx * heightPx,
    center: {
      x: (corners.topLeft.x + corners.topRight.x + corners.bottomRight.x + corners.bottomLeft.x) / 4,
      y: (corners.topLeft.y + corners.topRight.y + corners.bottomRight.y + corners.bottomLeft.y) / 4
    },
    edgeLengthsPx: {
      top: Math.round(topWidth),
      right: Math.round(rightHeight),
      bottom: Math.round(bottomWidth),
      left: Math.round(leftHeight)
    }
  };
}

function isReasonablePage(metrics) {
  if (metrics.areaRatio < 0.12 || metrics.areaRatio > 0.96) return false;
  if (metrics.aspectRatio < 0.32 || metrics.aspectRatio > 3.1) return false;
  if (metrics.widthPx < 140 || metrics.heightPx < 140) return false;
  return true;
}

function scoreCentered(center, width, height) {
  const dx = Math.abs(center.x - width / 2) / (width / 2);
  const dy = Math.abs(center.y - height / 2) / (height / 2);
  return clamp01(1 - (dx + dy) / 2);
}

function scoreAngles(corners) {
  const points = [corners.topLeft, corners.topRight, corners.bottomRight, corners.bottomLeft];
  const scores = [];

  for (let i = 0; i < points.length; i += 1) {
    const prev = points[(i + points.length - 1) % points.length];
    const current = points[i];
    const next = points[(i + 1) % points.length];
    const angle = angleBetween(prev, current, next);
    scores.push(clamp01(1 - Math.abs(90 - angle) / 45));
  }

  return scores.reduce((sum, value) => sum + value, 0) / scores.length;
}

function angleBetween(a, b, c) {
  const ab = { x: a.x - b.x, y: a.y - b.y };
  const cb = { x: c.x - b.x, y: c.y - b.y };
  const dot = ab.x * cb.x + ab.y * cb.y;
  const magA = Math.hypot(ab.x, ab.y);
  const magC = Math.hypot(cb.x, cb.y);
  const cos = clamp(dot / Math.max(magA * magC, 0.00001), -1, 1);
  return Math.acos(cos) * 180 / Math.PI;
}

function createWorkingCanvas(sourceCanvas, targetMaxDimension) {
  const maxDimension = Math.max(sourceCanvas.width, sourceCanvas.height);
  const scale = Math.min(1, targetMaxDimension / maxDimension);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(sourceCanvas.width * scale);
  canvas.height = Math.round(sourceCanvas.height * scale);

  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.drawImage(sourceCanvas, 0, 0, canvas.width, canvas.height);

  return {
    canvas,
    scaleX: canvas.width / sourceCanvas.width,
    scaleY: canvas.height / sourceCanvas.height
  };
}

function createFailedDetection(reason, message, startedAt, sourceCanvas, workingCanvas = null) {
  return {
    detected: false,
    detectionMode: 'opencv-canny-contour',
    source: 'capture-image',
    status: 'not-detected',
    confidence: 0,
    reason,
    message,
    imageSize: sourceCanvas
      ? { width: sourceCanvas.width, height: sourceCanvas.height }
      : null,
    processingSize: workingCanvas
      ? { width: workingCanvas.width, height: workingCanvas.height }
      : null,
    cornersPx: null,
    orientation: null,
    aspectRatio: null,
    areaRatio: null,
    processingTimeMs: round(performance.now() - startedAt, 2)
  };
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function shoelaceArea(points) {
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    const current = points[i];
    const next = points[(i + 1) % points.length];
    sum += current.x * next.y - next.x * current.y;
  }
  return sum / 2;
}

function safeDelete(value) {
  try {
    value?.delete?.();
  } catch {
    // Ignore OpenCV cleanup errors.
  }
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function clamp01(value) {
  return clamp(value, 0, 1);
}

function round(value, decimals = 2) {
  const factor = 10 ** decimals;
  return Math.round(Number(value || 0) * factor) / factor;
}
