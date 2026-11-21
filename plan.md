# Blacksrj FDM-1 (Face Detection Mark 1) - Android App Implementation Plan

## 1. Project Overview & Specifications
- **App Name**: Face Detection M1 (`Blacksrj FDM-1`)
- **Package ID / Application ID**: `FDM1.blacksrj.apps`
- **Initial Version**: `v1.0.0` (Version Code: `1`)
- **Architecture**: Hybrid Native Android (Kotlin + Capacitor) + Web Core (React 18, TypeScript, Tailwind CSS) + C++/Wasm SIMD Inference Engine (`onnxruntime-web`).
- **Target Platform**: Android (API level 24+ / Android 7.0 - Android 15+)
- **Storage Strategy**: 100% Offline, Scoped/Internal Device Storage at `Face Detection M1/models/`. Zero cloud/remote dependencies.
- **Payload Budget**: < 40 MB total (App + SOTA Models).

---

## 2. Neural Models Architecture (Blacksrj FDM-1 Engine)

| Model Component | Branded Filename | Purpose & Specifications | File Size |
|---|---|---|---|
| **Face & Keypoint Detector** | `blacksrj_fdm1_detector.onnx` | SCRFD 2.5G. Detects faces at 10+ ft (3-5m) distance and provides 5 facial landmark points (eyes, nose, mouth corners) even with motion/angle. | ~3.2 MB |
| **Biometric Feature Embedder** | `blacksrj_fdm1_recognizer.onnx` | ArcFace MobileFaceNet. Generates 512-dimensional normalized biometric feature embeddings for exact identity matching. | ~13.0 MB |
| **Model Configuration** | `blacksrj_fdm1_config.json` | Anchors, score thresholds (0.50), cosine match threshold (0.65), and affine normalization settings. | < 2 KB |
| **Legacy Object Models** | Local storage optional | Retains existing DETR, YOLO-World, and YOLOv11 options in the model selector. | Varied |

---

## 3. Detailed Implementation Phases

### Phase 1: Model Sourcing & Branded Packaging
- [ ] Download official SCRFD 2.5G ONNX weights and ArcFace MobileFaceNet ONNX weights.
- [ ] Rename and structure into `models/`:
  - `blacksrj_fdm1_detector.onnx`
  - `blacksrj_fdm1_recognizer.onnx`
  - `blacksrj_fdm1_config.json`
- [ ] Prepare an automated copy / test directory and instructions for device placement in `Face Detection M1/models/`.

### Phase 2: Capacitor Native Android Initialization
- [ ] Install `@capacitor/core`, `@capacitor/cli`, `@capacitor/android`, and `@capacitor/filesystem`.
- [ ] Initialize `capacitor.config.ts`:
  - `appId`: `FDM1.blacksrj.apps`
  - `appName`: `Face Detection M1`
  - `webDir`: `dist`
- [ ] Execute `npx cap add android` to generate the native Android platform scaffolding.

### Phase 3: Native Android Permissions & Kotlin Configuration
- [ ] Update `android/app/src/main/AndroidManifest.xml`:
  - `android.permission.CAMERA` (hardware camera feed)
  - `android.permission.READ_EXTERNAL_STORAGE` / `READ_MEDIA_IMAGES`
  - Hardware acceleration enabled (`android:hardwareAccelerated="true"`)
  - Screen orientation and safe area adjustments
- [ ] Configure `MainActivity.kt`:
  - Webview hardware acceleration and WebAssembly SIMD enablement.
  - Media capture without user gesture block.

### Phase 4: Core Engine & Offline Storage Bridge
- [ ] Implement `src/services/localModelLoader.ts`:
  - Access `Face Detection M1/models/` from device storage or fallback to bundled/picked models.
- [ ] Implement `src/services/fdm1Pipeline.ts`:
  - SCRFD pre-processing (letterbox scaling, RGB normalization).
  - Landmark extraction & affine rotation transformation for face alignment.
  - ArcFace 512-D vector extraction.
  - Cosine similarity matching against enrolled identities.
- [ ] Implement `src/services/faceRegistryDB.ts`:
  - IndexedDB storage for enrolled subjects (name, photo thumbnail, 512-D embedding).

### Phase 5: UI Branding & Face Registry Modal
- [ ] Brand application UI:
  - Header: `Blacksrj FDM-1 (Face Detection Mark 1)`
  - Telemetry HUD: Real-time name identification, confidence score (%), estimated distance (~Xm), and FPS.
- [ ] Add `Face Registry & Enrollment Modal`:
  - Upload / capture photos of a person.
  - Enter person's name and compute 512-D neural fingerprint.
  - List, inspect, and delete enrolled subjects offline.
- [ ] Update Model Selector:
  - Add `🎯 Blacksrj FDM-1 (Face & Biometric Identity)` as primary SOTA model.
  - Keep existing general object detection models accessible.

## Status & Delivery Summary
- [x] **Models Sourced & Packaged**: `blacksrj_fdm1_detector.onnx` (~3.2MB) + `blacksrj_fdm1_recognizer.onnx` (~13MB) + `blacksrj_fdm1_config.json` placed on phone at `/sdcard/Face Detection M1/models/`.
- [x] **App Branding & Logo**: App configured as `Face Detection M1` (`FDM1.blacksrj.apps`). Launcher icons generated across all mipmap densities from uploaded eWARN logo.
- [x] **Native Android Integration**: Scaffolding initialized, camera/storage permissions granted, webview media autoplay enabled.
- [x] **Blacksrj FDM-1 Neural Pipeline**: Long-range 10ft+ face detection (SCRFD) and 512-D ArcFace biometric feature extractor with Cosine Similarity matching and IndexedDB registry.
- [x] **Build & Packaging**: Built with Java 21 & Gradle 8.14.3. APK size: **37.5 MB** (well under the 40 MB budget!).
- [x] **Delivered to Phone**: Available at `/sdcard/Download/Face_Detection_M1.apk`.
