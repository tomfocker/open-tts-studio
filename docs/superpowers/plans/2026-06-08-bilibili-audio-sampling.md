# Bilibili Audio Sampling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an in-app Bilibili audio sampling workflow that downloads audio, converts/cuts it to WAV, and adds it to the existing voice library for cloning.

**Architecture:** Keep Bilibili login, parsing, downloading, FFmpeg conversion, and cancellation inside the Electron main process. Keep FastAPI responsible for voice-library persistence and TTS generation. React coordinates the workflow through a safe preload bridge and calls the existing `createVoice` API after extraction succeeds.

**Tech Stack:** Electron CommonJS main process, React/Vite/TypeScript renderer, Node test runner, FastAPI voice API, FFmpeg via `OPEN_TTS_FFMPEG_PATH`, bundled resources, `ffmpeg-static`, or system `ffmpeg`.

---

### Task 1: Main-Process Runtime Tests

**Files:**
- Create: `D:\code\tts\apps\desktop\electron\bilibili-sampler-runtime.test.cjs`
- Create later: `D:\code\tts\apps\desktop\electron\bilibili-sampler-runtime.cjs`

- [ ] **Step 1: Write failing tests**

Create tests for:
- default state and link parsing rejection
- parsing a multi-page Bilibili video
- loading audio options for the selected item
- extracting a clipped WAV with FFmpeg arguments
- rejecting invalid time ranges
- cancelling an active extraction

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:electron -- bilibili-sampler-runtime.test.cjs`

Expected: fails because `bilibili-sampler-runtime.cjs` does not exist.

- [ ] **Step 3: Implement runtime**

Implement `BilibiliSamplerService` with dependency injection:
- `getState()`
- `onStateChanged(listener)`
- `loadSession()`
- `bootstrapQrLogin()`
- `pollLogin()`
- `logout()`
- `parseLink({ url })`
- `loadAudioOptions({ kind, itemId })`
- `extractSample({ outputDirectory, startSeconds, endSeconds, sampleName })`
- `cancelExtract()`

The implementation should use Bilibili web API endpoints from the existing onetool service and only expose audio-only extraction.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:electron -- bilibili-sampler-runtime.test.cjs`

Expected: all sampler runtime tests pass.

- [ ] **Step 5: Commit status**

Skip git commit because `D:\code\tts` is not a git repository.

### Task 2: Desktop Runtime Helpers

**Files:**
- Modify: `D:\code\tts\apps\desktop\electron\desktop-runtime.cjs`
- Modify: `D:\code\tts\apps\desktop\electron\desktop-runtime.test.cjs`

- [ ] **Step 1: Write failing tests**

Add tests for:
- `resolveFfmpegPath()` preferring `OPEN_TTS_FFMPEG_PATH`
- `resolveFfmpegPath()` falling back to a packaged resource path
- `resolveInputDirectory()` returning `data\inputs\bilibili`

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:electron -- desktop-runtime.test.cjs`

Expected: fails because helpers are not exported.

- [ ] **Step 3: Implement helpers**

Add:
- `resolveFfmpegPath(paths, options)`
- `resolveBilibiliInputsDirectory(paths)`

The FFmpeg resolver should check environment, resource path, `ffmpeg-static`, then `ffmpeg`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:electron -- desktop-runtime.test.cjs`

Expected: desktop runtime tests pass.

### Task 3: IPC and Preload Bridge

**Files:**
- Modify: `D:\code\tts\apps\desktop\electron\main.cjs`
- Modify: `D:\code\tts\apps\desktop\electron\preload.cjs`
- Test through: `D:\code\tts\apps\desktop\electron\bilibili-sampler-runtime.test.cjs`

- [ ] **Step 1: Add bridge surface**

Expose `window.desktopBilibiliSampler` methods:
- `getSession`
- `startLogin`
- `pollLogin`
- `logout`
- `parseLink`
- `loadAudioOptions`
- `extractSample`
- `cancelExtract`
- `onStateChanged`

- [ ] **Step 2: Register IPC handlers**

Wire handlers in `main.cjs` to a singleton `BilibiliSamplerService`, using app paths, FFmpeg resolver, and default input directory.

- [ ] **Step 3: Run Electron tests**

Run: `npm run test:electron`

Expected: existing Electron tests and new sampler tests pass.

### Task 4: Renderer Types and API Shape

**Files:**
- Modify: `D:\code\tts\apps\desktop\src\types.ts`
- Modify: `D:\code\tts\apps\desktop\src\App.tsx`

- [ ] **Step 1: Define renderer types**

Add Bilibili sampler state, session, parsed link, item, stream summary, extraction request, and extraction result types.

- [ ] **Step 2: Extend global window typing**

Add `desktopBilibiliSampler` to the existing global declaration in `App.tsx`.

- [ ] **Step 3: Keep voice API unchanged**

Continue calling existing `createVoice({ reference_audio, reference_text, authorization_status })`.

### Task 5: Renderer Workflow

**Files:**
- Modify: `D:\code\tts\apps\desktop\src\App.tsx`
- Modify: `D:\code\tts\apps\desktop\src\styles.css`

- [ ] **Step 1: Add sampler state**

Add state for:
- modal open/closed
- login QR URL
- QR data URL
- link input
- selected item
- start/end seconds
- sample name
- reference text
- pending action
- extraction result

- [ ] **Step 2: Add event handlers**

Add handlers for:
- open sampler
- start login
- poll login
- logout
- parse link
- select item
- extract sample
- create voice from extracted WAV
- cancel extraction

- [ ] **Step 3: Add modal UI**

Add a compact settings-style modal:
- login section
- link parser
- item selector
- clipping form
- footer actions

- [ ] **Step 4: Add styles**

Follow the existing panel style:
- 8px radius
- compact form controls
- clear disabled/loading states
- no nested cards
- no marketing copy

### Task 6: Dependencies and Output Directory

**Files:**
- Modify: `D:\code\tts\apps\desktop\package.json`
- Modify: `D:\code\tts\apps\desktop\package-lock.json`
- Add: `D:\code\tts\data\inputs\bilibili\.gitkeep`

- [ ] **Step 1: Install dependencies**

Run: `npm install qrcode @types/qrcode`

Do not require `ffmpeg-static` in this implementation because its postinstall downloads a large FFmpeg binary and can fail on transient TLS/network errors. FFmpeg resolution remains environment path, packaged resource path, optional `ffmpeg-static` if present, then system `ffmpeg`.

- [ ] **Step 2: Add output directory placeholder**

Create `data\inputs\bilibili\.gitkeep`.

### Task 7: Verification

**Files:**
- All changed files

- [ ] **Step 1: Run Electron tests**

Run: `npm run test:electron`

Expected: all Electron tests pass.

- [ ] **Step 2: Run frontend build**

Run: `npm run build`

Expected: Vite build succeeds.

- [ ] **Step 3: Run API tests**

Run from `D:\code\tts\apps\api`: `.venv\Scripts\python.exe -m pytest`

Expected: API tests pass.

- [ ] **Step 4: Manual app smoke**

Run the desktop app if feasible and verify the UI opens without renderer errors.

Expected: OpenTTS Studio loads and the B 站取样 button opens the modal.
