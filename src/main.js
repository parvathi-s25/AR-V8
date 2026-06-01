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
      onSessionChange: (active) => this.handleXRSessionChange(active),
      onError: (error) => console.error('WebXR hit test setup failed:', error)
    });

    this.lastXRSelectTimestampMs = 0;
    this.controller = this.renderer.xr.getController(0);
    this.controller.addEventListener('select', () => this.handleXRSelect());
    this.scene.add(this.controller);

    this.captureCompleted = false;
    this.immersiveARSupported = false;
    this.xrSessionHasStartedAtLeastOnce = false;
    this.isReturningFromXRSessionEnd = false;

    this.setupARButton();
    this.setupUI();
    this.setupCaptureFlow();
    this.setupARBootOverlay();
    this.setupEvents();

    this.storyCharacterRenderer.load().catch((error) => {
      console.warn('Phase 4 story renderer loaded with fallback characters:', error);
    });

    this.renderer.setAnimationLoop((timestamp, frame) => this.animate(timestamp, frame));
  }

  setupARButton() {
    const button = ARButton.createButton(this.renderer, {
      requiredFeatures: ['hit-test'],
      optionalFeatures: ['dom-overlay', 'anchors', 'plane-detection'],
      domOverlay: { root: document.body }
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
        randomClamp: () => this.state.sendActorOutsideThenClamp()
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

    // Load the animated GLBs returned by the backend into the AR scene.
    if (captureData?.animationGlbs?.length) {
      this.storyCharacterRenderer.reloadFromGLBs(captureData.animationGlbs).catch((err) => {
        console.warn('Dynamic GLB load failed, falling back to default story characters:', err);
      });
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

  updateDebugRenderers() {
    this.debugPageRenderer.update({
      pageAnchor: this.state.pageAnchor,
      boundaryClamp: this.state.boundaryClamp,
      actorLocalPosition: this.state.actorLocalPosition,
      footprintRadiusMeters: this.state.footprintRadiusMeters
    });
  }

  animate(timestamp, frame) {
    if (frame) {
      this.hitTestManager.update(frame);
    }

    this.storyCharacterRenderer.update({
      timestampMs: timestamp,
      pageAnchor: this.state.pageAnchor,
      boundaryClamp: this.state.boundaryClamp
    });

    this.renderer.render(this.scene, this.camera);
  }

  onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }
}

new ARStorytellingOptionAApp();
