# 🧠 Smart Classroom — Complete Architecture & System Specification (`brain.md`)

This document serves as the **single source of truth (`brain.md`)** for the entire **Smart Classroom Multilingual Assistant & Real-Time Sync System**. It outlines the complete system architecture, data models, WebSocket protocols, streaming pipeline, frontend DOM micro-update engine, and deployment setup.

---

## 📐 1. System Overview & Technology Stack

| Layer | Technology | Primary Function |
| :--- | :--- | :--- |
| **Teacher App** | Android (Kotlin / Java) | Micro-chunk audio recording (100–250ms PCM), canvas vector stroke capture. |
| **Student Web App** | HTML5, Vanilla JavaScript, CSS3 | Low-latency streaming partial/final captions, vector canvas replay, Web Speech TTS, term chips. |
| **Backend Server** | Node.js, `ws` (WebSockets), HTTP REST | Persistent session gateway, ASR frame forwarding, async translation, sequence buffer recovery. |
| **Streaming ASR** | Deepgram WebSocket API / Mock Engine | Real-time speech recognition generating interim partials & final transcripts. |
| **Translation Engine** | Google GT-X NMT / MyMemory API | Async non-blocking translation with technical term preservation. |
| **Deployment Platform** | Render (`render.yaml`) | Node.js Web Service hosting WebSocket gateway & REST APIs. |

---

## 📁 2. Complete Repository Directory Structure

```
d:\prograamming\bobhacks\
├── brain.md                  # 🧠 Master System Architecture & Reference Specification
├── app.js                    # 🌐 Student Web App Core Logic & WebSocket Engine (Vanilla JS)
├── index.html                 # 🖥️ Student Web App Main Split-Screen UI Layout
├── style.css                 # 🎨 Glassmorphism Design System & Streaming CSS Utilities
├── teacher.html              # 👨‍🏫 Teacher Live Whiteboard & Caption Control Simulator
├── lectures.js               # 📚 Demo Recorded Sessions Data Store
├── package.json              # 📦 Root Package Configuration
├── render.yaml               # ☁️ Render Cloud Deployment Manifest & Environment Declarations
├── .gitignore                # 🙈 Git Exclusion Rules
│
└── server/                   # ⚙️ Render Backend Server Module
    ├── server.js             # 📡 Persistent WebSocket Gateway, Streaming ASR & REST Server
    ├── package.json          # 📦 Backend Node Dependencies (ws)
    ├── package-lock.json     # 🔒 Locked Dependency Tree
    ├── test-client.js        # 🧪 Realtime Pipeline Integration Test Suite
    └── README.md             # 📖 Backend Documentation
```

---

## 🔄 3. End-to-End Real-Time Pipeline Architecture

```
[ Teacher App (Android) ]
     │
     ├─► (Text Frame): audio_start { sessionId: "3899", encoding: "pcm_16bit", sampleRate: 16000 }
     ├─► (Binary PCM Frames): 100–250ms raw audio bytes
     └─► (Text Frame): stroke_event { stroke: { points, color, size } }
         │
         ▼
[ Render Node.js WebSocket Gateway (server/server.js) ]
     │
     ├───► [ Direct Binary Forwarding ] ──► [ Streaming ASR Engine (Deepgram WebSocket) ]
     │                                                    │
     │                                            (Interim & Final Transcripts)
     │                                                    │
     ├◄───────────────────────────────────────────────────┘
     │
     ├───► [ 1. Broadcast partial_caption IMMEDIATELY ] ───► [ Student Web Apps ] (Sub-second lag)
     │
     ├───► [ 2. Broadcast final_caption (same segmentId) ] ─► [ Student Web Apps ] (In-place update)
     │
     ├───► [ 3. Async Non-Blocking Task Queue ]
     │         ├──► Process Translation (Google GT-X) ──► Broadcast translation_update
     │         └──► Debounced Disk Write (3s) ──────────► sessions.json
     │
     └───► [ 4. Sequence Event Buffer ] ─────────────────► Missed Event Recovery on Reconnect
```

---

## 📦 4. Event Schemas & WebSocket Protocol

All WebSocket text messages follow a standardized JSON envelope structure:

```json
{
  "type": "audio_start | partial_caption | final_caption | translation_update | stroke_event | clear_canvas | heartbeat | subscribe | pong",
  "sessionId": "3899",
  "segmentId": "seg-171800100",
  "eventId": "evt-98765",
  "sequenceNumber": 104,
  "timestamp": 1718001000000,
  "status": "partial | final",
  "sourceText": "Welcome to today's lecture on recursion.",
  "translatedText": "पुनरावृत्ति (recursion) पर आज के व्याख्यान में आपका स्वागत है।",
  "payload": {}
}
```

### Event Specifications

1. **`audio_start`** (Teacher -> Server):
   - Initiates streaming ASR session.
   - Payload: `{ encoding: "pcm_16bit", sampleRate: 16000, channels: 1 }`.

2. **`partial_caption`** (Server -> Students):
   - Broadcast **immediately** upon receiving ASR interim results.
   - `status: "partial"`. Sub-second latency. Rendered in italic streaming style (`.caption-card.partial`).

3. **`final_caption`** (Server -> Students):
   - Broadcast when ASR detects end of utterance.
   - Contains the **SAME `segmentId`** as preceding partial captions.
   - Replaces partial text in-place without creating duplicate cards.

4. **`translation_update`** (Server -> Students):
   - Broadcast asynchronously after translation completes.
   - Contains the **SAME `segmentId`** as final caption. Updates translated text in-place.

5. **`stroke_event`** (Teacher <-> Server <-> Students):
   - Contains vector points `[[x1, y1], [x2, y2], ...]`, stroke color, and width.
   - Rendered on HTML5 canvas in real time.

6. **`subscribe`** (Student -> Server):
   - Sent upon WebSocket `onopen`: `{ type: "subscribe", sessionId: "3899", lastSequenceNumber: 102 }`.
   - Server replays missed events where `sequenceNumber > lastSequenceNumber`.

7. **`heartbeat` / `pong`**:
   - Server sends `{ type: "heartbeat" }` every 30s. Client replies with `{ type: "pong" }`.

---

## 🏛️ 5. Component Breakdown & Core Implementation Details

### A. Backend (`server/server.js`)
* **`SessionState` Class**: Holds session metadata, active teacher socket, set of student subscriber sockets, circular `eventBuffer` (max 500 events), and `sequenceNumber` counter.
* **Universal Stroke Extractor (`extractStrokesFromPayload`)**: Safely unwraps nested stroke formats (`points`, `path`, coordinate arrays).
* **Async Non-Blocking Pipeline**: Translation (`processAsyncTranslation`) and disk saves (`scheduleDebouncedSave`) execute asynchronously so the main WebSocket broadcast loop is never blocked.

### B. Student Web App (`app.js`)
* **Dynamic Room Switching**: `getWebSocketUrl()` dynamically attaches `?role=student&sessionId=${currentSessionId}` allowing students to join any teacher session code (e.g. `3899`).
* **4 Connection States**: Handles `connecting`, `live`, `reconnecting`, and `offline` visual badge states in `updateConnectionStateUI()`.
* **Targeted DOM Micro-Updates**: `updateSingleCaptionCard(segment)` and `appendSingleCaptionCard(segment)` modify specific `#card-${segmentId}` DOM nodes directly rather than re-rendering the full feed.
* **Stage Latency Logging**: Logs timestamps for `browserRendered` events.
* **Recording & Export Engine (Option 4: Dual-Store Strategy)**:
  - **Vector Event Stream**: Instant 0-second post-class playback with sharp 4K vector strokes and clickable caption scrubbing.
  - **Export PDF Lecture Summary (`exportPDFNotes`)**: Generates printable lecture summary sheet with metadata, whiteboard canvas snapshot, preserved technical term chips, and full transcript table.
  - **Export Subtitles (`exportWebVTTSubtitles`)**: Formats segments into standard WebVTT (`.vtt`) subtitle files for instant download.

---

## ⚙️ 6. Cloud Deployment Configuration (`render.yaml`)

```yaml
services:
  - type: web
    name: smart-classroom-backend
    env: node
    plan: free
    buildCommand: cd server && npm install
    startCommand: node server/server.js
    envVars:
      - key: PORT
        value: 10000
      - key: ASR_PROVIDER
        value: mock  # 'deepgram' | 'mock'
      - key: DEEPGRAM_API_KEY
        sync: false
```

---

## 🛠️ 7. Developer Cheat Sheet & Quick Commands

* **Run Backend Locally**:
  ```bash
  cd server && node server.js
  ```
* **Run Integration Test Suite**:
  ```bash
  node server/test-client.js
  ```
* **Revert Code**:
  ```bash
  git reset --hard <commit-id> && git push origin main --force
  ```
