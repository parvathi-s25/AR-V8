const DEFAULT_CAPTURE_API_BASE_URL = 'http://localhost:8000';

export function getCaptureApiBaseUrl() {
  return (import.meta.env.VITE_CAPTURE_API_BASE_URL || DEFAULT_CAPTURE_API_BASE_URL).replace(/\/$/, '');
}

export async function uploadPageCapture(captureData) {
  if (!captureData?.blob) {
    throw new Error('No captured image blob found. Capture the page again.');
  }

  const apiBaseUrl = getCaptureApiBaseUrl();
  const formData = new FormData();
  const filename = `${captureData.id}.jpg`;

  formData.append('image', captureData.blob, filename);
  formData.append(
    'metadata',
    JSON.stringify({
      id: captureData.id,
      timestampMs: captureData.timestampMs,
      image: captureData.image,
      quality: captureData.quality,
      pageBoundaryDetection: captureData.pageBoundaryDetection || null
    })
  );

  const response = await fetch(`${apiBaseUrl}/api/captures/page`, {
    method: 'POST',
    body: formData
  });

  if (!response.ok) {
    let message = `Upload failed with HTTP ${response.status}`;
    try {
      const errorBody = await response.json();
      message = errorBody?.detail || errorBody?.message || message;
    } catch {
      // Keep default message.
    }
    throw new Error(message);
  }

  return response.json();
}
