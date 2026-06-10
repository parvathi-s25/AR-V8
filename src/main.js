import './styles.css';

import * as THREE from 'three';
import { ARButton } from 'three/addons/webxr/ARButton.js';

import { AppState } from './core/AppState.js';
import { WebXRHitTestManager } from './webxr/WebXRHitTestManager.js';
import { createCamera, createDesktopGrid, createRenderer, createReticle, createScene } from './render/SceneFactory.js';
import { DebugPageRenderer } from './render/DebugPageRenderer.js';
import { StoryCharacterRenderer } from './render/StoryCharacterRenderer.js';
import { DebugPanel } from './ui/DebugPanel.js';
import { CameraCaptureFlow } from './capture/CameraCaptureFlow.js';
import { ARBootOverlay } from './ui/ARBootOverlay.js';

class ARStorytellingOptionAApp {
  constructor() {
    this.container = document.querySelector('#app');
    this.uiRoot = document.querySelector('#ui-root');

    this.state = new AppState();
    this.scene = createScene();
    this.camera = createCamera();
    this.renderer = createRenderer(this.container);

    this.reticle = createReticle();
    this.scene.add(this.reticle);

    this.desktopGrid = createDesktopGrid();
    this.scene.add(this.desktopGrid);

    this.debugPageRenderer = new DebugPageRenderer(this.scene);
    this.storyCharacterRenderer = new StoryCharacterRenderer(this.scene, {
      storyUrl: '/story/demo-scene.json',
      onCharactersUpdate: (characters) => this.state.setPhase4Characters(characters)
    });

    this.hitTestManager = new WebXRHitTestManager({
      renderer: this.renderer,
      reticle: this.reticle,
      onHitPose: (matrix, visible) => this.state.setHitPose(matrix, visible),
      onAnchorPose: (matrixArray) => this.handleAnchorPose(matrixArray),
      onSessionChange: (active) => this.handleXRSessionChange(active),
      onError: (error) => console.error('WebXR hit test setup failed:', error)
    });

    this.anchorPoseMatrix = new THREE.Matrix4();

    this.lastXRSelectTimestampMs = 0;
    this.controller = this.renderer.xr.getController(0);
    this.controller.addEventListener('select', () => this.handleXRSelect());
    this.scene.add(this.controller);

    this.captureCompleted = false;
    this.immersiveARSupported = false;
    this.xrSessionHasStartedAtLeastOnce = false;
    this.isReturningFromXRSessionEnd = false;

    // Smoothed finger-based scale multiplier (1.0 = no adjustment).
    this.fingerScaleMultiplier = 1.0;

    this.setupARButton();
    this.setupUI();
    this.setupCaptureFlow();
    this.setupARBootOverlay();
    this.setupErrorOverlay();
    this.setupEvents();

    this.renderer.setAnimationLoop((timestamp, frame) => this.animate(timestamp, frame));
  }

  // On-device error display: phones rarely have devtools attached, and an
  // uncaught error inside the XR animation loop can end the session with no
  // visible cause. Surface errors directly on screen so they're visible during
  // an active AR session.
  setupErrorOverlay() {
    this.errorOverlay = document.createElement('pre');
    this.errorOverlay.className = 'fatal-error-overlay';
    this.errorOverlay.style.cssText = [
      'position: fixed', 'top: 0', 'left: 0', 'right: 0', 'z-index: 99999',
      'max-height: 45vh', 'overflow: auto', 'margin: 0', 'padding: 8px',
      'background: rgba(127,0,0,0.92)', 'color: #fff', 'font-size: 11px',
      'line-height: 1.4', 'white-space: pre-wrap', 'word-break: break-word',
      'display: none', 'font-family: monospace', 'pointer-events: none'
    ].join(';');
    // Append to #ui-root (the WebXR DOM-overlay root), not <body> directly, so this
    // stays visible during an active AR session — exactly when it's needed most.
    this.uiRoot.appendChild(this.errorOverlay);

    window.addEventListener('error', (event) => this.showFatalError(event.error || event.message));
    window.addEventListener('unhandledrejection', (event) => this.showFatalError(event.reason));
  }

  showFatalError(error) {
    const message = error?.stack || error?.message || String(error);
    console.error('[FatalError]', error);
    this.errorOverlay.textContent += `${this.errorOverlay.textContent ? '\n---\n' : ''}${message}`;
    this.errorOverlay.style.display = 'block';
  }

  setupARButton() {
    // domOverlay.root must be #ui-root (not <body>): three.js's ARButton sets this
    // element's display to 'none' when the XR session ends. If that were <body>,
    // the entire page (including the "Start AR scan again" screen) would stay
    // hidden after every AR session — looking like the page "refreshed" to blank.
    const button = ARButton.createButton(this.renderer, {
      requiredFeatures: ['hit-test'],
      optionalFeatures: ['dom-overlay', 'anchors', 'plane-detection', 'hand-tracking'],
      domOverlay: { root: this.uiRoot }
    });

    this.arButton = button;
    this.arButton.classList.add('app-ar-button-hidden');
    document.body.appendChild(button);

    this.checkImmersiveARSupport();
  }

  async checkImmersiveARSupport() {
    try {
      this.immersiveARSupported = Boolean(
        navigator.xr && await navigator.xr.isSessionSupported('immersive-ar')
      );
    } catch {
      this.immersiveARSupported = false;
    }
  }

  setupUI() {
    document.body.classList.add('phase-capture-active');

    this.panel = new DebugPanel({
      root: this.uiRoot,
      appState: this.state,
      actions: {
        placePage: () => this.placePage(),
        placeMockPage: () => this.placeMockPage(),
        resetPage: () => this.resetPage(),
        resizePage: (args) => this.state.resizePage(args),
        setOrientation: (orientation) => this.state.setPageOrientation(orientation),
        swapOrientation: () => this.state.swapPageOrientation(),
        moveActor: (dx, dz) => this.state.moveActorLocal(dx, dz),
        randomClamp: () => this.state.sendActorOutsideThenClamp(),
        stopAR: () => this.stopAR()
      }
    });
  }

  setupCaptureFlow() {
    this.captureFlow = new CameraCaptureFlow({
      root: this.uiRoot,
      onComplete: (captureData) => this.onCaptureFlowComplete(captureData)
    });
  }

  setupARBootOverlay() {
    this.arBootOverlay = new ARBootOverlay({
      root: this.uiRoot,
      appState: this.state,
      onStartARRequest: () => this.arButton?.click()
    });
  }

  onCaptureFlowComplete(captureData) {
    this.captureCompleted = true;
    this.state.setPageCapture(captureData);
    document.body.classList.remove('phase-capture-active');

    // Load the animated GLBs + scene layout returned by the backend into the AR scene.
    if (captureData?.animationResult?.characters?.length) {
      console.log('[main] Loading animation result into AR scene:', captureData.animationResult);
      this.storyCharacterRenderer.reloadFromAnimationResult(captureData.animationResult).catch((err) => {
        console.error('[main] Dynamic GLB load failed, falling back to default story characters:', err);
      });
    } else {
      console.warn('[main] No animationResult.characters on captureData — AR scene will keep the default story.', captureData?.animationResult);
    }

    // Keep the loading/instruction overlay visible until Phase 2/3 is actually ready:
    // XR session active + WebXR hit-test reticle visible.
    this.arBootOverlay.showStarting();

    if (this.arButton) {
      this.arButton.classList.remove('app-ar-button-hidden');
      this.arButton.classList.add('app-ar-button-ready');

      // Keep this click synchronous with the user's "Start AR scan" tap.
      // Do not await support checks before it, otherwise some mobile browsers may
      // lose the user activation needed to start the XR session.
      this.arButton.click();
    }

    this.validateARStartAfterDelay();
  }

  async validateARStartAfterDelay() {
    window.setTimeout(async () => {
      if (this.state.isXRActive || this.state.hitVisible || this.state.pageLocked) {
        return;
      }

      await this.checkImmersiveARSupport();

      if (!this.immersiveARSupported) {
        this.arBootOverlay.showUnsupported(
          'This browser/device does not report support for WebXR immersive-ar. Try Android Chrome on an ARCore-supported phone.'
        );
        return;
      }

      // Supported but the programmatic click may have been blocked.
      // Keep the Three.js START AR button visible and guide the user to tap it manually.
      this.arBootOverlay.showStarting();
    }, 1800);
  }

  setupEvents() {
    window.addEventListener('resize', () => this.onResize());
    this.state.addEventListener('change', () => this.updateDebugRenderers());
  }

  handleXRSessionChange(active) {
    const wasActive = this.state.isXRActive;

    this.state.setXRActive(active);
    document.body.classList.toggle('xr-session-active', active);
    this.desktopGrid.visible = !active;
    this.hitTestManager.setSurfaceLocked(this.state.pageLocked);

    // ARButton toggles #ui-root's display style itself ('' on start, 'none' on end —
    // see setupARButton). Force it back to visible so our own UI/CSS stays in control.
    this.uiRoot.style.display = '';

    // Hide the native three.js "START AR"/"STOP AR" button once a session is running.
    // It sits at the bottom-center of the screen with a high z-index; tapping it while
    // trying to use our own AR HUD immediately calls session.end(), which looks like
    // the page "refreshing" back to the instructions screen.
    this.arButton?.classList.add('app-ar-button-hidden');

    if (active) {
      this.xrSessionHasStartedAtLeastOnce = true;
      this.isReturningFromXRSessionEnd = false;
      return;
    }

    if (wasActive && this.xrSessionHasStartedAtLeastOnce) {
      this.handleXRSessionEnded();
    }
  }

  handleXRSessionEnded() {
    // A WebXR reference space is session-scoped. After STOP AR, the old page anchor
    // should not be reused blindly in a future AR session. Return to the instructions
    // screen and ask the user to scan/lock again.
    this.isReturningFromXRSessionEnd = true;
    this.arBootOverlay.hide();
    this.hitTestManager.setSurfaceLocked(false);
    this.state.resetPage();
    this.state.setHitPose(null, false);
    document.body.classList.add('phase-capture-active');
    this.captureFlow?.showInstructionsAgain('AR scan stopped. Start AR scan again to detect and lock a fresh page plane.');
  }

  handleXRSelect() {
    const now = performance.now();
    const isDoubleTap = now - this.lastXRSelectTimestampMs <= 650;
    this.lastXRSelectTimestampMs = now;

    if (!isDoubleTap) {
      console.info('First tap received. Double-tap to lock the current page plane.');
      return;
    }

    this.placePage();
  }

  placePage() {
    const placed = this.state.placePageFromCurrentHit();

    if (placed) {
      this.hitTestManager.setSurfaceLocked(true);
      this.hitTestManager.requestAnchor(this.state.lastHitMatrix);
      return;
    }

    if (this.state.pageLocked) {
      console.warn('Page is already locked. Press Reset page before placing another plane.');
      return;
    }

    console.warn('Cannot place page yet. Wait until the WebXR reticle appears or use mock mode.');
  }

  resetPage() {
    this.state.resetPage();
    this.hitTestManager.setSurfaceLocked(false);
  }

  // The native ARButton ("STOP AR") is hidden once a session starts (see
  // handleXRSessionChange), so the AR HUD needs its own way to end the session.
  stopAR() {
    this.renderer.xr.getSession()?.end();
  }

  placeMockPage() {
    if (this.renderer.xr.isPresenting) {
      console.warn('Mock page is intended for non-AR desktop testing. Use the real reticle while in AR.');
      return;
    }

    const placed = this.state.placeMockPage();
    if (placed) {
      this.hitTestManager.setSurfaceLocked(true);
    }
  }

  // Called every frame once a WebXR anchor is active for the locked page. Updates the
  // pageAnchor's pose in place so the page rectangle/characters track the anchor's
  // drift-corrected position instead of staying fixed at the original placement pose.
  handleAnchorPose(matrixArray) {
    if (!this.state.pageAnchor) {
      return;
    }

    this.anchorPoseMatrix.fromArray(matrixArray);
    this.state.pageAnchor.updatePose(this.anchorPoseMatrix);
  }

  updateDebugRenderers() {
    this.debugPageRenderer.update({
      pageAnchor: this.state.pageAnchor,
      boundaryClamp: this.state.boundaryClamp,
      actorLocalPosition: this.state.actorLocalPosition,
      footprintRadiusMeters: this.state.footprintRadiusMeters
    });
  }

  animate(timestamp, frame) {
    try {
      if (frame) {
        this.hitTestManager.update(frame);
        this.updateFingerScale(frame);
      }

      this.storyCharacterRenderer.update({
        timestampMs: timestamp,
        pageAnchor: this.state.pageAnchor,
        boundaryClamp: this.state.boundaryClamp,
        fingerScaleMultiplier: this.fingerScaleMultiplier
      });
    } catch (error) {
      this.showFatalError(error);
    }

    this.renderer.render(this.scene, this.camera);
  }

  updateFingerScale(frame) {
    const referenceSpace = this.renderer.xr.getReferenceSpace();
    if (!referenceSpace || typeof frame.getJointPose !== 'function') return;

    const session = this.renderer.xr.getSession();
    if (!session) return;

    for (const inputSource of session.inputSources) {
      if (!inputSource.hand) continue;

      const pipSpace = inputSource.hand.get('middle-finger-phalanx-intermediate');
      const dipSpace = inputSource.hand.get('middle-finger-phalanx-distal');
      if (!pipSpace || !dipSpace) continue;

      const pipPose = frame.getJointPose(pipSpace, referenceSpace);
      const dipPose = frame.getJointPose(dipSpace, referenceSpace);
      if (!pipPose || !dipPose) continue;

      const p = pipPose.transform.position;
      const d = dipPose.transform.position;
      const measured = Math.sqrt((p.x - d.x) ** 2 + (p.y - d.y) ** 2 + (p.z - d.z) ** 2);

      // Sanity-check: realistic middle phalanx is 10–60 mm; discard outliers.
      if (measured > 0.01 && measured < 0.06) {
        // Average adult middle phalanx of middle finger ≈ 25 mm.
        const raw = measured / 0.025;
        const clamped = Math.max(0.5, Math.min(2.0, raw));
        // Exponential moving average — alpha 0.08 keeps scale stable between frames.
        this.fingerScaleMultiplier += (clamped - this.fingerScaleMultiplier) * 0.08;
      }
      break; // Use first detected hand only.
    }
  }

  onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }
}

new ARStorytellingOptionAApp();
