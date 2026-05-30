export class DebugPanel {
  constructor({ root, appState, actions }) {
    this.root = root;
    this.appState = appState;
    this.actions = actions;
    this.forceDebugOpenInAR = false;

    this.container = document.createElement('section');
    this.container.className = 'debug-panel';
    this.root.appendChild(this.container);

    this.arHud = document.createElement('section');
    this.arHud.className = 'ar-hud';
    this.root.appendChild(this.arHud);

    this.appState.addEventListener('change', () => this.render());
    this.render();
  }

  render() {
    const contracts = this.appState.getContracts();
    const confidence = contracts.trackingConfidence;
    const hasPage = Boolean(contracts.pageBoundary);
    const locked = Boolean(contracts.pageLocked);
    const canPlace = Boolean(this.appState.lastHitMatrix) && !locked;
    const orientation = contracts.pageOrientation || 'not set';
    const xrActive = Boolean(contracts.xrActive);
    const shouldHidePanelInAR = xrActive && !this.forceDebugOpenInAR;

    this.container.classList.toggle('is-hidden-in-ar', shouldHidePanelInAR);
    this.renderFullPanel({ contracts, confidence, hasPage, locked, canPlace, xrActive, orientation });
    this.renderARHud({ contracts, confidence, hasPage, locked, canPlace, xrActive, orientation });
  }

  renderFullPanel({ contracts, confidence, hasPage, locked, canPlace, xrActive, orientation }) {
    const arPanelControls = xrActive
      ? `
        <div class="ar-panel-warning">
          <strong>AR session is active.</strong>
          <span>The full debug panel is covering the camera view.</span>
          <button data-action="hidePanel" class="secondary">Hide debug panel</button>
        </div>
      `
      : '';

    this.container.innerHTML = `
      <h1>AR Storytelling — Phase 2/3 MVP</h1>
      <p>
        Phase 1A capture intake + Phase 3.5 OpenCV/Canny page boundary detection + WebXR hit-test placement.
      </p>

      ${arPanelControls}

      <div class="status-grid">
        <div class="status-card">
          <span>XR session</span>
          <strong>${contracts.xrActive ? 'active' : 'not active'}</strong>
        </div>
        <div class="status-card">
          <span>Hit test</span>
          <strong>${contracts.latestHit?.visible ? 'visible' : contracts.latestHit ? 'last pose saved' : 'not ready'}</strong>
        </div>
        <div class="status-card">
          <span>Page</span>
          <strong>${hasPage ? (locked ? 'locked' : 'placed') : 'not placed'}</strong>
        </div>
        <div class="status-card">
          <span>Overall</span>
          <strong>${confidence.overall.state} (${confidence.overall.confidence})</strong>
        </div>
      </div>

      ${this.renderBoundarySummary(contracts)}

      <div class="button-row">
        <button data-action="place" ${canPlace ? '' : 'disabled'}>${locked ? 'Page locked' : 'Lock page from reticle'}</button>
        <button data-action="mock" class="secondary" ${xrActive ? 'disabled' : ''}>Mock place page</button>
        <button data-action="reset" class="danger" ${hasPage ? '' : 'disabled'}>Reset page</button>
      </div>

      <p class="footer-note">
        Real AR: after the capture flow, press START AR if it does not open automatically, scan a flat book/table until the reticle appears, then double-tap the screen or use Lock page. Press Reset page to scan again.
      </p>

      <div class="control-section">
        <h2>Scale</h2>
        <div class="button-row">
        <button data-action="widthMinus" ${hasPage ? '' : 'disabled'}>Width −</button>
        <button data-action="widthPlus" ${hasPage ? '' : 'disabled'}>Width +</button>
        <button data-action="heightMinus" ${hasPage ? '' : 'disabled'}>Height −</button>
        <button data-action="heightPlus" ${hasPage ? '' : 'disabled'}>Height +</button>
        </div>
      </div>

      <div class="control-section">
        <h2>Orientation <span>${orientation}</span></h2>
        <div class="button-row">
          <button data-action="portrait" ${hasPage ? '' : 'disabled'}>Portrait</button>
          <button data-action="landscape" ${hasPage ? '' : 'disabled'}>Landscape</button>
          <button data-action="swapOrientation" ${hasPage ? '' : 'disabled'}>Swap orientation</button>
        </div>
      </div>

      <div class="control-section">
        <h2>Debug actor clamp</h2>
      <div class="control-grid">
        <button data-action="moveLeft" ${hasPage ? '' : 'disabled'}>← X</button>
        <button data-action="moveForward" ${hasPage ? '' : 'disabled'}>↑ Z</button>
        <button data-action="moveBackward" ${hasPage ? '' : 'disabled'}>↓ Z</button>
        <button data-action="moveRight" ${hasPage ? '' : 'disabled'}>X →</button>
      </div>
      </div>

      <div class="button-row">
        <button data-action="randomClamp" ${hasPage ? '' : 'disabled'}>Send outside + clamp</button>
        <button data-action="copyJson" class="secondary">Copy JSON</button>
      </div>

      ${this.renderPhase4Summary(contracts)}

      <pre class="json-box">${escapeHtml(JSON.stringify(contracts, null, 2))}</pre>
    `;

    this.container.querySelectorAll('button[data-action]').forEach((button) => {
      button.addEventListener('click', () => this.handleAction(button.dataset.action));
    });
  }



  renderBoundarySummary(contracts) {
    const detection = contracts.pageCapture?.pageBoundaryDetection;

    if (!detection) {
      return `
        <div class="boundary-debug-summary boundary-debug-summary--neutral">
          <strong>Phase 3.5 boundary</strong>
          <span>No capture boundary metadata yet.</span>
        </div>
      `;
    }

    if (!detection.detected) {
      return `
        <div class="boundary-debug-summary boundary-debug-summary--warning">
          <strong>Phase 3.5 boundary</strong>
          <span>Not detected: ${escapeHtml(detection.message || detection.reason || 'unknown')}</span>
        </div>
      `;
    }

    return `
      <div class="boundary-debug-summary boundary-debug-summary--success">
        <strong>Phase 3.5 boundary</strong>
        <span>${escapeHtml(detection.detectionMode)} · ${Math.round((detection.confidence || 0) * 100)}% · ${escapeHtml(detection.orientation)} · aspect ${detection.aspectRatio}</span>
      </div>
    `;
  }

  renderPhase4Summary(contracts) {
    const characters = contracts.phase4Characters || [];
    const rows = characters.length
      ? characters.map((character) => `
        <tr>
          <td>${escapeHtml(character.name || character.id)}</td>
          <td>${escapeHtml(character.state || 'idle')}</td>
          <td>${escapeHtml(character.animation || 'fallback')}</td>
          <td>${character.localPosition ? `${character.localPosition.x}, ${character.localPosition.z}` : '-'}</td>
        </tr>
      `).join('')
      : '<tr><td colspan="4">Waiting for page lock. Fallback character will appear after the page is locked.</td></tr>';

    return `
      <div class="phase4-summary">
        <h2>Phase 4 renderer MVP</h2>
        <p>Loads a story timeline and places GLB/GLTF-ready characters on the locked page. If no GLB is provided, a placeholder character is used.</p>
        <table>
          <thead><tr><th>Character</th><th>State</th><th>Animation</th><th>Local X/Z</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;
  }

  renderARHud({ contracts, confidence, hasPage, locked, canPlace, xrActive, orientation }) {
    this.arHud.classList.toggle('is-visible', xrActive && !this.forceDebugOpenInAR);

    if (!xrActive || this.forceDebugOpenInAR) {
      this.arHud.innerHTML = '';
      return;
    }

    const hitLabel = locked ? 'plane locked' : contracts.latestHit?.visible ? 'hit visible' : 'scan surface';
    const pageLabel = hasPage ? (locked ? 'page locked' : 'page placed') : 'page not placed';

    this.arHud.innerHTML = `
      <div class="ar-hud__text">
        <strong>AR active</strong>
        <span>${hitLabel} · ${pageLabel} · ${orientation} · double-tap to lock · ${confidence.overall.state}</span>
      </div>
      <div class="ar-hud__actions">
        <button data-ar-action="place" ${canPlace ? '' : 'disabled'}>${locked ? 'Locked' : 'Lock page'}</button>
        <button data-ar-action="reset" class="secondary" ${hasPage ? '' : 'disabled'}>Reset</button>
        <button data-ar-action="showDebug" class="secondary">Debug</button>
      </div>
    `;

    this.arHud.querySelectorAll('button[data-ar-action]').forEach((button) => {
      button.addEventListener('click', () => this.handleARHudAction(button.dataset.arAction));
    });
  }

  async handleAction(action) {
    switch (action) {
      case 'place':
        this.actions.placePage();
        break;
      case 'mock':
        this.actions.placeMockPage();
        break;
      case 'reset':
        this.actions.resetPage();
        break;
      case 'widthMinus':
        this.actions.resizePage({ deltaWidth: -0.02 });
        break;
      case 'widthPlus':
        this.actions.resizePage({ deltaWidth: 0.02 });
        break;
      case 'heightMinus':
        this.actions.resizePage({ deltaHeight: -0.02 });
        break;
      case 'heightPlus':
        this.actions.resizePage({ deltaHeight: 0.02 });
        break;
      case 'portrait':
        this.actions.setOrientation('portrait');
        break;
      case 'landscape':
        this.actions.setOrientation('landscape');
        break;
      case 'swapOrientation':
        this.actions.swapOrientation();
        break;
      case 'moveLeft':
        this.actions.moveActor(-0.025, 0);
        break;
      case 'moveRight':
        this.actions.moveActor(0.025, 0);
        break;
      case 'moveForward':
        this.actions.moveActor(0, -0.025);
        break;
      case 'moveBackward':
        this.actions.moveActor(0, 0.025);
        break;
      case 'randomClamp':
        this.actions.randomClamp();
        break;
      case 'copyJson':
        await this.copyContracts();
        break;
      case 'hidePanel':
        this.forceDebugOpenInAR = false;
        this.render();
        break;
      default:
        break;
    }
  }

  handleARHudAction(action) {
    switch (action) {
      case 'place':
        this.actions.placePage();
        break;
      case 'reset':
        this.actions.resetPage();
        break;
      case 'showDebug':
        this.forceDebugOpenInAR = true;
        this.render();
        break;
      default:
        break;
    }
  }

  async copyContracts() {
    const text = JSON.stringify(this.appState.getContracts(), null, 2);

    try {
      await navigator.clipboard.writeText(text);
    } catch {
      console.warn('Clipboard copy failed. This usually requires HTTPS or user gesture support.');
    }
  }
}

function escapeHtml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
