(() => {
  const BUTTON_MARGIN = 12;
  const PANEL_GAP = 8;
  const MIN_VIDEO_WIDTH = 160;
  const MIN_VIDEO_HEIGHT = 90;
  const DIRECT_DOWNLOAD_EXTENSIONS = new Set([
    ".mp4",
    ".webm",
    ".ogg",
    ".ogv",
    ".mov",
    ".m4v",
    ".mkv"
  ]);
  const FORMAT_CATALOG = [
    {
      format: "webm",
      label: "WebM",
      candidates: [
        "video/webm;codecs=vp9,opus",
        "video/webm;codecs=vp8,opus",
        "video/webm;codecs=vp9",
        "video/webm;codecs=vp8",
        "video/webm"
      ]
    },
    {
      format: "mp4",
      label: "MP4",
      candidates: [
        "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
        "video/mp4;codecs=avc1,mp4a.40.2",
        "video/mp4;codecs=h264,mp4a.40.2",
        "video/mp4"
      ]
    },
    {
      format: "ogg",
      label: "Ogg",
      candidates: [
        "video/ogg;codecs=theora,opus",
        "video/ogg;codecs=theora",
        "video/ogg"
      ]
    },
    {
      format: "mkv",
      label: "Matroska",
      candidates: [
        "video/x-matroska;codecs=vp9,opus",
        "video/x-matroska;codecs=avc1,opus",
        "video/x-matroska"
      ]
    }
  ];
  const videoStates = new WeakMap();
  const states = new Set();
  const formatSupport = detectFormatSupport();
  let refreshScheduled = false;

  function detectFormatSupport() {
    return FORMAT_CATALOG.map((entry) => {
      const supportedMimeType =
        typeof MediaRecorder === "undefined"
          ? ""
          : entry.candidates.find((type) => MediaRecorder.isTypeSupported(type)) || "";

      return {
        ...entry,
        supportedMimeType,
        isSupported: Boolean(supportedMimeType)
      };
    });
  }

  function getSupportedFormat(format) {
    return formatSupport.find((entry) => entry.format === format) || null;
  }

  function getFirstSupportedFormat() {
    return formatSupport.find((entry) => entry.isSupported) || formatSupport[0];
  }

  function getSupportedMimeType(format) {
    const supportedFormat = getSupportedFormat(format);

    if (!supportedFormat) {
      return "";
    }

    return supportedFormat.supportedMimeType;
  }

  function getFormatLabel(format) {
    const supportedFormat = getSupportedFormat(format);

    if (!supportedFormat) {
      return format.toUpperCase();
    }

    return supportedFormat.label;
  }

  function getFormatStatusLabel(entry) {
    if (typeof MediaRecorder === "undefined") {
      return "Unavailable";
    }

    if (entry.isSupported) {
      return "Available";
    }

    return "Not available";
  }

  function sanitizeFilenameBase(value) {
    return (value || "")
      .replace(/\.[a-z0-9]{2,5}$/i, "")
      .replace(/[\\/:*?"<>|]+/g, "-")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80);
  }

  function createDefaultFilenameBase() {
    const title = sanitizeFilenameBase(document.title) || "Recorded Video";
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    return `${title} ${timestamp}`;
  }

  function createDownloadFilename(baseName, format) {
    const normalizedBase = sanitizeFilenameBase(baseName) || createDefaultFilenameBase();
    return `${normalizedBase}.${format}`;
  }

  function getVideoSourceUrl(video) {
    const sourceElement = video.querySelector("source[src]");
    return video.currentSrc || video.src || sourceElement?.src || "";
  }

  function getPathExtension(pathname) {
    const match = pathname.toLowerCase().match(/\.[a-z0-9]{2,5}$/);
    return match ? match[0] : "";
  }

  function isDirectDownloadableUrl(value) {
    if (!value) {
      return false;
    }

    try {
      const url = new URL(value, window.location.href);
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        return false;
      }

      return DIRECT_DOWNLOAD_EXTENSIONS.has(getPathExtension(url.pathname));
    } catch {
      return false;
    }
  }

  function createDirectDownloadFilename(urlValue) {
    try {
      const url = new URL(urlValue, window.location.href);
      const pathname = decodeURIComponent(url.pathname);
      const rawName = pathname.split("/").pop() || "";
      const extension = getPathExtension(rawName);
      const baseName = sanitizeFilenameBase(rawName.replace(/\.[a-z0-9]{2,5}$/i, ""));

      if (baseName && extension) {
        return `${baseName}${extension}`;
      }
    } catch {
      // Fall back to the default generated name below.
    }

    return `${createDefaultFilenameBase()}.mp4`;
  }

  function requestDirectDownload(url, filename) {
    return new Promise((resolve, reject) => {
      if (!chrome?.runtime?.sendMessage) {
        reject(new Error("Downloads API is unavailable."));
        return;
      }

      chrome.runtime.sendMessage(
        {
          type: "mvr-download-url",
          url,
          filename
        },
        (response) => {
          const runtimeError = chrome.runtime.lastError;

          if (runtimeError) {
            reject(new Error(runtimeError.message || "Download request failed."));
            return;
          }

          if (!response?.ok) {
            reject(new Error(response?.error || "Download request failed."));
            return;
          }

          resolve(response);
        }
      );
    });
  }

  async function tryDirectDownload(state) {
    const sourceUrl = getVideoSourceUrl(state.video);

    if (!isDirectDownloadableUrl(sourceUrl)) {
      return false;
    }

    state.status = "downloading";
    state.pendingStart = false;
    state.downloadInFlight = true;
    updateButtonState(state);

    try {
      await requestDirectDownload(sourceUrl, createDirectDownloadFilename(sourceUrl));
      window.setTimeout(() => resetState(state), 1200);
      return true;
    } catch {
      resetState(state);
      return false;
    }
  }

  function isVideoVisible(video) {
    const rect = video.getBoundingClientRect();
    const style = window.getComputedStyle(video);
    return (
      rect.width >= MIN_VIDEO_WIDTH &&
      rect.height >= MIN_VIDEO_HEIGHT &&
      rect.bottom > 0 &&
      rect.right > 0 &&
      rect.top < window.innerHeight &&
      rect.left < window.innerWidth &&
      style.visibility !== "hidden" &&
      style.display !== "none"
    );
  }

  function updateButtonState(state) {
    const { button, status } = state;

    button.dataset.state = status;

    if (status === "idle") {
      button.textContent = "Record";
      button.title = "Open recording settings";
      return;
    }

    if (status === "panel") {
      button.textContent = "Close";
      button.title = "Close recording settings";
      return;
    }

    if (status === "armed") {
      button.textContent = "Waiting";
      button.title = "Waiting for playback to start";
      return;
    }

    if (status === "unsupported") {
      button.textContent = "Unsupported";
      button.title = "Recording is not available for this video";
      return;
    }

    if (status === "downloading") {
      button.textContent = "Downloading";
      button.title = "Downloading the video file directly";
      return;
    }

    button.textContent = "Stop";
    button.title = "Stop recording and download";
  }

  function updateFilenamePreview(state) {
    state.downloadFilename = createDownloadFilename(state.filenameBase, state.selectedFormat);

    if (state.filenameInput) {
      const normalizedBase = sanitizeFilenameBase(state.filenameInput.value);
      if (normalizedBase !== state.filenameInput.value.trim()) {
        state.filenameInput.value = normalizedBase || "";
      }
    }

    if (state.filenamePreview) {
      state.filenamePreview.textContent = `Download as ${state.downloadFilename}`;
    }
  }

  function hidePanel(state) {
    state.isPanelOpen = false;
    state.panel.classList.remove("is-visible");
  }

  function showPanel(state) {
    state.status = "panel";
    state.isPanelOpen = true;
    state.filenameInput.value = state.filenameBase;
    const selectedFormatInput = state.panel.querySelector(
      `input[name="${state.formatInputName}"][value="${state.selectedFormat}"]`
    );
    if (selectedFormatInput) {
      selectedFormatInput.checked = true;
    }
    updateButtonState(state);
    updateFilenamePreview(state);
    state.panel.classList.add("is-visible");
    scheduleRefresh();
    window.setTimeout(() => state.filenameInput.focus(), 0);
  }

  function resetState(state) {
    state.status = "idle";
    state.pendingStart = false;
    state.isPanelOpen = false;
    state.chunks = [];
    state.stream = null;
    state.recorder = null;
    state.mimeType = "";
    state.downloadInFlight = false;
    hidePanel(state);
    updateButtonState(state);
    scheduleRefresh();
  }

  function cleanupStream(stream) {
    if (!stream) {
      return;
    }

    stream.getTracks().forEach((track) => track.stop());
  }

  function triggerDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.style.display = "none";
    document.documentElement.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }

  function stopRecording(state) {
    if (!state.recorder) {
      resetState(state);
      return;
    }

    if (state.recorder.state !== "inactive") {
      state.recorder.stop();
      return;
    }

    resetState(state);
  }

  function finishRecording(state) {
    const mimeType = state.mimeType || "video/webm";
    const blob = new Blob(state.chunks, { type: mimeType });
    const downloadFilename = state.downloadFilename;

    cleanupStream(state.stream);

    if (blob.size > 0) {
      triggerDownload(blob, downloadFilename);
    }

    resetState(state);
  }

  function startRecording(state) {
    if (state.status !== "armed") {
      return;
    }

    const video = state.video;
    const captureStream = video.captureStream || video.mozCaptureStream || null;

    if (!captureStream) {
      state.status = "unsupported";
      hidePanel(state);
      updateButtonState(state);
      window.setTimeout(() => resetState(state), 1800);
      return;
    }

    const mimeType = getSupportedMimeType(state.selectedFormat);

    if (!mimeType) {
      state.status = "unsupported";
      hidePanel(state);
      updateButtonState(state);
      window.setTimeout(() => resetState(state), 1800);
      return;
    }

    try {
      state.stream = captureStream.call(video);
      state.mimeType = mimeType;
      state.chunks = [];
      state.recorder = new MediaRecorder(state.stream, { mimeType });
      state.status = "recording";
      state.pendingStart = false;
      hidePanel(state);
      updateButtonState(state);

      state.recorder.addEventListener("dataavailable", (event) => {
        if (event.data && event.data.size > 0) {
          state.chunks.push(event.data);
        }
      });

      state.recorder.addEventListener(
        "stop",
        () => {
          finishRecording(state);
        },
        { once: true }
      );

      state.recorder.addEventListener(
        "error",
        () => {
          cleanupStream(state.stream);
          resetState(state);
        },
        { once: true }
      );

      state.recorder.start(1000);
    } catch (error) {
      cleanupStream(state.stream);
      resetState(state);
    }
  }

  function armRecording(state) {
    if (state.status === "recording") {
      stopRecording(state);
      return;
    }

    const checkedFormat = state.panel.querySelector(
      `input[name="${state.formatInputName}"]:checked`
    );
    const defaultFormat = getFirstSupportedFormat();
    state.selectedFormat = checkedFormat ? checkedFormat.value : defaultFormat.format;
    state.filenameBase = sanitizeFilenameBase(state.filenameInput.value) || createDefaultFilenameBase();
    updateFilenamePreview(state);

    state.status = "armed";
    state.pendingStart = true;
    hidePanel(state);
    updateButtonState(state);

    if (!state.video.paused && !state.video.ended && state.video.readyState > 2) {
      startRecording(state);
    }
  }

  function updateButtonPosition(state) {
    const { video, button } = state;

    if (!document.contains(video) || !isVideoVisible(video)) {
      button.classList.remove("is-visible");
      state.panel.classList.remove("is-visible");
      return;
    }

    const rect = video.getBoundingClientRect();
    const left = Math.max(BUTTON_MARGIN, rect.right - button.offsetWidth - BUTTON_MARGIN);
    const top = Math.max(BUTTON_MARGIN, rect.top + BUTTON_MARGIN);

    button.style.left = `${left}px`;
    button.style.top = `${top}px`;
    button.classList.add("is-visible");
  }

  function updatePanelPosition(state) {
    const { panel, button, video } = state;

    if (!state.isPanelOpen || !document.contains(video) || !isVideoVisible(video)) {
      panel.classList.remove("is-visible");
      return;
    }

    const buttonRect = button.getBoundingClientRect();
    const videoRect = video.getBoundingClientRect();
    const panelWidth = panel.offsetWidth || 240;
    const panelHeight = panel.offsetHeight || 170;
    const maxLeft = window.innerWidth - panelWidth - BUTTON_MARGIN;
    const maxTop = window.innerHeight - panelHeight - BUTTON_MARGIN;
    const alignedRight = buttonRect.right - panelWidth;
    const belowButton = buttonRect.bottom + PANEL_GAP;
    const fallbackAbove = buttonRect.top - panelHeight - PANEL_GAP;
    const left = Math.min(Math.max(BUTTON_MARGIN, alignedRight), Math.max(BUTTON_MARGIN, maxLeft));
    const preferredTop = belowButton <= maxTop ? belowButton : fallbackAbove;
    const top = Math.min(
      Math.max(BUTTON_MARGIN, preferredTop),
      Math.max(BUTTON_MARGIN, maxTop)
    );

    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
    panel.classList.add("is-visible");

    if (videoRect.bottom < 0 || videoRect.top > window.innerHeight) {
      panel.classList.remove("is-visible");
    }
  }

  function scheduleRefresh() {
    if (refreshScheduled) {
      return;
    }

    refreshScheduled = true;

    window.requestAnimationFrame(() => {
      refreshScheduled = false;
      refreshAllOverlays();
    });
  }

  function closePanel(state) {
    if (!state.isPanelOpen) {
      return;
    }

    resetState(state);
  }

  function onVideoPlaying(event) {
    const state = videoStates.get(event.currentTarget);
    if (state && state.pendingStart) {
      startRecording(state);
    }
  }

  function onVideoEnded(event) {
    const state = videoStates.get(event.currentTarget);
    if (state && state.status === "recording") {
      stopRecording(state);
    } else if (state && state.status === "armed") {
      resetState(state);
    }
  }

  function onFormatChange(event) {
    const state = statesForElement(event.currentTarget);
    if (!state) {
      return;
    }

    state.selectedFormat = event.currentTarget.value;
    updateFilenamePreview(state);
  }

  function onFilenameInput(event) {
    const state = statesForElement(event.currentTarget);
    if (!state) {
      return;
    }

    state.filenameBase = event.currentTarget.value;
    updateFilenamePreview(state);
  }

  function statesForElement(element) {
    let current = element;

    while (current && current !== document.documentElement) {
      if (current.dataset && current.dataset.mvrStateId) {
        return Array.from(states).find((state) => state.id === current.dataset.mvrStateId) || null;
      }

      current = current.parentElement;
    }

    return null;
  }

  function createPanel(state) {
    const panel = document.createElement("div");
    const stateId = `mvr-${Math.random().toString(36).slice(2, 10)}`;
    const formatInputName = `${stateId}-format`;
    const formatOptionsMarkup = formatSupport
      .map((entry) => {
        const disabledClass = entry.isSupported ? "" : " is-disabled";
        const disabledAttr = entry.isSupported ? "" : " disabled";
        const checkedAttr = entry.format === state.selectedFormat ? " checked" : "";

        return `
          <label class="mvr-format-option${disabledClass}">
            <input type="radio" name="${formatInputName}" value="${entry.format}"${checkedAttr}${disabledAttr} />
            <span>${entry.label}</span>
            <span class="mvr-format-hint">${getFormatStatusLabel(entry)}</span>
          </label>
        `;
      })
      .join("");

    panel.className = "mvr-settings-panel";
    panel.dataset.mvrStateId = stateId;
    panel.innerHTML = `
      <div class="mvr-panel-title">Recording settings</div>
      <div class="mvr-panel-section">
        <span class="mvr-panel-label">Format</span>
        ${formatOptionsMarkup}
      </div>
      <label class="mvr-panel-section">
        <span class="mvr-panel-label">File name</span>
        <input class="mvr-filename-input" type="text" maxlength="80" placeholder="Recorded Video" />
      </label>
      <div class="mvr-panel-preview" aria-live="polite"></div>
      <div class="mvr-panel-actions">
        <button type="button" class="mvr-panel-button mvr-panel-button-primary">Start</button>
        <button type="button" class="mvr-panel-button">Cancel</button>
      </div>
    `;

    state.id = stateId;
    state.formatInputName = formatInputName;
    state.panel = panel;
    state.filenameInput = panel.querySelector(".mvr-filename-input");
    state.filenamePreview = panel.querySelector(".mvr-panel-preview");

    panel.querySelectorAll(`input[name="${formatInputName}"]`).forEach((input) => {
      input.addEventListener("change", onFormatChange);
    });
    state.filenameInput.addEventListener("input", onFilenameInput);
    state.filenameInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        armRecording(state);
      }
    });
    panel.querySelector(".mvr-panel-button-primary").addEventListener("click", () => {
      armRecording(state);
    });
    panel.querySelector(".mvr-panel-button:last-child").addEventListener("click", () => {
      closePanel(state);
    });

    document.documentElement.appendChild(panel);
  }

  async function handleButtonClick(state) {
    if (state.status === "recording") {
      stopRecording(state);
      return;
    }

    if (state.status === "downloading" || state.downloadInFlight) {
      return;
    }

    if (state.status === "armed") {
      resetState(state);
      return;
    }

    if (state.isPanelOpen) {
      closePanel(state);
      return;
    }

    states.forEach((currentState) => {
      if (currentState !== state && currentState.isPanelOpen) {
        closePanel(currentState);
      }
    });

    if (await tryDirectDownload(state)) {
      return;
    }

    showPanel(state);
  }

  function createState(video) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "mvr-record-button";

    const state = {
      id: "",
      video,
      button,
      panel: null,
      filenameInput: null,
      filenamePreview: null,
      status: "idle",
      pendingStart: false,
      isPanelOpen: false,
      recorder: null,
      stream: null,
      chunks: [],
      selectedFormat: getFirstSupportedFormat().format,
      filenameBase: createDefaultFilenameBase(),
      downloadFilename: "",
      mimeType: "",
      downloadInFlight: false
    };

    createPanel(state);
    updateFilenamePreview(state);
    updateButtonState(state);

    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      void handleButtonClick(state);
    });

    video.addEventListener("playing", onVideoPlaying);
    video.addEventListener("ended", onVideoEnded);

    document.documentElement.appendChild(button);
    videoStates.set(video, state);
    states.add(state);
    updateButtonPosition(state);
    updatePanelPosition(state);
  }

  function scanVideos(root = document) {
    const videos = root.querySelectorAll ? root.querySelectorAll("video") : [];
    videos.forEach((video) => {
      if (!videoStates.has(video)) {
        createState(video);
      }
    });

    if (root instanceof HTMLVideoElement && !videoStates.has(root)) {
      createState(root);
    }
  }

  function disposeState(state) {
    if (state.status === "recording") {
      stopRecording(state);
    } else {
      cleanupStream(state.stream);
    }

    state.video.removeEventListener("playing", onVideoPlaying);
    state.video.removeEventListener("ended", onVideoEnded);
    state.button.remove();
    state.panel.remove();
    states.delete(state);
  }

  function refreshAllOverlays() {
    states.forEach((state) => {
      if (!document.contains(state.video)) {
        disposeState(state);
        return;
      }

      updateButtonPosition(state);
      updatePanelPosition(state);
    });
  }

  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      mutation.addedNodes.forEach((node) => {
        if (node.nodeType === Node.ELEMENT_NODE) {
          scanVideos(node);
        }
      });
    });

    scheduleRefresh();
  });

  document.addEventListener("pointerdown", (event) => {
    states.forEach((state) => {
      if (!state.isPanelOpen) {
        return;
      }

      if (state.panel.contains(event.target) || state.button.contains(event.target)) {
        return;
      }

      closePanel(state);
    });
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") {
      return;
    }

    states.forEach((state) => {
      if (state.isPanelOpen) {
        closePanel(state);
      }
    });
  });

  scanVideos();
  refreshAllOverlays();

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true
  });

  ["scroll", "resize"].forEach((eventName) => {
    window.addEventListener(eventName, scheduleRefresh, true);
  });

  document.addEventListener("fullscreenchange", scheduleRefresh, true);

  window.addEventListener("beforeunload", () => {
    states.forEach((state) => {
      cleanupStream(state.stream);
    });
  });
})();
