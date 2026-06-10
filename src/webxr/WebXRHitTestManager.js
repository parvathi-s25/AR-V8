import * as THREE from 'three';

/**
 * Minimal WebXR hit-test manager.
 *
 * Three.js owns the XRSession through renderer.xr.
 * This class requests a viewer-space hit-test source and updates a reticle matrix
 * every XR frame when a surface hit is available.
 */
export class WebXRHitTestManager {
  constructor({ renderer, reticle, onHitPose, onAnchorPose, onSessionChange, onError }) {
    this.renderer = renderer;
    this.reticle = reticle;
    this.onHitPose = onHitPose;
    this.onAnchorPose = onAnchorPose;
    this.onSessionChange = onSessionChange;
    this.onError = onError;

    this.hitTestSource = null;
    this.hitTestSourceRequested = false;
    this.surfaceLocked = false;

    // WebXR anchor for the locked page pose. Without this, the page rectangle is a
    // one-time pose snapshot that can visibly drift away from the physical page as
    // ARCore/ARKit refines its tracking. With it, the anchor's pose is re-resolved
    // every frame so the page stays registered to the real-world surface.
    this.pendingAnchorMatrix = null;
    this.activeAnchor = null;
    this.anchorSpace = null;

    this.handleSessionStart = this.handleSessionStart.bind(this);
    this.handleSessionEnd = this.handleSessionEnd.bind(this);

    this.renderer.xr.addEventListener('sessionstart', this.handleSessionStart);
    this.renderer.xr.addEventListener('sessionend', this.handleSessionEnd);
  }

  handleSessionStart() {
    this.hitTestSourceRequested = false;
    this.onSessionChange?.(true);
  }

  handleSessionEnd() {
    if (this.hitTestSource) {
      this.hitTestSource.cancel();
    }

    this.hitTestSource = null;
    this.hitTestSourceRequested = false;
    this.surfaceLocked = false;
    this.reticle.visible = false;
    this.onHitPose?.(null, false);
    this.onSessionChange?.(false);

    this.clearAnchor();
  }

  setSurfaceLocked(locked) {
    this.surfaceLocked = locked;

    if (locked) {
      this.reticle.visible = false;
    } else {
      this.clearAnchor();
    }
  }

  clearAnchor() {
    this.activeAnchor?.delete?.();
    this.activeAnchor = null;
    this.anchorSpace = null;
    this.pendingAnchorMatrix = null;
  }

  // Ask the XR system to create a persistent XRAnchor at the given pose (called once,
  // right after the page is locked). Resolution happens asynchronously; once resolved,
  // updateAnchorPose() feeds the anchor's live pose back via onAnchorPose every frame.
  requestAnchor(matrix) {
    if (matrix) {
      this.pendingAnchorMatrix = matrix.clone();
    }
  }

  async ensureHitTestSource(session) {
    if (this.hitTestSourceRequested) {
      return;
    }

    this.hitTestSourceRequested = true;

    try {
      const viewerSpace = await session.requestReferenceSpace('viewer');
      this.hitTestSource = await session.requestHitTestSource({ space: viewerSpace });
    } catch (error) {
      this.onError?.(error);
      this.reticle.visible = false;
      this.onHitPose?.(null, false);
    }
  }

  update(frame) {
    if (!frame) {
      return;
    }

    const referenceSpace = this.renderer.xr.getReferenceSpace();

    this.processPendingAnchor(frame, referenceSpace);
    this.updateAnchorPose(frame, referenceSpace);

    // Once the page plane is locked, stop updating the reticle/hit pose.
    // This prevents accidental plane changes and makes the placed page anchor stable
    // until the user explicitly presses Reset page.
    if (this.surfaceLocked) {
      this.reticle.visible = false;
      return;
    }

    const session = this.renderer.xr.getSession();
    if (!session) {
      this.reticle.visible = false;
      this.onHitPose?.(null, false);
      return;
    }

    this.ensureHitTestSource(session);

    if (!this.hitTestSource) {
      this.reticle.visible = false;
      this.onHitPose?.(null, false);
      return;
    }

    const hitTestResults = frame.getHitTestResults(this.hitTestSource);

    if (hitTestResults.length > 0) {
      const hit = hitTestResults[0];
      const pose = hit.getPose(referenceSpace);

      if (pose) {
        this.reticle.visible = true;
        this.reticle.matrix.fromArray(pose.transform.matrix);
        this.onHitPose?.(this.reticle.matrix, true);
        return;
      }
    }

    this.reticle.visible = false;
    this.onHitPose?.(null, false);
  }

  // Resolve a pending requestAnchor() call. Must run inside an XR frame callback
  // since XRFrame.createAnchor() is only valid there. Falls back silently (page
  // keeps its static placed pose) on devices/browsers without the anchors feature.
  processPendingAnchor(frame, referenceSpace) {
    if (!this.pendingAnchorMatrix) {
      return;
    }

    const matrix = this.pendingAnchorMatrix;
    this.pendingAnchorMatrix = null;

    if (typeof frame.createAnchor !== 'function') {
      return;
    }

    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    matrix.decompose(position, quaternion, scale);

    const transform = new XRRigidTransform(
      { x: position.x, y: position.y, z: position.z },
      { x: quaternion.x, y: quaternion.y, z: quaternion.z, w: quaternion.w }
    );

    frame.createAnchor(transform, referenceSpace)
      .then((anchor) => {
        this.activeAnchor = anchor;
        this.anchorSpace = anchor.anchorSpace;
      })
      .catch((error) => {
        console.warn('[WebXRHitTestManager] XRAnchor not available; the placed page will keep its static pose.', error);
      });
  }

  // Feed the anchor's live (drift-corrected) pose back to the app every frame.
  updateAnchorPose(frame, referenceSpace) {
    if (!this.anchorSpace) {
      return;
    }

    const pose = frame.getPose(this.anchorSpace, referenceSpace);
    if (pose) {
      this.onAnchorPose?.(pose.transform.matrix);
    }
  }

  dispose() {
    this.renderer.xr.removeEventListener('sessionstart', this.handleSessionStart);
    this.renderer.xr.removeEventListener('sessionend', this.handleSessionEnd);

    if (this.hitTestSource) {
      this.hitTestSource.cancel();
    }
  }
}
