import { analyzeImageQuality } from './ImageQuality.js';
import { getCaptureApiBaseUrl, uploadPageCapture } from './CaptureUploadClient.js';
import { detectPageBoundaryFromCanvas } from '../vision/PageBoundaryDetector.js';
import { createBoundaryPreviewDataUrl } from '../vision/BoundaryPreview.js';

export class CameraCaptureFlow {
  constructor({ root, onComplete }) {
    this.root = root;
    this.onComplete = onComplete;
    this.stream = null;
    this.captureData = null;
    this.errorMessage = '';
    this.instructionsMessage = '';
    this.loadingTitle = '';
    this.loadingDescription = '';
    this.step = 'splash';

    this.container = document.createElement('section');
    this.container.className = 'capture-flow';
    this.root.appendChild(this.container);

    this.render();
  }

  render() {
    switch (this.step) {
      case 'splash':
        this.renderSplash();
        break;
      case 'camera':
        this.renderCamera();
        break;
      case 'review':
        this.renderReview();
        break;
      case 'loading':
        this.renderLoading();
        break;
      case 'instructions':
        this.renderInstructions();
        break;
      case 'uploadError':
        this.renderUploadError();
        break;
      case 'error':
        this.renderError();
        break;
      default:
        this.renderSplash();
    }
  }

  renderSplash() {
    this.container.innerHTML = `
      <div class="capture-card capture-card--center">
        <div class="capture-badge">Prototype</div>
        <h1>AR Storytelling</h1>
        <p>
          Capture the physical book/page first. The image will be uploaded to the backend
          and saved in the <strong>captured_images</strong> folder before AR scanning starts.
        </p>
        <button class="capture-primary" data-action="turnOnCamera">Turn on camera</button>
        <p class="capture-note">
          Use the back camera. Keep the whole page visible with good lighting and minimal shadows.
        </p>
      </div>
    `;

    this.bindActions();
  }

  renderCamera() {
    this.container.innerHTML = `
      <div class="capture-shell">
        <header class="capture-header">
          <div>
            <span>Step 1</span>
            <h2>Capture book/page</h2>
          </div>
          <button class="capture-secondary" data-action="cancelCamera">Back</button>
        </header>

        <div class="camera-frame">
          <video class="camera-video" autoplay playsinline muted></video>
          <div class="page-guide">
            <span class="corner corner-tl"></span>
            <span class="corner corner-tr"></span>
            <span class="corner corner-br"></span>
            <span class="corner corner-bl"></span>
            <div class="page-guide-text">Align full page inside this box</div>
          </div>
        </div>

        <div class="capture-instructions-mini">
          <span>Good light</span>
          <span>Avoid shadows</span>
          <span>Hold steady</span>
          <span>Show all corners</span>
        </div>

        <button class="capture-primary" data-action="capturePhoto">Capture photo</button>
      </div>
    `;

    this.videoEl = this.container.querySelector('.camera-video');
    if (this.stream) {
      this.videoEl.srcObject = this.stream;
      this.videoEl.play().catch(() => {});
    }

    this.bindActions();
  }

  renderReview() {
    const quality = this.captureData.quality;
    const warningItems = quality.warnings.length
      ? quality.warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join('')
      : '<li>Image quality is usable for the next AR scan.</li>';

    this.container.innerHTML = `
      <div class="capture-shell capture-shell--review">
        <header class="capture-header">
          <div>
            <span>Step 2</span>
            <h2>Review capture</h2>
          </div>
          <button class="capture-secondary" data-action="retake">Retake</button>
        </header>

        <img class="capture-preview" src="${this.captureData.boundaryPreviewDataUrl || this.captureData.dataUrl}" alt="Captured book/page with detected boundary" />

        <div class="quality-grid">
          <div><span>Dimensions</span><strong>${quality.width} × ${quality.height}</strong></div>
          <div><span>Status</span><strong>${quality.status}</strong></div>
          <div><span>Lighting</span><strong>${quality.brightness}</strong></div>
          <div><span>Contrast</span><strong>${quality.contrast}</strong></div>
          <div><span>Clarity</span><strong>${quality.clarity}</strong></div>
          <div><span>Boundary</span><strong>${this.getBoundaryStatusLabel()}</strong></div>
        </div>

        ${this.renderBoundaryReview()}

        <ul class="quality-warnings">${warningItems}</ul>

        <p class="capture-note">
          On Continue, this image is uploaded to the backend and saved in
          <strong>backend/captured_images/</strong>.
        </p>

        <div class="capture-actions-split">
          <button class="capture-secondary" data-action="retake">Retake</button>
          <button class="capture-primary" data-action="continueAfterCapture">Continue & save image</button>
        </div>
      </div>
    `;

    this.bindActions();
  }

  renderLoading() {
    const title = this.loadingTitle || 'Saving captured image';
    const description = this.loadingDescription || `Uploading the captured page to the backend. It will be stored in
          <strong>backend/captured_images/</strong> before the AR scan starts.`;

    this.container.innerHTML = `
      <div class="capture-card capture-card--center">
        <div class="loading-spinner"></div>
        <h2>${escapeHtml(title)}</h2>
        <p>${description}</p>
        <p class="capture-note">Backend API: ${escapeHtml(getCaptureApiBaseUrl())}</p>
      </div>
    `;
  }

  renderInstructions() {
    const upload = this.captureData?.upload;
    const savedPath = upload?.storedPath || 'backend/captured_images/';
    const messageBlock = this.instructionsMessage
      ? `<div class="capture-status-message">${escapeHtml(this.instructionsMessage)}</div>`
      : '';

    this.container.innerHTML = `
      <div class="capture-card">
        <div class="capture-badge">Image saved</div>
        <h2>Scan the same book/page</h2>
        ${messageBlock}
        <p>
          Captured image saved successfully at:
          <strong>${escapeHtml(savedPath)}</strong>
        </p>
        <p>
          Keep the same page on a flat surface. Move the phone slowly until the reticle appears.
          Then adjust scale/orientation if needed and double-tap/lock the page plane.
        </p>

        <div class="instruction-list">
          <div><strong>1</strong><span>Keep the whole page visible.</span></div>
          <div><strong>2</strong><span>Use good lighting and avoid shadows.</span></div>
          <div><strong>3</strong><span>Scan slowly until surface tracking is ready.</span></div>
          <div><strong>4</strong><span>Double-tap to lock the anchor before adding characters.</span></div>
        </div>

        <div class="capture-actions-split">
          <button class="capture-secondary" data-action="retake">Retake photo</button>
          <button class="capture-primary" data-action="startARScan">Start AR scan</button>
        </div>
      </div>
    `;

    this.bindActions();
  }

  renderUploadError() {
    this.container.innerHTML = `
      <div class="capture-card capture-card--center">
        <div class="capture-badge capture-badge--danger">Upload error</div>
        <h2>Captured image was not saved</h2>
        <p>${escapeHtml(this.errorMessage || 'Backend upload failed.')}</p>
        <p class="capture-note">
          Start the backend first: <strong>cd backend && uvicorn main:app --reload --port 8000</strong>
        </p>
        <div class="capture-actions-split">
          <button class="capture-secondary" data-action="retake">Retake</button>
          <button class="capture-primary" data-action="retryUpload">Retry save</button>
        </div>
      </div>
    `;

    this.bindActions();
  }

  renderError() {
    this.container.innerHTML = `
      <div class="capture-card capture-card--center">
        <div class="capture-badge capture-badge--danger">Camera error</div>
        <h2>Could not open camera</h2>
        <p>${escapeHtml(this.errorMessage || 'Camera permission was blocked or no camera is available.')}</p>
        <button class="capture-primary" data-action="turnOnCamera">Try again</button>
        <button class="capture-secondary" data-action="backToSplash">Back</button>
      </div>
    `;

    this.bindActions();
  }


  renderBoundaryReview() {
    const detection = this.captureData?.pageBoundaryDetection;

    if (!detection) {
      return '';
    }

    if (!detection.detected) {
      return `
        <div class="boundary-review boundary-review--warning">
          <strong>Automatic page boundary not confirmed</strong>
          <span>${escapeHtml(detection.message || 'The system could not detect the page corners clearly.')}</span>
          <span>Recommended: retake with all four page corners visible.</span>
        </div>
      `;
    }

    return `
      <div class="boundary-review boundary-review--success">
        <strong>Automatic page boundary detected</strong>
        <span>Confidence: ${Math.round((detection.confidence || 0) * 100)}% · ${escapeHtml(detection.orientation)} · aspect ratio ${detection.aspectRatio}</span>
        <span>This detected shape will be used to size the WebXR page anchor before Phase 4 objects are placed.</span>
      </div>
    `;
  }

  getBoundaryStatusLabel() {
    const detection = this.captureData?.pageBoundaryDetection;
    if (!detection) return 'not checked';
    if (!detection.detected) return 'not detected';
    return `${Math.round((detection.confidence || 0) * 100)}%`;
  }

  bindActions() {
    this.container.querySelectorAll('[data-action]').forEach((button) => {
      button.addEventListener('click', () => this.handleAction(button.dataset.action));
    });
  }

  async handleAction(action) {
    switch (action) {
      case 'turnOnCamera':
        await this.startCamera();
        break;
      case 'capturePhoto':
        await this.capturePhoto();
        break;
      case 'continueAfterCapture':
      case 'retryUpload':
        await this.saveCaptureThenShowInstructions();
        break;
      case 'startARScan':
        this.complete();
        break;
      case 'retake':
        await this.startCamera();
        break;
      case 'cancelCamera':
      case 'backToSplash':
        this.stopCamera();
        this.step = 'splash';
        this.render();
        break;
      default:
        break;
    }
  }

  async startCamera() {
    try {
      this.instructionsMessage = '';
      this.show();
      this.stopCamera();
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 }
        }
      });

      this.step = 'camera';
      this.render();
    } catch (error) {
      this.errorMessage = error?.message || String(error);
      this.step = 'error';
      this.render();
    }
  }

  async capturePhoto() {
    if (!this.videoEl || !this.videoEl.videoWidth || !this.videoEl.videoHeight) {
      this.errorMessage = 'Camera stream is not ready yet. Wait one second and try again.';
      this.step = 'error';
      this.render();
      return;
    }

    const canvas = document.createElement('canvas');
    canvas.width = this.videoEl.videoWidth;
    canvas.height = this.videoEl.videoHeight;
    const context = canvas.getContext('2d');
    context.drawImage(this.videoEl, 0, 0, canvas.width, canvas.height);

    const quality = analyzeImageQuality(canvas);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.88);
    const blob = await canvasToBlob(canvas, 'image/jpeg', 0.88);
    const id = `capture_${new Date().toISOString().replace(/[:.]/g, '-')}`;

    this.stopCamera();
    this.loadingTitle = 'Analyzing page boundary';
    this.loadingDescription = 'Running OpenCV.js Canny edge detection and four-corner page contour detection.';
    this.step = 'loading';
    this.render();
    await waitOneFrame();

    const pageBoundaryDetection = await withTimeout(
      detectPageBoundaryFromCanvas(canvas),
      8000,
      {
        detected: false,
        detectionMode: 'opencv-canny-contour',
        source: 'capture-image',
        status: 'not-detected',
        confidence: 0,
        reason: 'timeout',
        message: 'Boundary detection took too long. You can continue with manual WebXR page sizing.',
        imageSize: { width: canvas.width, height: canvas.height },
        cornersPx: null,
        orientation: null,
        aspectRatio: null
      }
    );

    let boundaryPreviewDataUrl = dataUrl;
    try {
      boundaryPreviewDataUrl = await createBoundaryPreviewDataUrl(dataUrl, pageBoundaryDetection);
    } catch (error) {
      console.warn('Boundary preview generation failed:', error);
    }

    this.captureData = {
      id,
      timestampMs: performance.now(),
      dataUrl,
      boundaryPreviewDataUrl,
      blob,
      quality,
      pageBoundaryDetection,
      upload: null,
      image: {
        width: canvas.width,
        height: canvas.height,
        format: 'image/jpeg',
        storageMode: 'pending-backend-upload',
        targetFolder: 'backend/captured_images'
      }
    };

    this.loadingTitle = '';
    this.loadingDescription = '';
    this.step = 'review';
    this.render();
  }

  async saveCaptureThenShowInstructions() {
    if (!this.captureData) {
      this.errorMessage = 'No capture found. Capture the page again.';
      this.step = 'uploadError';
      this.render();
      return;
    }

    this.loadingTitle = 'Saving captured image';
    this.loadingDescription = `Uploading the captured page to the backend. It will be stored in
          <strong>backend/captured_images/</strong> before the AR scan starts.`;
    this.step = 'loading';
    this.render();

    try {
      const uploadResult = await uploadPageCapture(this.captureData);
      this.captureData.upload = uploadResult;
      this.captureData.image = {
        ...this.captureData.image,
        storageMode: 'backend-captured_images',
        saved: true,
        storedPath: uploadResult.storedPath,
        publicUrl: uploadResult.publicUrl,
        filename: uploadResult.filename
      };

      this.loadingTitle = '';
      this.loadingDescription = '';
      this.step = 'instructions';
      this.render();
    } catch (error) {
      this.errorMessage = error?.message || String(error);
      this.step = 'uploadError';
      this.render();
    }
  }

  complete() {
    this.stopCamera();
    this.hide();
    this.onComplete?.(this.captureData);
  }

  showInstructionsAgain(message = '') {
    this.stopCamera();
    this.instructionsMessage = message;
    this.step = 'instructions';
    this.show();
    this.render();
  }

  hide() {
    this.container.classList.add('is-complete');
  }

  show() {
    this.container.classList.remove('is-complete');
  }

  stopCamera() {
    if (!this.stream) return;
    this.stream.getTracks().forEach((track) => track.stop());
    this.stream = null;
  }
}

function waitOneFrame() {
  return new Promise((resolve) => window.requestAnimationFrame(() => resolve()));
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), type, quality);
  });
}


function withTimeout(promise, timeoutMs, fallbackValue) {
  return Promise.race([
    promise,
    new Promise((resolve) => {
      window.setTimeout(() => resolve(fallbackValue), timeoutMs);
    })
  ]);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
