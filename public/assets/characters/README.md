Place GLB/GLTF character assets here.

Example:
- public/assets/characters/hero.glb
- public/assets/characters/guide.glb

Then update public/story/demo-scene.json:

"assetUrl": "/assets/characters/hero.glb"

If assetUrl is null or the file fails to load, the app uses a fallback placeholder character.
