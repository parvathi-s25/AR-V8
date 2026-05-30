export class ARBootOverlay {
  constructor({ root, appState, onStartARRequest }) {
    this.root = root;
    this.appState = appState;
    this.onStartARRequest = onStartARRequest;
    this.mode = 'hidden';
    this.errorMessage = '';

    this.container = document.createElement('section');
    this.container.className = 'ar-boot-overlay';
    this.root.appendChild(this.container);

    this.appState.addEventListener('change', () => this.render());
    this.render();
  }

  showStarting() {
    this.mode = 'starting';
    this.errorMessage = '';
    document.body.classList.add('ar-booting-active');
    this.render();
  }

  showUnsupported(message) {
    this.mode = 'unsupported';
    this.errorMessage = message || 'WebXR AR is not available on this device/browser.';
    document.body.classList.add('ar-booting-active');
    this.render();
  }

  hide() {
    this.mode = 'hidden';
    this.errorMessage = '';
    document.body.classList.remove('ar-booting-active');
    this.render();
  }

  render() {
    if (this.mode === 'hidden') {
      this.container.classList.remove('is-visible');
      this.container.innerHTML = '';
      return;
    }

    const isXRActive = this.appState.isXRActive;
    const hitVisible = this.appState.hitVisible;
    const pageLocked = this.appState.pageLocked;

    if (this.mode !== 'unsupported' && (hitVisible || pageLocked)) {
      this.hide();
      return;
    }

    const content = this.mode === 'unsupported'
      ? this.renderUnsupportedContent()
      : this.renderBootingContent({ isXRActive, hitVisible });

    this.container.classList.add('is-visible');
    this.container.innerHTML = content;
    this.bindActions();
  }

  bindActions() {
    this.container.querySelectorAll('[data-ar-boot-action]').forEach((button) => {
      button.addEventListener('click', () => {
        if (button.dataset.arBootAction === 'startAR') {
          this.onStartARRequest?.();
        }
      });
    });
  }

  renderBootingContent({ isXRActive }) {
    const title = isXRActive ? 'Detecting page plane' : 'Starting AR scan';
    const statusText = isXRActive
      ? 'AR session started. Keep moving slowly until the reticle appears on the book/table surface.'
      : 'Allow AR/camera permission if prompted. The scan will continue after WebXR starts.';

    const activeStep = isXRActive ? 2 : 1;

    return `
      <div class="ar-boot-card">
        <div class="loading-spinner"></div>
        <div class="capture-badge">Phase 2/3 loading</div>
        <h2>${title}</h2>
        <p>${statusText}</p>
        ${!isXRActive ? `
          <button class="capture-primary ar-boot-start-button" data-ar-boot-action="startAR">Start AR now</button>
          <p class="capture-note">If the AR permission prompt did not open automatically, tap this button once.</p>
        ` : ''}

        <div class="ar-boot-progress">
          <div class="${activeStep >= 1 ? 'is-active' : ''}">
            <strong>1</strong>
            <span>Start WebXR AR session</span>
          </div>
          <div class="${activeStep >= 2 ? 'is-active' : ''}">
            <strong>2</strong>
            <span>Find flat book/table plane</span>
          </div>
          <div>
            <strong>3</strong>
            <span>Show reticle, then lock page</span>
          </div>
        </div>

        <div class="instruction-list ar-boot-instructions">
          <div><strong>✓</strong><span>Point camera at the same book/page you captured.</span></div>
          <div><strong>✓</strong><span>Move slowly left/right and closer/farther.</span></div>
          <div><strong>✓</strong><span>Use good lighting. Avoid shadows and glossy reflections.</span></div>
          <div><strong>✓</strong><span>Wait until the loading screen disappears and reticle becomes visible.</span></div>
        </div>
      </div>
    `;
  }

  renderUnsupportedContent() {
    return `
      <div class="ar-boot-card ar-boot-card--error">
        <div class="capture-badge capture-badge--danger">AR unavailable</div>
        <h2>WebXR AR could not start</h2>
        <p>${escapeHtml(this.errorMessage)}</p>
        <p class="capture-note">
          Use Android Chrome on an ARCore-supported phone. Desktop and unsupported phones can still use mock mode.
        </p>
      </div>
    `;
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
