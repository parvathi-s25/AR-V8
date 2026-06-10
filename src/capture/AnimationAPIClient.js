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
 * Returns { story, characters, timeline } — see extractAnimationResult for the shape.
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

  const result = await parseAnimationResponse(response);
  console.log('[AnimationAPIClient] Parsed /animate result:', result);

  // Pre-fetch each GLB through the proxy so GLTFLoader gets a same-origin blob: URL.
  // Without this, GLTFLoader hits ngrok directly, gets the HTML interstitial, and fails.
  result.characters = await fetchGLBsAsBlobs(result.characters);
  console.log('[AnimationAPIClient] Characters after GLB pre-fetch:', result.characters);
  return result;
}

async function parseAnimationResponse(response) {
  const contentType = response.headers.get('content-type') || '';

  if (isGLBContentType(contentType)) {
    const blob = await response.blob();
    return singleBlobResult(blob);
  }

  if (contentType.includes('application/json')) {
    const json = await response.json();
    console.log('[AnimationAPIClient] Raw /animate JSON response:', json);
    return extractAnimationResult(json);
  }

  // Unknown content-type — attempt to treat body as binary GLB.
  const blob = await response.blob();
  return singleBlobResult(blob);
}

function singleBlobResult(blob) {
  return {
    story: null,
    timeline: null,
    characters: [{ id: undefined, name: undefined, glbUrl: URL.createObjectURL(blob), glbBlob: blob, position: null, rotationY: 0 }]
  };
}

// Fetch each GLB item as a blob through the Vite proxy (dev) or directly (prod).
// Returns the same array but with glbUrl replaced by a blob: URL so GLTFLoader
// can load it as same-origin — no CORS, no ngrok interstitial.
async function fetchGLBsAsBlobs(items) {
  return Promise.all(
    items.map(async (item) => {
      if (item.glbBlob) {
        return item; // already a local blob, nothing to do
      }
      const fetchUrl = import.meta.env.DEV ? toProxyPath(item.glbUrl) : item.glbUrl;
      try {
        const res = await fetch(fetchUrl, { signal: AbortSignal.timeout(5 * 60 * 1000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        console.log(`[AnimationAPIClient] GLB fetched for ${item.id || '(no id)'}: ${fetchUrl} -> ${blob.size} bytes, type=${blob.type || '(none)'}`);
        return { ...item, glbBlob: blob, glbUrl: URL.createObjectURL(blob) };
      } catch (err) {
        console.error(`[AnimationAPIClient] GLB fetch failed for ${item.id || '(no id)'} (${fetchUrl}). GLTFLoader will try the original URL directly, which will likely fail too:`, err);
        return item;
      }
    })
  );
}

// Rewrite an absolute ngrok URL to go through the Vite dev proxy.
// e.g. https://foo.ngrok.app/cache/animated_glb/x.glb → /animation-proxy/cache/animated_glb/x.glb
function toProxyPath(url) {
  try {
    const { pathname, search } = new URL(url);
    return `/animation-proxy${pathname}${search}`;
  } catch {
    return url;
  }
}

function isGLBContentType(contentType) {
  return (
    contentType.includes('model/gltf-binary') ||
    contentType.includes('application/octet-stream')
  );
}

/**
 * Normalize the /animate JSON body into { story, characters, timeline }.
 *
 * Documented contract:
 *   {
 *     story: "title string",
 *     characters: [{ char_id, name, url, position: [x, y, z], rotation_y, animation? }],
 *     timeline: [{ start_time, end_time, char_id, voiceover, simultaneous }]
 *   }
 *
 * `animation` (optional) names the GLB animation clip to play for that character —
 * StoryCharacterRenderer maps this to the loaded model's AnimationClip names.
 *
 * Each returned character is { id, name, glbUrl, glbBlob, position: {x,y,z}|null, rotationY, animation: string|null }.
 * Each returned timeline event is { startTime, endTime, characterId, voiceover, simultaneous }.
 */
function extractAnimationResult(json) {
  if (json && Array.isArray(json.characters)) {
    const characters = json.characters
      .map((item) => ({
        id: item.char_id || item.id,
        name: item.name || item.char_id || item.id,
        glbUrl: resolveGlbUrl(item.url || item.glbUrl || item.glb_url),
        glbBlob: null,
        position: toPositionXYZ(item.position),
        rotationY: Number(item.rotation_y ?? item.rotationY ?? 0),
        animation: item.animation || item.animation_name || item.animationName || null
      }))
      .filter((item) => Boolean(item.glbUrl));

    if (!characters.length) {
      throw new Error('Animation server responded but no character GLB URLs were found. Check the backend API contract.');
    }

    const timeline = Array.isArray(json.timeline)
      ? json.timeline.map((event) => ({
          startTime: Number(event.start_time ?? 0),
          endTime: Number(event.end_time ?? 0),
          characterId: event.char_id || event.id,
          voiceover: event.voiceover || '',
          simultaneous: Boolean(event.simultaneous)
        }))
      : null;

    return { story: json.story || null, characters, timeline };
  }

  // Legacy: array of URL strings or { url } objects
  if (Array.isArray(json)) {
    const characters = json
      .map((item) => ({
        id: item.char_id || item.id,
        name: item.name || item.char_id || item.id,
        glbUrl: resolveGlbUrl(typeof item === 'string' ? item : (item.url || item.glbUrl || item.glb_url)),
        glbBlob: null,
        position: null,
        rotationY: 0
      }))
      .filter((item) => Boolean(item.glbUrl));

    if (!characters.length) {
      throw new Error('Animation server responded but no GLB URL was found in the response. Check the backend API contract.');
    }
    return { story: null, characters, timeline: null };
  }

  // Single GLB URL in known field names
  const url =
    json.glbUrl ||
    json.glb_url ||
    json.url ||
    json.animated_glb_url ||
    json.animatedGlbUrl;

  if (url) {
    return { story: null, characters: [{ id: undefined, name: undefined, glbUrl: resolveGlbUrl(url), glbBlob: null, position: null, rotationY: 0 }], timeline: null };
  }

  // Multiple named GLBs as object values ending in .glb/.gltf
  const glbs = [];
  for (const [key, value] of Object.entries(json)) {
    if (typeof value === 'string' && /\.(glb|gltf)(\?|$)/i.test(value)) {
      glbs.push({ id: key, name: key, glbUrl: resolveGlbUrl(value), glbBlob: null, position: null, rotationY: 0 });
    }
  }
  if (glbs.length) {
    return { story: null, characters: glbs, timeline: null };
  }

  throw new Error('Animation server responded but no GLB URL was found in the response. Check the backend API contract.');
}

function toPositionXYZ(position) {
  if (!Array.isArray(position) || position.length < 3) return null;
  const [x, y, z] = position;
  return { x: Number(x) || 0, y: Number(y) || 0, z: Number(z) || 0 };
}

// Backend may return either an absolute URL (https://.../cache/animated_glb/x.glb)
// or a path relative to the animation API (/cache/animated_glb/x.glb). Resolve the
// latter against ANIMATION_API_BASE_URL so toProxyPath/fetch see a real host+path.
function resolveGlbUrl(url) {
  if (!url) return url;
  try {
    return new URL(url, `${ANIMATION_API_BASE_URL}/`).toString();
  } catch {
    return url;
  }
}
