import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { round, vectorToJSON } from '../utils/math.js';

const DEFAULT_STORY = {
  id: 'demo_storyline',
  title: 'Demo AR Storytelling Scene',
  durationSec: 18,
  characters: [
    {
      id: 'hero',
      name: 'Hero',
      assetUrl: null,
      scale: 1,
      footprintRadiusMeters: 0.035,
      fallbackColor: '#38bdf8'
    }
  ],
  timeline: [
    { timeSec: 0, characterId: 'hero', action: 'enter', animation: 'Idle', position: { x: -0.06, z: 0.05 } },
    { timeSec: 4, characterId: 'hero', action: 'move', animation: 'Walk', position: { x: 0.06, z: -0.05 } },
    { timeSec: 9, characterId: 'hero', action: 'perform', animation: 'Wave', position: { x: 0.02, z: 0.02 } },
    { timeSec: 14, characterId: 'hero', action: 'idle', animation: 'Idle', position: { x: -0.02, z: -0.02 } }
  ]
};

export class StoryCharacterRenderer {
  constructor(scene, { storyUrl = '/story/demo-scene.json', onCharactersUpdate } = {}) {
    this.scene = scene;
    this.storyUrl = storyUrl;
    this.onCharactersUpdate = onCharactersUpdate;

    const dracoLoader = new DRACOLoader();
    // Backend GLBs may be Draco-compressed; without a DRACOLoader, GLTFLoader throws
    // and tryLoadGLTFCharacter silently falls through (no model is shown).
    dracoLoader.setDecoderPath('/draco/');

    this.loader = new GLTFLoader();
    this.loader.setDRACOLoader(dracoLoader);

    this.story = DEFAULT_STORY;
    this.characters = new Map();
    this.mixers = [];

    this.pageGroup = new THREE.Group();
    this.pageGroup.name = 'Phase4StoryCharacters';
    this.pageGroup.matrixAutoUpdate = false;
    this.pageGroup.visible = false;
    this.scene.add(this.pageGroup);

    this.storyStartTimestampMs = null;
    this.activePageAnchorId = null;
    this.lastTimestampMs = 0;
    this.lastPageGroupVisible = null;
  }

  async load() {
    this.story = await this.loadStoryConfig();
    await this.buildCharacters();
    this.emitCharacterState([]);
  }

  async loadStoryConfig() {
    try {
      const response = await fetch(this.storyUrl, { cache: 'no-store' });
      if (!response.ok) {
        console.warn(`Story config ${this.storyUrl} returned ${response.status}. Using default story.`);
        return DEFAULT_STORY;
      }
      const config = await response.json();
      return normalizeStoryConfig(config);
    } catch (error) {
      console.warn('Could not load story config. Using default story.', error);
      return DEFAULT_STORY;
    }
  }

  async buildCharacters() {
    this.clearCharacters();

    for (const characterConfig of this.story.characters) {
      const characterRoot = new THREE.Group();
      characterRoot.name = `story-character-${characterConfig.id}`;
      characterRoot.visible = false;
      characterRoot.userData = {
        id: characterConfig.id,
        name: characterConfig.name || characterConfig.id,
        footprintRadiusMeters: characterConfig.footprintRadiusMeters ?? 0.035,
        currentAnimation: 'fallback',
        currentState: 'waiting',
        localPosition: new THREE.Vector3(0, 0.035, 0)
      };

      await this.tryLoadGLTFCharacter(characterConfig, characterRoot);

      const footprint = this.createFootprint(characterRoot.userData.footprintRadiusMeters);
      footprint.name = 'story-character-footprint';
      characterRoot.add(footprint);

      this.pageGroup.add(characterRoot);
      this.characters.set(characterConfig.id, {
        config: characterConfig,
        root: characterRoot,
        mixer: characterRoot.userData.mixer ?? null,
        actions: characterRoot.userData.actions ?? new Map()
      });
    }
  }

  async tryLoadGLTFCharacter(characterConfig, root) {
    if (!characterConfig.assetUrl) {
      console.warn(`[StoryCharacterRenderer] ${characterConfig.id} has no assetUrl — nothing will be rendered for this character.`);
      return false;
    }

    console.log(`[StoryCharacterRenderer] Loading GLB for ${characterConfig.id} from ${characterConfig.assetUrl}`);

    try {
      const gltf = await this.loader.loadAsync(characterConfig.assetUrl);
      const model = gltf.scene;
      model.name = `${characterConfig.id}-gltf-model`;
      model.scale.setScalar(characterConfig.scale ?? 0.085);
      model.rotation.x = -Math.PI / 2;
      root.add(model);

      const box = new THREE.Box3().setFromObject(model);
      const size = box.getSize(new THREE.Vector3());
      console.log(`[StoryCharacterRenderer] Loaded ${characterConfig.id}: ${gltf.animations?.length ?? 0} animation(s), bounding box size = (${size.x.toFixed(3)}, ${size.y.toFixed(3)}, ${size.z.toFixed(3)})`);

      if (gltf.animations?.length) {
        const mixer = new THREE.AnimationMixer(model);
        const actions = new Map();
        gltf.animations.forEach((clip) => {
          actions.set(clip.name, mixer.clipAction(clip));
        });
        root.userData.mixer = mixer;
        root.userData.actions = actions;
        this.mixers.push(mixer);
      }

      return true;
    } catch (error) {
      console.error(`[StoryCharacterRenderer] Could not load GLB/GLTF for ${characterConfig.id} (${characterConfig.assetUrl}). Nothing will be rendered for this character.`, error);
      return false;
    }
  }

  createFallbackCharacter(characterConfig) {
    const group = new THREE.Group();
    group.name = `${characterConfig.id}-fallback-model`;

    const color = new THREE.Color(characterConfig.fallbackColor || '#38bdf8');

    const bodyGeometry = new THREE.CapsuleGeometry(0.022, 0.06, 6, 16);
    const bodyMaterial = new THREE.MeshStandardMaterial({ color, roughness: 0.42 });
    const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
    body.position.y = 0.07;
    group.add(body);

    const headGeometry = new THREE.SphereGeometry(0.021, 18, 18);
    const headMaterial = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.4 });
    const head = new THREE.Mesh(headGeometry, headMaterial);
    head.position.y = 0.13;
    group.add(head);

    const armGeometry = new THREE.CapsuleGeometry(0.006, 0.045, 4, 8);
    const armMaterial = new THREE.MeshStandardMaterial({ color, roughness: 0.5 });
    const leftArm = new THREE.Mesh(armGeometry, armMaterial);
    leftArm.position.set(-0.03, 0.085, 0);
    leftArm.rotation.z = 0.8;
    group.add(leftArm);

    const rightArm = new THREE.Mesh(armGeometry, armMaterial);
    rightArm.position.set(0.03, 0.085, 0);
    rightArm.rotation.z = -0.8;
    group.add(rightArm);

    group.rotation.x = -Math.PI / 2;
    return group;
  }

  createFootprint(radius) {
    const geometry = new THREE.CylinderGeometry(radius, radius, 0.003, 28);
    const material = new THREE.MeshStandardMaterial({
      color: 0xa78bfa,
      transparent: true,
      opacity: 0.28,
      side: THREE.DoubleSide
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.y = 0.003;
    return mesh;
  }

  update({ timestampMs, pageAnchor, boundaryClamp, fingerScaleMultiplier = 1 }) {
    const deltaSec = this.lastTimestampMs ? Math.min(0.05, (timestampMs - this.lastTimestampMs) / 1000) : 0;
    this.lastTimestampMs = timestampMs;

    this.mixers.forEach((mixer) => mixer.update(deltaSec));

    if (!pageAnchor || !boundaryClamp) {
      this.pageGroup.visible = false;
      if (this.lastPageGroupVisible !== false) {
        console.log('[StoryCharacterRenderer] Page not locked yet — characters hidden until the page anchor is placed.');
        this.lastPageGroupVisible = false;
      }
      this.storyStartTimestampMs = null;
      this.activePageAnchorId = null;
      this.emitCharacterState([]);
      return;
    }

    if (this.lastPageGroupVisible !== true) {
      console.log(`[StoryCharacterRenderer] Page locked — showing ${this.story.characters.length} character(s):`, this.story.characters.map((c) => c.id));
      this.lastPageGroupVisible = true;
    }

    this.pageGroup.visible = true;
    this.pageGroup.matrix.copy(pageAnchor.matrix);
    this.pageGroup.matrixWorldNeedsUpdate = true;

    if (this.activePageAnchorId !== pageAnchor.id) {
      this.activePageAnchorId = pageAnchor.id;
      this.storyStartTimestampMs = timestampMs;
    }

    const elapsedSec = ((timestampMs - this.storyStartTimestampMs) / 1000) % this.story.durationSec;
    const desiredStates = this.computeDesiredCharacterStates(elapsedSec);
    const overlapResolvedStates = this.resolveOverlaps(desiredStates);

    const visibleCharacterStates = [];

    for (const state of overlapResolvedStates) {
      const character = this.characters.get(state.characterId);
      if (!character) continue;

      const root = character.root;
      root.visible = true;

      const safeLocal = boundaryClamp.clampLocal(new THREE.Vector3(state.position.x, 0.035, state.position.z));
      root.position.copy(safeLocal);
      root.rotation.y = state.rotationY ?? 0;
      root.scale.setScalar(fingerScaleMultiplier);

      root.userData.localPosition = safeLocal.clone();
      root.userData.currentState = state.action;
      root.userData.currentAnimation = this.playAnimation(character, state.animation);

      visibleCharacterStates.push({
        id: root.userData.id,
        name: root.userData.name,
        state: root.userData.currentState,
        animation: root.userData.currentAnimation,
        localPosition: vectorToJSON(safeLocal),
        footprintRadiusMeters: round(root.userData.footprintRadiusMeters, 4)
      });
    }

    for (const [id, character] of this.characters.entries()) {
      if (!overlapResolvedStates.some((state) => state.characterId === id)) {
        character.root.visible = false;
      }
    }

    this.emitCharacterState(visibleCharacterStates);
  }

  computeDesiredCharacterStates(elapsedSec) {
    return this.story.characters.map((character) => {
      const events = this.story.timeline
        .filter((event) => event.characterId === character.id && event.timeSec <= elapsedSec)
        .sort((a, b) => b.timeSec - a.timeSec);
      const activeEvent = events[0] || this.story.timeline.find((event) => event.characterId === character.id);

      return {
        characterId: character.id,
        action: activeEvent?.action || 'idle',
        animation: activeEvent?.animation || 'Idle',
        position: activeEvent?.position || { x: 0, z: 0 },
        rotationY: activeEvent?.rotationY || 0,
        radius: character.footprintRadiusMeters ?? 0.035
      };
    });
  }

  resolveOverlaps(states) {
    const resolved = states.map((state) => ({
      ...state,
      position: { ...state.position }
    }));

    for (let i = 0; i < resolved.length; i += 1) {
      for (let j = i + 1; j < resolved.length; j += 1) {
        const a = resolved[i];
        const b = resolved[j];
        const dx = b.position.x - a.position.x;
        const dz = b.position.z - a.position.z;
        const distance = Math.hypot(dx, dz);
        const minDistance = a.radius + b.radius + 0.015;

        if (distance < minDistance) {
          const push = (minDistance - distance) / 2;
          // Same position (e.g. backend defaults both to [0,0,0]): pick a deterministic
          // direction per pair so characters still separate instead of stacking.
          const angle = distance < 1e-6 ? (j - i) * (Math.PI / 3) : Math.atan2(dz, dx);
          const nx = Math.cos(angle);
          const nz = Math.sin(angle);
          a.position.x -= nx * push;
          a.position.z -= nz * push;
          b.position.x += nx * push;
          b.position.z += nz * push;
        }
      }
    }

    return resolved;
  }

  playAnimation(character, requestedName) {
    if (!character.mixer || !character.actions?.size) {
      return 'fallback-placeholder';
    }

    const action = character.actions.get(requestedName) || character.actions.values().next().value;
    if (!action) {
      return 'no-animation';
    }

    for (const otherAction of character.actions.values()) {
      if (otherAction !== action) {
        otherAction.fadeOut(0.2);
      }
    }

    action.reset().fadeIn(0.2).play();
    return action.getClip().name;
  }

  emitCharacterState(characters) {
    this.onCharactersUpdate?.(characters);
  }

  /**
   * Replace all current characters with the animated GLBs + scene layout received from
   * the backend /animate endpoint: { story, characters, timeline } as returned by
   * AnimationAPIClient.uploadImageAndGetAnimation.
   */
  async reloadFromAnimationResult(animationResult) {
    const backendCharacters = animationResult?.characters;
    console.log('[StoryCharacterRenderer] reloadFromAnimationResult received:', animationResult);

    if (!Array.isArray(backendCharacters) || backendCharacters.length === 0) {
      console.warn('[StoryCharacterRenderer] reloadFromAnimationResult: no characters provided.');
      return;
    }

    const characters = backendCharacters.map((item, index) => ({
      id: item.id || `dynamic_${index}`,
      name: item.name || item.id || `Character ${index + 1}`,
      assetUrl: item.glbUrl,
      scale: 0.085,
      footprintRadiusMeters: 0.035,
      fallbackColor: '#38bdf8'
    }));

    // Use the backend-provided position when available; otherwise spread characters
    // across the page so they don't stack.
    const spread = 0.06;
    const half = Math.floor(characters.length / 2);
    const timeline = characters.map((char, index) => {
      const backendPosition = backendCharacters[index].position;
      return {
        timeSec: 0,
        characterId: char.id,
        action: 'idle',
        animation: 'Idle',
        position: backendPosition
          ? { x: backendPosition.x, z: backendPosition.z }
          : { x: (index - half) * spread, z: 0 },
        rotationY: backendCharacters[index].rotationY ?? 0
      };
    });

    const backendTimeline = Array.isArray(animationResult.timeline) ? animationResult.timeline : [];
    const durationSec = backendTimeline.length
      ? Math.max(30, ...backendTimeline.map((event) => event.endTime || 0))
      : 30;

    this.story = {
      id: 'dynamic_story',
      title: animationResult.story || 'Dynamic AR Scene',
      durationSec,
      characters,
      timeline,
      voiceoverTimeline: backendTimeline
    };

    console.log('[StoryCharacterRenderer] Dynamic story characters:', characters);
    console.log('[StoryCharacterRenderer] Dynamic story timeline:', timeline);

    await this.buildCharacters();
    this.storyStartTimestampMs = null;
    this.lastPageGroupVisible = null;
    this.emitCharacterState([]);
  }

  clearCharacters() {
    while (this.pageGroup.children.length > 0) {
      const child = this.pageGroup.children.pop();
      disposeObject(child);
    }
    this.characters.clear();
    this.mixers = [];
  }
}

function normalizeStoryConfig(config) {
  return {
    id: config.id || DEFAULT_STORY.id,
    title: config.title || DEFAULT_STORY.title,
    durationSec: Number(config.durationSec || DEFAULT_STORY.durationSec),
    characters: Array.isArray(config.characters) && config.characters.length ? config.characters : DEFAULT_STORY.characters,
    timeline: Array.isArray(config.timeline) && config.timeline.length ? config.timeline : DEFAULT_STORY.timeline
  };
}

function disposeObject(object) {
  object.traverse?.((child) => {
    child.geometry?.dispose?.();
    if (Array.isArray(child.material)) {
      child.material.forEach((material) => material.dispose?.());
    } else {
      child.material?.dispose?.();
    }
  });
}
