const DEFAULT_LOCAL_OPENCV_URL = '/vendor/opencv/opencv.js';
const DEFAULT_CDN_OPENCV_URL = 'https://docs.opencv.org/4.x/opencv.js';

let opencvPromise = null;

export function isOpenCVReady() {
  return Boolean(window.cv && window.cv.Mat && window.cv.imread && window.cv.Canny);
}

export async function loadOpenCV({
  localUrl = DEFAULT_LOCAL_OPENCV_URL,
  fallbackUrl = DEFAULT_CDN_OPENCV_URL,
  timeoutMs = 6500
} = {}) {
  if (isOpenCVReady()) {
    return window.cv;
  }

  if (opencvPromise) {
    return opencvPromise;
  }

  opencvPromise = loadWithFallback({ localUrl, fallbackUrl, timeoutMs }).catch((error) => {
    opencvPromise = null;
    throw error;
  });

  return opencvPromise;
}

async function loadWithFallback({ localUrl, fallbackUrl, timeoutMs }) {
  try {
    return await loadSingleOpenCVScript(localUrl, timeoutMs);
  } catch (localError) {
    console.warn(`OpenCV.js local load failed from ${localUrl}. Trying CDN fallback.`, localError);
    return loadSingleOpenCVScript(fallbackUrl, timeoutMs);
  }
}

function loadSingleOpenCVScript(src, timeoutMs) {
  return new Promise((resolve, reject) => {
    if (isOpenCVReady()) {
      resolve(window.cv);
      return;
    }

    const existing = Array.from(document.scripts).find((script) => script.src.includes(src));
    const script = existing || document.createElement('script');
    let settled = false;

    const cleanup = () => {
      window.clearTimeout(timeoutId);
      script.removeEventListener('error', onError);
      script.removeEventListener('load', onLoad);
    };

    const finishResolve = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(window.cv);
    };

    const finishReject = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };

    const waitForRuntime = () => {
      if (isOpenCVReady()) {
        finishResolve();
        return;
      }

      if (window.cv) {
        const previousInitializer = window.cv.onRuntimeInitialized;
        window.cv.onRuntimeInitialized = () => {
          if (typeof previousInitializer === 'function') {
            previousInitializer();
          }
          if (isOpenCVReady()) {
            finishResolve();
          } else {
            finishReject(new Error('OpenCV.js loaded but required APIs are unavailable.'));
          }
        };
        return;
      }

      finishReject(new Error(`OpenCV.js did not expose window.cv from ${src}`));
    };

    const onLoad = () => waitForRuntime();
    const onError = () => finishReject(new Error(`Failed to load OpenCV.js from ${src}`));

    const timeoutId = window.setTimeout(() => {
      finishReject(new Error(`Timed out loading OpenCV.js from ${src}`));
    }, timeoutMs);

    script.addEventListener('load', onLoad);
    script.addEventListener('error', onError);

    if (!existing) {
      script.async = true;
      script.src = src;
      document.head.appendChild(script);
    } else {
      waitForRuntime();
    }
  });
}
