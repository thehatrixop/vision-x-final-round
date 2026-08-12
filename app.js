/**
 * 🎓 Smart Classroom 2.0 — Student Web Application Core Engine
 * 
 * Handles real-time WebSocket connection, sequence gap recovery, target in-place caption
 * DOM updates (partial & final), vector canvas stroke rendering, Web Speech TTS,
 * and notes/subtitle export.
 */

// Preset Lecture Session Fallback Data
const DEMO_SESSIONS = [
  {
    id: "cs101-recursion",
    title: "CS101: Recursion & Binary Search Trees",
    instructor: "Prof. A. Sharma",
    durationSeconds: 45,
    segments: [
      {
        id: "seg-001",
        startTime: 0,
        endTime: 12,
        englishText: "Welcome to today's lecture on recursion and binary search trees.",
        translations: {
          hi: "पुनरावृत्ति (recursion) और बाइनरी सर्च ट्री पर आज के व्याख्यान में आपका स्वागत है।",
          bn: "রিকার্সন এবং বাইনারি সার্চ ট্রির আজকের লেকচারে স্বাগতম।",
          ar: "مرحبا بكم في محاضرة اليوم حول العودية وأشجار البحث الثنائية।",
          es: "Bienvenidos a la clase de hoy sobre recursividad y árboles de búsqueda binaria."
        },
        strokes: []
      }
    ]
  }
];

const TECHNICAL_TERMS = [
  "recursion", "base case", "call stack", "binary search tree", "root node", 
  "leaf node", "pointer", "memory", "algorithm", "binary search"
];

class SmartClassroomStudentApp {
  constructor() {
    this.currentSessionId = "cs101-recursion";
    this.currentLecture = DEMO_SESSIONS[0];
    this.currentLanguage = "en"; // Default to English for instant live streaming partial text
    this.currentTime = 0;
    this.isPlaying = true;
    this.isTTSOn = false;
    this.playbackSpeed = 1;
    this.activeSegmentId = null;
    
    // Live Real-Time Vector Strokes Array
    this.liveStrokes = [];
    
    // WebSocket & Sequence State
    this.ws = null;
    this.highestSequenceNumberReceived = 0;
    this.reconnectAttempts = 0;
    this.reconnectTimer = null;
    this.pingInterval = null;
    this.segmentsMap = new Map(); // Key: segmentId -> segment object
    
    // DOM Cache
    this.canvas = document.getElementById("whiteboard-canvas");
    this.ctx = this.canvas.getContext("2d");
    this.captionFeed = document.getElementById("caption-feed");
    this.timelineSlider = document.getElementById("timeline-slider");
    this.playBtn = document.getElementById("play-btn");
    this.currentTimeEl = document.getElementById("current-time");
    this.totalTimeEl = document.getElementById("total-time");
    this.langSelect = document.getElementById("lang-select");
    this.sessionSelect = document.getElementById("session-select");
    this.ttsBtn = document.getElementById("tts-btn");
    this.exportNotesBtn = document.getElementById("export-notes-btn");
    this.exportVttBtn = document.getElementById("export-vtt-btn");
    this.speedSelect = document.getElementById("speed-select");
    this.connectionBadge = document.getElementById("connection-badge");
    this.statusText = document.getElementById("status-text");
    this.debugConsole = document.getElementById("debug-console");

    this.initCanvasSize();
    this.bindEvents();
    this.loadLectureSession(this.currentLecture);
    this.connectWebSocket();
    this.startPlaybackLoop();
  }

  initCanvasSize() {
    const parent = this.canvas.parentElement;
    this.canvasWidth = parent.clientWidth || 800;
    this.canvasHeight = parent.clientHeight || 500;
    this.canvas.width = this.canvasWidth;
    this.canvas.height = this.canvasHeight;
  }

  bindEvents() {
    window.addEventListener("resize", () => {
      this.initCanvasSize();
      this.renderWhiteboardStrokes();
    });

    this.sessionSelect.addEventListener("change", (e) => {
      this.currentSessionId = e.target.value;
      const found = DEMO_SESSIONS.find(s => s.id === this.currentSessionId);
      if (found) {
        this.loadLectureSession(found);
      }
      this.connectWebSocket();
    });

    this.langSelect.addEventListener("change", (e) => {
      this.currentLanguage = e.target.value;
      this.logDebug("LANG", `Language switched to: ${this.currentLanguage}`);
      this.renderCaptions();
    });

    this.ttsBtn.addEventListener("click", () => {
      this.isTTSOn = !this.isTTSOn;
      this.ttsBtn.innerHTML = this.isTTSOn ? "🔊 TTS On" : "🔊 TTS Off";
      this.ttsBtn.classList.toggle("active", this.isTTSOn);
    });

    this.playBtn.addEventListener("click", () => this.togglePlayPause());

    this.timelineSlider.addEventListener("input", (e) => {
      this.currentTime = parseFloat(e.target.value);
      this.updateView();
    });

    this.speedSelect.addEventListener("change", (e) => {
      this.playbackSpeed = parseFloat(e.target.value);
    });

    this.exportNotesBtn.addEventListener("click", () => this.exportPDFNotes());
    this.exportVttBtn.addEventListener("click", () => this.exportWebVTTSubtitles());
  }

  // =========================================================================
  // Smart Vercel & Render WebSocket Location Resolver
  // =========================================================================
  getWebSocketUrl() {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get("backend")) {
      const customBackend = urlParams.get("backend");
      const wsProto = customBackend.startsWith("https") ? "wss:" : "ws:";
      const cleanHost = customBackend.replace("https://", "").replace("http://", "");
      return `${wsProto}//${cleanHost}?role=student&sessionId=${this.currentSessionId}`;
    }

    const isLocal = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
    if (isLocal) {
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      return `${protocol}//${window.location.hostname}:5000?role=student&sessionId=${this.currentSessionId}`;
    } else {
      // Production Vercel Deployment -> Connects to Render Backend WebSocket Gateway
      return `wss://smart-classroom-backend-y28y.onrender.com?role=student&sessionId=${this.currentSessionId}`;
    }
  }

  connectWebSocket() {
    if (this.ws) {
      this.ws.close();
    }

    const wsUrl = this.getWebSocketUrl();
    this.updateConnectionState("connecting", `CONNECTING...`);
    this.logDebug("WS", `Connecting to WebSocket: ${wsUrl}`);

    try {
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        this.reconnectAttempts = 0;
        this.updateConnectionState("live", `LIVE: ${this.currentSessionId}`);
        this.logDebug("WS", "WebSocket connection open. Subscribing...");
        
        this.ws.send(JSON.stringify({
          type: "subscribe",
          sessionId: this.currentSessionId,
          lastSequenceNumber: this.highestSequenceNumberReceived
        }));

        this.startHeartbeat();
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          this.handleIncomingMessage(data);
        } catch (err) {
          console.error("Message parse error:", err);
        }
      };

      this.ws.onclose = () => {
        this.stopHeartbeat();
        this.updateConnectionState("reconnecting", `RECONNECTING...`);
        this.scheduleReconnection();
      };

      this.ws.onerror = () => {
        this.logDebug("WS_ERR", "WebSocket connection error.");
      };

    } catch (e) {
      this.updateConnectionState("reconnecting", "RECONNECTING...");
      this.scheduleReconnection();
    }
  }

  scheduleReconnection() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(1.5, this.reconnectAttempts), 10000);
    this.logDebug("RECONNECT", `Retrying in ${Math.round(delay/1000)}s (Attempt ${this.reconnectAttempts})`);
    
    this.reconnectTimer = setTimeout(() => {
      this.connectWebSocket();
    }, delay);
  }

  startHeartbeat() {
    this.stopHeartbeat();
    this.pingInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: "pong", timestamp: Date.now() }));
      }
    }, 25000);
  }

  stopHeartbeat() {
    if (this.pingInterval) clearInterval(this.pingInterval);
  }

  updateConnectionState(stateClass, labelText) {
    this.connectionBadge.className = `status-badge ${stateClass}`;
    this.statusText.textContent = labelText;
  }

  // =========================================================================
  // Target In-Place Caption & Vector Stroke Message Router
  // =========================================================================
  handleIncomingMessage(data) {
    const now = Date.now();
    if (data.sequenceNumber && data.sequenceNumber > this.highestSequenceNumberReceived) {
      this.highestSequenceNumberReceived = data.sequenceNumber;
    }

    switch (data.type) {
      case "partial_caption":
      case "final_caption":
      case "translation_update":
        this.handleCaptionEvent(data, now);
        break;

      case "stroke":
      case "stroke_event":
        this.handleStrokeEvent(data);
        break;

      case "clear_canvas":
        this.liveStrokes = [];
        this.ctx.clearRect(0, 0, this.canvasWidth, this.canvasHeight);
        this.renderGridBackground();
        this.logDebug("CANVAS", "Canvas cleared by teacher.");
        break;

      case "heartbeat":
        break;

      default:
        break;
    }
  }

  handleCaptionEvent(data, receiveTimestamp) {
    const segmentId = data.segmentId || `seg-${data.timestamp || Date.now()}`;
    const status = data.status || (data.type === "partial_caption" ? "partial" : "final");

    let seg = this.segmentsMap.get(segmentId);
    if (!seg) {
      seg = {
        id: segmentId,
        startTime: Math.floor(this.currentTime),
        endTime: Math.floor(this.currentTime) + 5,
        englishText: data.sourceText || "",
        status: status,
        translations: {}
      };
      this.segmentsMap.set(segmentId, seg);
      this.currentLecture.segments.push(seg);
    } else {
      if (data.sourceText) seg.englishText = data.sourceText;
      seg.status = status;
    }

    if (data.translatedText && this.currentLanguage !== "en") {
      seg.translations[this.currentLanguage] = data.translatedText;
    }

    this.renderOrUpdateSingleCard(seg);

    if (data.timestamp) {
      const totalLatency = Math.max(5, receiveTimestamp - data.timestamp);
      this.logDebug("LATENCY LOG", `browserRendered for [${segmentId}] - End-to-End Latency: ${totalLatency}ms`);
    }

    if (this.isTTSOn && status === "final") {
      this.speakSegment(seg);
    }
  }

  handleStrokeEvent(data) {
    if (!data.stroke) return;
    this.liveStrokes.push(data.stroke);
    this.drawSingleStroke(data.stroke);
    this.logDebug("STROKE", `Received live stroke (${data.stroke.points.length} points)`);
  }

  // =========================================================================
  // Target DOM Micro-Updates (Instant In-Place Segment Mutation)
  // =========================================================================
  renderCaptions() {
    this.captionFeed.innerHTML = "";
    this.currentLecture.segments.forEach(seg => {
      this.segmentsMap.set(seg.id, seg);
      this.renderOrUpdateSingleCard(seg);
    });
  }

  renderOrUpdateSingleCard(seg) {
    let card = document.getElementById(`card-${seg.id}`);
    const textToDisplay = (this.currentLanguage !== "en" && seg.translations[this.currentLanguage])
      ? seg.translations[this.currentLanguage]
      : seg.englishText;

    const formattedText = this.highlightTechnicalTerms(textToDisplay);
    const timeLabel = this.formatTime(seg.startTime || 0);

    if (!card) {
      card = document.createElement("div");
      card.id = `card-${seg.id}`;
      card.className = `caption-card ${seg.status === "partial" ? "partial" : ""}`;
      
      card.innerHTML = `
        <div class="caption-meta">
          <span class="caption-time">⏱️ ${timeLabel}</span>
          <span class="caption-status" style="font-size:0.7rem;">${seg.status === "partial" ? "LIVE STREAMING" : "FINAL"}</span>
        </div>
        <div class="caption-text-source">${formattedText}</div>
        ${this.currentLanguage !== "en" && seg.translations[this.currentLanguage] ? `<div class="caption-text-translated">${seg.translations[this.currentLanguage]}</div>` : ''}
      `;

      card.addEventListener("click", () => {
        this.currentTime = seg.startTime;
        this.updateView();
      });

      this.captionFeed.appendChild(card);
      this.captionFeed.scrollTop = this.captionFeed.scrollHeight;
    } else {
      card.className = `caption-card ${seg.status === "partial" ? "partial" : ""}`;
      const srcEl = card.querySelector(".caption-text-source");
      if (srcEl) srcEl.innerHTML = formattedText;

      const statusEl = card.querySelector(".caption-status");
      if (statusEl) statusEl.textContent = seg.status === "partial" ? "LIVE STREAMING" : "FINAL";

      let transEl = card.querySelector(".caption-text-translated");
      if (this.currentLanguage !== "en" && seg.translations[this.currentLanguage]) {
        if (!transEl) {
          transEl = document.createElement("div");
          transEl.className = "caption-text-translated";
          card.appendChild(transEl);
        }
        transEl.textContent = seg.translations[this.currentLanguage];
      }
      this.captionFeed.scrollTop = this.captionFeed.scrollHeight;
    }
  }

  highlightTechnicalTerms(text) {
    let result = text;
    TECHNICAL_TERMS.forEach(term => {
      const regex = new RegExp(`\\b(${term})\\b`, "gi");
      result = result.replace(regex, `<span class="term-chip">$1</span>`);
    });
    return result;
  }

  // =========================================================================
  // Canvas Vector Stroke Renderer
  // =========================================================================
  loadLectureSession(session) {
    this.currentLecture = session;
    this.currentTime = 0;
    this.liveStrokes = [];
    this.timelineSlider.max = session.durationSeconds;
    this.totalTimeEl.textContent = this.formatTime(session.durationSeconds);
    this.renderCaptions();
    this.renderWhiteboardStrokes();
  }

  renderWhiteboardStrokes() {
    this.ctx.clearRect(0, 0, this.canvasWidth, this.canvasHeight);
    this.renderGridBackground();

    if (this.currentLecture && this.currentLecture.segments) {
      this.currentLecture.segments.forEach(segment => {
        if (this.currentTime < segment.startTime) return;
        if (segment.strokes) {
          segment.strokes.forEach(stroke => this.drawSingleStroke(stroke));
        }
      });
    }

    if (this.liveStrokes && this.liveStrokes.length > 0) {
      this.liveStrokes.forEach(stroke => this.drawSingleStroke(stroke));
    }
  }

  renderGridBackground() {
    this.ctx.strokeStyle = "rgba(255, 255, 255, 0.03)";
    this.ctx.lineWidth = 1;
    for (let x = 0; x < this.canvasWidth; x += 40) {
      this.ctx.beginPath();
      this.ctx.moveTo(x, 0);
      this.ctx.lineTo(x, this.canvasHeight);
      this.ctx.stroke();
    }
    for (let y = 0; y < this.canvasHeight; y += 40) {
      this.ctx.beginPath();
      this.ctx.moveTo(0, y);
      this.ctx.lineTo(this.canvasWidth, y);
      this.ctx.stroke();
    }
  }

  drawSingleStroke(stroke) {
    if (!stroke || !stroke.points || stroke.points.length < 2) return;
    this.ctx.beginPath();
    this.ctx.strokeStyle = stroke.color || "#38bdf8";
    this.ctx.lineWidth = stroke.size || 3;
    this.ctx.lineCap = "round";
    this.ctx.lineJoin = "round";

    stroke.points.forEach((p, idx) => {
      const x = p.x * this.canvasWidth;
      const y = p.y * this.canvasHeight;
      if (idx === 0) this.ctx.moveTo(x, y);
      else this.ctx.lineTo(x, y);
    });
    this.ctx.stroke();
  }

  // =========================================================================
  // Playback Loop & Web Speech TTS
  // =========================================================================
  togglePlayPause() {
    this.isPlaying = !this.isPlaying;
    this.playBtn.innerHTML = this.isPlaying ? "❚❚" : "▶";
  }

  startPlaybackLoop() {
    setInterval(() => {
      if (this.isPlaying) {
        this.currentTime += 0.2 * this.playbackSpeed;
        if (this.currentTime >= this.currentLecture.durationSeconds) {
          this.currentTime = this.currentLecture.durationSeconds;
          this.isPlaying = false;
          this.playBtn.innerHTML = "▶";
        }
        this.updateView();
      }
    }, 200);
  }

  updateView() {
    this.timelineSlider.value = this.currentTime;
    this.currentTimeEl.textContent = this.formatTime(this.currentTime);

    const activeSeg = this.currentLecture.segments.find(
      s => this.currentTime >= s.startTime && this.currentTime <= s.endTime
    );

    if (activeSeg && activeSeg.id !== this.activeSegmentId) {
      this.activeSegmentId = activeSeg.id;
      document.querySelectorAll(".caption-card").forEach(c => c.classList.remove("active-segment"));
      const card = document.getElementById(`card-${activeSeg.id}`);
      if (card) card.classList.add("active-segment");
    }

    this.renderWhiteboardStrokes();
  }

  speakSegment(seg) {
    if (!("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const text = (this.currentLanguage !== "en" && seg.translations[this.currentLanguage])
      ? seg.translations[this.currentLanguage]
      : seg.englishText;

    const utterance = new SpeechSynthesisUtterance(text.replace(/<[^>]*>/g, ""));
    utterance.rate = 1.0;
    window.speechSynthesis.speak(utterance);
  }

  // =========================================================================
  // Export Notes & Subtitles Engine
  // =========================================================================
  exportPDFNotes() {
    const printWindow = window.open("", "_blank");
    const html = `
      <html>
      <head>
        <title>Lecture Notes — ${this.currentLecture.title}</title>
        <style>
          body { font-family: sans-serif; padding: 30px; color: #1e293b; }
          h1 { color: #0284c7; }
          .seg-box { border-bottom: 1px solid #cbd5e1; padding: 12px 0; }
          .term { background: #e0e7ff; color: #4338ca; padding: 2px 6px; border-radius: 4px; font-weight: bold; }
        </style>
      </head>
      <body>
        <h1>📝 ${this.currentLecture.title}</h1>
        <p><strong>Instructor:</strong> ${this.currentLecture.instructor || "Prof. A. Sharma"}</p>
        <hr/>
        <h2>Lecture Transcript & Key Terms</h2>
        ${this.currentLecture.segments.map(s => `
          <div class="seg-box">
            <p><strong>[${this.formatTime(s.startTime)}]</strong> ${s.englishText}</p>
            ${s.translations.hi ? `<p style="color: #0369a1;"><em>${s.translations.hi}</em></p>` : ''}
          </div>
        `).join('')}
      </body>
      </html>
    `;
    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.print();
  }

  exportWebVTTSubtitles() {
    let vtt = "WEBVTT\n\n";
    this.currentLecture.segments.forEach((s, i) => {
      const start = this.formatVTTTime(s.startTime);
      const end = this.formatVTTTime(s.endTime || s.startTime + 5);
      vtt += `${i + 1}\n${start} --> ${end}\n${s.englishText}\n\n`;
    });

    const blob = new Blob([vtt], { type: "text/vtt" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${this.currentLecture.id}-subtitles.vtt`;
    a.click();
  }

  formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }

  formatVTTTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 1000);
    return `00:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;
  }

  logDebug(tag, msg) {
    const line = document.createElement("div");
    line.className = "debug-log-line";
    line.textContent = `[${new Date().toLocaleTimeString()}] [${tag}] ${msg}`;
    this.debugConsole.appendChild(line);
    this.debugConsole.scrollTop = this.debugConsole.scrollHeight;
  }
}

// Initialize Application when DOM ready
document.addEventListener("DOMContentLoaded", () => {
  window.app = new SmartClassroomStudentApp();
});
