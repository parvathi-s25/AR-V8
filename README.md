# AR Storytelling — Phase 1A + Phase 2/3 + Phase 4 MVP

This version includes:

1. **Phase 1A capture intake**
   - Splash screen: **AR Storytelling**
   - **Turn on camera** button
   - Back-camera photo capture
   - Image quality metrics
   - Backend upload into `backend/captured_images/`

2. **Phase 2/3 WebXR plane + page boundary**
   - Loading/instruction overlay after **Start AR scan**
   - Overlay stays visible until WebXR hit-test/reticle is ready
   - Double-tap / Lock page
   - Stable locked page anchor
   - Width/height scaling
   - Portrait/landscape orientation controls
   - Boundary clamp
   - Clean return to instructions after **STOP AR**

3. **Phase 4 renderer MVP**
   - Loads a story timeline from `public/story/demo-scene.json`
   - Supports GLB/GLTF character URLs through Three.js `GLTFLoader`
   - Uses fallback placeholder characters when no GLB is provided
   - Places characters in page-local X/Z coordinates
   - Clamps characters inside the locked page boundary
   - Includes a simple overlap resolver for multiple characters

---

## Important browser/deployment limitation

A frontend-only browser app cannot directly write captured photos into your project repository folder after deployment. To save images into a real folder, the app includes a small **FastAPI backend**.

During local development, captured images are saved here:

```text
backend/captured_images/
```

On Vercel, the frontend alone cannot persist image files. For production, deploy the backend separately, then set:

```text
VITE_CAPTURE_API_BASE_URL=https://your-backend-url.com
```

---

## Project structure

```text
ar-storytelling-option-a/
├── backend/
│   ├── main.py
│   ├── requirements.txt
│   └── captured_images/
│       └── .gitkeep
├── public/
│   ├── assets/
│   │   └── characters/
│   │       └── README.md
│   └── story/
│       └── demo-scene.json
├── src/
│   ├── capture/
│   │   ├── CameraCaptureFlow.js
│   │   ├── CaptureUploadClient.js
│   │   └── ImageQuality.js
│   ├── core/
│   ├── render/
│   │   ├── DebugPageRenderer.js
│   │   ├── SceneFactory.js
│   │   └── StoryCharacterRenderer.js
│   ├── ui/
│   ├── webxr/
│   ├── main.js
│   └── styles.css
├── .env.example
├── index.html
├── package.json
└── vite.config.js
```

---

## Run backend locally

Open terminal 1:

```bash
cd backend
python -m venv .venv
```

Activate the environment.

Windows PowerShell:

```bash
.venv\Scripts\Activate.ps1
```

Windows CMD:

```bash
.venv\Scripts\activate.bat
```

macOS/Linux:

```bash
source .venv/bin/activate
```

Install dependencies and start backend:

```bash
pip install -r requirements.txt
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

Check backend health:

```text
http://localhost:8000/api/health
```

Swagger docs:

```text
http://localhost:8000/docs
```

---

## Run frontend locally

Open terminal 2 from the project root:

```bash
npm install
npm run dev
```

Open the Vite URL, usually:

```text
http://localhost:5173
```

For phone testing on the same Wi-Fi:

```bash
npm run dev -- --host 0.0.0.0
```

Then open the network URL shown by Vite on your phone.

---

## Environment variable

Create a `.env` file in the project root if your backend URL is different:

```text
VITE_CAPTURE_API_BASE_URL=http://localhost:8000
```

For phone testing, use your laptop IP:

```text
VITE_CAPTURE_API_BASE_URL=http://YOUR_LAPTOP_IP:8000
```

Restart Vite after changing `.env`.

---

## Expected workflow

```text
AR Storytelling splash
→ Turn on camera
→ Capture photo
→ Continue & save image
→ Image appears in backend/captured_images/
→ Start AR scan
→ Phase 2/3 loading overlay appears
→ WebXR session starts
→ Move phone slowly over the same book/table
→ Overlay hides only when hit-test reticle is visible
→ Double-tap / Lock page
→ Adjust width/height or portrait/landscape if needed
→ Phase 4 placeholder characters appear on the locked page
→ Characters stay inside boundary clamp
→ Press STOP AR
→ App returns cleanly to the scan instructions screen
```

---

## Phase 4 GLB/GLTF usage

Put GLB/GLTF files here:

```text
public/assets/characters/
```

Example:

```text
public/assets/characters/hero.glb
```

Then update `public/story/demo-scene.json`:

```json
{
  "id": "hero",
  "name": "Hero",
  "assetUrl": "/assets/characters/hero.glb",
  "scale": 1,
  "footprintRadiusMeters": 0.035
}
```

If `assetUrl` is `null` or the file cannot load, the app uses a placeholder character so the Phase 4 placement, timing, overlap, and clamp logic still work.

---

## Real-device WebXR notes

The capture flow uses normal browser camera access and should work on many phones.

The later **Start AR scan** step still depends on true WebXR AR support:

```text
Android Chrome
+ ARCore-supported device
+ Google Play Services for AR installed/enabled
+ HTTPS deployed frontend
```

Unsupported devices can still use the capture flow, but cannot run real WebXR hit-test AR.

---

## Current data contract additions

The debug JSON now includes:

```json
{
  "pageOrientation": "portrait",
  "phase4Characters": [
    {
      "id": "hero",
      "name": "Hero",
      "state": "walk",
      "animation": "fallback-placeholder",
      "localPosition": { "x": 0.06, "y": 0.035, "z": -0.05 },
      "footprintRadiusMeters": 0.035
    }
  ]
}
```
