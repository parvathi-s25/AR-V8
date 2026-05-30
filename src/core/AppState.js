import * as THREE from 'three';
import { PageAnchor } from './PageAnchor.js';
import { BoundaryClamp } from './BoundaryClamp.js';
import { TrackingConfidence } from './TrackingConfidence.js';
import { matrixToArray, round, vectorToJSON } from '../utils/math.js';

export class AppState extends EventTarget {
  constructor() {
    super();

    this.defaultPageWidthMeters = 0.28;
    this.defaultPageHeightMeters = 0.38;
    this.marginMeters = 0.025;
    this.footprintRadiusMeters = 0.025;

    this.isXRActive = false;
    this.hitVisible = false;
    this.lastHitMatrix = null;
    this.lastHitTimestampMs = 0;

    this.pageAnchor = null;
    this.boundaryClamp = null;
    this.pageLocked = false;
    this.pageLockedTimestampMs = 0;
    this.actorLocalPosition = new THREE.Vector3(0, 0.035, 0);

    this.pageCapture = null;
    this.phase4Characters = [];

    this.trackingConfidence = new TrackingConfidence();
  }

  setPageCapture(captureData) {
    this.pageCapture = captureData
      ? {
          id: captureData.id,
          timestampMs: round(captureData.timestampMs ?? performance.now(), 2),
          image: captureData.image,
          upload: captureData.upload
            ? {
                captureId: captureData.upload.captureId,
                filename: captureData.upload.filename,
                storedPath: captureData.upload.storedPath,
                publicUrl: captureData.upload.publicUrl,
                metadataStoredPath: captureData.upload.metadataStoredPath
              }
            : null,
          quality: captureData.quality,
          pageBoundaryDetection: captureData.pageBoundaryDetection || null
        }
      : null;

    const detectedSize = this.getDetectedPageSizeMeters();
    if (detectedSize) {
      this.defaultPageWidthMeters = detectedSize.widthMeters;
      this.defaultPageHeightMeters = detectedSize.heightMeters;
    }

    this.emitChange();
  }


  getCaptureBoundaryDetection() {
    const detection = this.pageCapture?.pageBoundaryDetection;
    return detection?.detected ? detection : null;
  }

  getDetectedPageSizeMeters() {
    const detection = this.getCaptureBoundaryDetection();
    const aspectRatio = Number(detection?.aspectRatio);

    if (!Number.isFinite(aspectRatio) || aspectRatio <= 0) {
      return null;
    }

    // Keep one stable physical long side and derive the other side from the
    // detected image ratio. The actual 3D pose still comes from WebXR hit-test.
    const longSideMeters = 0.38;
    let widthMeters;
    let heightMeters;

    if (aspectRatio >= 1) {
      widthMeters = longSideMeters;
      heightMeters = longSideMeters / aspectRatio;
    } else {
      heightMeters = longSideMeters;
      widthMeters = longSideMeters * aspectRatio;
    }

    return {
      widthMeters: clamp(widthMeters, 0.12, 0.62),
      heightMeters: clamp(heightMeters, 0.12, 0.62)
    };
  }

  setXRActive(active) {
    this.isXRActive = active;
    this.emitChange();
  }

  setHitPose(matrix, visible) {
    this.hitVisible = visible;
    this.lastHitMatrix = visible && matrix ? matrix.clone() : this.lastHitMatrix;
    this.lastHitTimestampMs = visible ? performance.now() : this.lastHitTimestampMs;
    this.trackingConfidence.update({
      hitVisible: this.hitVisible,
      pagePlaced: Boolean(this.pageAnchor),
      pageLocked: this.pageLocked
    });
    this.emitChange();
  }

  placePageFromCurrentHit() {
    if (this.pageLocked) {
      console.info('Page is already locked. Reset page before placing a new plane.');
      return false;
    }

    if (!this.lastHitMatrix) {
      return false;
    }

    const detectedSize = this.getDetectedPageSizeMeters();
    const boundaryDetection = this.getCaptureBoundaryDetection();

    this.pageAnchor = PageAnchor.fromPoseMatrix(this.lastHitMatrix, {
      widthMeters: detectedSize?.widthMeters ?? this.defaultPageWidthMeters,
      heightMeters: detectedSize?.heightMeters ?? this.defaultPageHeightMeters,
      source: boundaryDetection?.detected ? 'webxr-hit-test-locked+opencv-page-boundary' : 'webxr-hit-test-locked',
      boundaryDetection
    });

    this.pageLocked = true;
    this.pageLockedTimestampMs = performance.now();
    this.rebuildClamp();
    this.actorLocalPosition.set(0, 0.035, 0);
    this.trackingConfidence.update({ hitVisible: true, pagePlaced: true, pageLocked: true });
    this.emitChange();
    return true;
  }

  placeMockPage() {
    const matrix = new THREE.Matrix4();
    matrix.makeTranslation(0, 0, 0);

    this.lastHitMatrix = matrix.clone();
    this.hitVisible = true;

    const detectedSize = this.getDetectedPageSizeMeters();
    const boundaryDetection = this.getCaptureBoundaryDetection();

    this.pageAnchor = PageAnchor.fromPoseMatrix(matrix, {
      widthMeters: detectedSize?.widthMeters ?? this.defaultPageWidthMeters,
      heightMeters: detectedSize?.heightMeters ?? this.defaultPageHeightMeters,
      source: boundaryDetection?.detected ? 'desktop-mock-locked+opencv-page-boundary' : 'desktop-mock-locked',
      boundaryDetection
    });

    this.pageLocked = true;
    this.pageLockedTimestampMs = performance.now();
    this.rebuildClamp();
    this.actorLocalPosition.set(0, 0.035, 0);
    this.trackingConfidence.update({ hitVisible: true, pagePlaced: true, pageLocked: true });
    this.emitChange();
    return true;
  }

  resetPage() {
    this.pageAnchor = null;
    this.boundaryClamp = null;
    this.pageLocked = false;
    this.pageLockedTimestampMs = 0;
    this.actorLocalPosition.set(0, 0.035, 0);
    this.trackingConfidence.update({ hitVisible: this.hitVisible, pagePlaced: false, pageLocked: false });
    this.emitChange();
  }

  resizePage({ deltaWidth = 0, deltaHeight = 0 }) {
    if (!this.pageAnchor) {
      return false;
    }

    const width = Math.max(0.08, this.pageAnchor.widthMeters + deltaWidth);
    const height = Math.max(0.08, this.pageAnchor.heightMeters + deltaHeight);
    this.pageAnchor = this.pageAnchor.cloneWithSize(width, height);
    this.defaultPageWidthMeters = width;
    this.defaultPageHeightMeters = height;

    this.rebuildClamp();
    this.actorLocalPosition = this.boundaryClamp.clampLocal(this.actorLocalPosition);
    this.emitChange();
    return true;
  }


  setPageOrientation(orientation) {
    if (!this.pageAnchor) {
      return false;
    }

    const wantsLandscape = orientation === 'landscape';
    const isLandscape = this.pageAnchor.widthMeters >= this.pageAnchor.heightMeters;

    if (wantsLandscape === isLandscape) {
      return true;
    }

    return this.swapPageOrientation();
  }

  swapPageOrientation() {
    if (!this.pageAnchor) {
      return false;
    }

    const width = this.pageAnchor.heightMeters;
    const height = this.pageAnchor.widthMeters;
    this.pageAnchor = this.pageAnchor.cloneWithSize(width, height);
    this.defaultPageWidthMeters = width;
    this.defaultPageHeightMeters = height;

    this.rebuildClamp();
    this.actorLocalPosition = this.boundaryClamp.clampLocal(this.actorLocalPosition);
    this.emitChange();
    return true;
  }

  getPageOrientation() {
    if (!this.pageAnchor) {
      return null;
    }

    return this.pageAnchor.widthMeters >= this.pageAnchor.heightMeters ? 'landscape' : 'portrait';
  }

  setPhase4Characters(characters = []) {
    this.phase4Characters = characters;
    this.emitChange();
  }

  rebuildClamp() {
    if (!this.pageAnchor) {
      this.boundaryClamp = null;
      return;
    }

    this.boundaryClamp = new BoundaryClamp({
      pageAnchor: this.pageAnchor,
      marginMeters: this.marginMeters,
      footprintRadiusMeters: this.footprintRadiusMeters
    });
  }

  moveActorLocal(deltaX, deltaZ) {
    if (!this.boundaryClamp) {
      return false;
    }

    const next = this.actorLocalPosition.clone();
    next.x += deltaX;
    next.z += deltaZ;
    this.actorLocalPosition = this.boundaryClamp.clampLocal(next);
    this.emitChange();
    return true;
  }

  sendActorOutsideThenClamp() {
    if (!this.boundaryClamp || !this.pageAnchor) {
      return false;
    }

    const signX = Math.random() > 0.5 ? 1 : -1;
    const signZ = Math.random() > 0.5 ? 1 : -1;
    const outside = new THREE.Vector3(
      signX * this.pageAnchor.widthMeters,
      0.035,
      signZ * this.pageAnchor.heightMeters
    );

    this.actorLocalPosition = this.boundaryClamp.clampLocal(outside);
    this.emitChange();
    return true;
  }

  getActorWorldPosition() {
    if (!this.pageAnchor) {
      return null;
    }

    return this.pageAnchor.localToWorld(this.actorLocalPosition);
  }

  getContracts() {
    const confidenceJSON = this.trackingConfidence.getJSON();

    return {
      implementationDirection: 'Phase 1A capture intake + Phase 3.5 OpenCV page boundary + Phase 2/3 locked WebXR anchor + Phase 4 renderer MVP',
      timestampMs: round(performance.now(), 2),
      pageCapture: this.pageCapture,
      xrActive: this.isXRActive,
      pageLocked: this.pageLocked,
      pageLockedTimestampMs: this.pageLocked ? round(this.pageLockedTimestampMs, 2) : null,
      pageOrientation: this.getPageOrientation(),
      latestHit: this.lastHitMatrix
        ? {
            visible: this.hitVisible,
            timestampMs: round(this.lastHitTimestampMs, 2),
            poseMatrix: matrixToArray(this.lastHitMatrix)
          }
        : null,
      detectedPlane: this.pageAnchor
        ? this.pageAnchor.toDetectedPlaneJSON({
            confidence: confidenceJSON.planeTracking.confidence,
            trackingState: confidenceJSON.planeTracking.state
          })
        : null,
      pageBoundary: this.pageAnchor
        ? this.pageAnchor.toPageBoundaryJSON({
            confidence: confidenceJSON.pageDetection.confidence,
            status: confidenceJSON.pageDetection.state
          })
        : null,
      pageCoordinateSystem: this.pageAnchor ? this.pageAnchor.toCoordinateSystemJSON() : null,
      boundaryClamp: this.boundaryClamp ? this.boundaryClamp.toJSON() : null,
      phase4Characters: this.phase4Characters,
      debugActor: this.pageAnchor
        ? {
            localPosition: vectorToJSON(this.actorLocalPosition),
            worldPosition: vectorToJSON(this.getActorWorldPosition()),
            footprintRadiusMeters: round(this.footprintRadiusMeters, 4)
          }
        : null,
      trackingConfidence: confidenceJSON
    };
  }

  emitChange() {
    this.dispatchEvent(new Event('change'));
  }
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
