const ANIMATION_API_BASE_URL = (
  import.meta.env.VITE_ANIMATION_API_URL || 'https://paulita-nonoptimistical-fae.ngrok-free.dev'
).replace(/\/$/, '');

// In dev, route through Vite's server proxy so the request is server-to-server:
//   - no CORS preflight (same-origin from the browser's perspective)
//   - no ngrok interstitial (proxy adds ngrok-skip-browser-warning server-side)
// In production, call the backend directly (Flask must have CORS configured).
const ANIMATION_FETCH_URL = import.meta.env.DEV
  ? '/animation-proxy/animate'
  : `${ANIMATION_API_BASE_URL}/animate`;

export function getAnimationApiUrl() {
  return ANIMATION_API_BASE_URL;
}

/**
 * POST the captured image to the animation backend.
 * Returns an array of { glbUrl, glbBlob } objects — one per animated GLB received.
 */
export async function uploadImageAndGetAnimation(captureData) {
  if (!captureData?.blob) {
    throw new Error('No captured image blob. Capture the page again.');
  }

  const formData = new FormData();
  // Field name must be exactly "image" — Flask /animate checks request.files["image"].
  formData.append('image', captureData.blob, `${captureData.id}.jpg`);

  // Pipeline runs 3-8 minutes; set a generous timeout so the browser doesn't abort early.
  const response = await fetch(ANIMATION_FETCH_URL, {
    method: 'POST',
    body: formData,
    signal: AbortSignal.timeout(10 * 60 * 1000)
  });

  if (!response.ok) {
    let message = `Animation server returned HTTP ${response.status}`;
    try {
      const errorBody = await response.json();
      message = errorBody?.detail || errorBody?.message || message;
    } catch {
      // Keep default message if response body is not JSON.
    }
    throw new Error(message);
  }

  return parseAnimationResponse(response);
}

async function parseAnimationResponse(response) {
  const contentType = response.headers.get('content-type') || '';

  if (isGLBContentType(contentType)) {
    const blob = await response.blob();
    return [{ glbUrl: URL.createObjectURL(blob), glbBlob: blob }];
  }

  if (contentType.includes('application/json')) {
    const json = await response.json();
    return extractGLBsFromJSON(json);
  }

  // Unknown content-type — attempt to treat body as binary GLB.
  const blob = await response.blob();
  return [{ glbUrl: URL.createObjectURL(blob), glbBlob: blob }];
}

function isGLBContentType(contentType) {
  return (
    contentType.includes('model/gltf-binary') ||
    contentType.includes('application/octet-stream')
  );
}

function extractGLBsFromJSON(json) {
  // Array of URL strings or { url } objects
  if (Array.isArray(json)) {
    return json
      .map((item) => ({
        glbUrl: typeof item === 'string' ? item : (item.url || item.glbUrl || item.glb_url),
        glbBlob: null,
        id: item.char_id || item.id || undefined
      }))
      .filter((item) => Boolean(item.glbUrl));
  }

  // Single GLB URL in known field names
  const url =
    json.glbUrl ||
    json.glb_url ||
    json.url ||
    json.animated_glb_url ||
    json.animatedGlbUrl;

  if (url) {
    return [{ glbUrl: url, glbBlob: null }];
  }

  // Multiple named GLBs as object values ending in .glb/.gltf
  const glbs = [];
  for (const [key, value] of Object.entries(json)) {
    if (typeof value === 'string' && /\.(glb|gltf)(\?|$)/i.test(value)) {
      glbs.push({ glbUrl: value, glbBlob: null, id: key });
    }
  }
  if (glbs.length) return glbs;

  throw new Error('Animation server responded but no GLB URL was found in the response. Check the backend API contract.');
}
