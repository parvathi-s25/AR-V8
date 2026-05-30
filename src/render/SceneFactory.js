import * as THREE from 'three';

export function createRenderer(container) {
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true,
    powerPreference: 'high-performance'
  });

  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.xr.enabled = true;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  container.appendChild(renderer.domElement);
  return renderer;
}

export function createScene() {
  const scene = new THREE.Scene();

  const ambient = new THREE.HemisphereLight(0xffffff, 0x334155, 2.2);
  scene.add(ambient);

  const directional = new THREE.DirectionalLight(0xffffff, 2.1);
  directional.position.set(1.5, 3, 2);
  scene.add(directional);

  return scene;
}

export function createCamera() {
  const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 30);
  camera.position.set(0, 0.85, 1.15);
  camera.lookAt(0, 0, 0);
  return camera;
}

export function createReticle() {
  const ringGeometry = new THREE.RingGeometry(0.08, 0.095, 36).rotateX(-Math.PI / 2);
  const ringMaterial = new THREE.MeshBasicMaterial({
    color: 0x38bdf8,
    transparent: true,
    opacity: 0.95,
    side: THREE.DoubleSide
  });

  const reticle = new THREE.Mesh(ringGeometry, ringMaterial);
  reticle.matrixAutoUpdate = false;
  reticle.visible = false;

  return reticle;
}

export function createDesktopGrid() {
  const group = new THREE.Group();

  const grid = new THREE.GridHelper(1.2, 12, 0x64748b, 0x334155);
  grid.position.y = -0.002;
  group.add(grid);

  const labelPlaneGeometry = new THREE.PlaneGeometry(1.2, 0.32);
  const labelPlaneMaterial = new THREE.MeshBasicMaterial({
    color: 0x0f172a,
    transparent: true,
    opacity: 0.52,
    side: THREE.DoubleSide
  });
  const labelPlane = new THREE.Mesh(labelPlaneGeometry, labelPlaneMaterial);
  labelPlane.position.set(0, 0.001, -0.65);
  labelPlane.rotation.x = -Math.PI / 2;
  group.add(labelPlane);

  return group;
}
