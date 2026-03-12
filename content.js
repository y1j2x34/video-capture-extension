(() => {
  const BUTTON_MARGIN = 12;
  const MIN_VIDEO_WIDTH = 160;
  const MIN_VIDEO_HEIGHT = 90;
  const videoStates = new WeakMap();
  const states = new Set();
  let refreshScheduled = false;

  function getSupportedMimeType() {
    const candidates = [
      "video/webm;codecs=vp9,opus",
      "video/webm;codecs=vp8,opus",
      "video/webm;codecs=vp9",
      "video/webm;codecs=vp8",
      "video/webm"
    ];

    if (typeof MediaRecorder === "undefined") {
      return "";
    }

    return candidates.find((type) => MediaRecorder.isTypeSupported(type)) || "";
  }

  function sanitizeFilenamePart(value) {
    return (value || "video")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "video";
  }

  function createFilename() {
    const title = sanitizeFilenamePart(document.title);
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    return `${title}-${timestamp}.webm`;
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
      button.title = "Record this video";
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

    button.textContent = "Stop";
    button.title = "Stop recording and download";
  }

  function resetState(state) {
    state.status = "idle";
    state.pendingStart = false;
    state.chunks = [];
    state.stream = null;
    state.recorder = null;
    state.mimeType = "video/webm";
    updateButtonState(state);
    scheduleRefresh();
  }

  function cleanupStream(stream) {
    if (!stream) {
      return;
    }

    stream.getTracks().forEach((track) => track.stop());
  }

  function triggerDownload(blob) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = createFilename();
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

    cleanupStream(state.stream);

    if (blob.size > 0) {
      triggerDownload(blob);
    }

    resetState(state);
  }

  function startRecording(state) {
    if (state.status !== "armed" && state.status !== "recording") {
      return;
    }

    if (state.status === "recording") {
      return;
    }

    const video = state.video;
    const captureStream =
      video.captureStream || video.mozCaptureStream || null;

    if (!captureStream) {
      state.status = "unsupported";
      updateButtonState(state);
      window.setTimeout(() => resetState(state), 1800);
      return;
    }

    const mimeType = getSupportedMimeType();

    if (!mimeType) {
      state.status = "unsupported";
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

    if (state.status === "armed") {
      resetState(state);
      return;
    }

    state.status = "armed";
    state.pendingStart = true;
    updateButtonState(state);

    if (!state.video.paused && !state.video.ended && state.video.readyState > 2) {
      startRecording(state);
    }
  }

  function updateButtonPosition(state) {
    const { video, button } = state;

    if (!document.contains(video) || !isVideoVisible(video)) {
      button.classList.remove("is-visible");
      return;
    }

    const rect = video.getBoundingClientRect();
    const left = Math.max(BUTTON_MARGIN, rect.right - button.offsetWidth - BUTTON_MARGIN);
    const top = Math.max(BUTTON_MARGIN, rect.top + BUTTON_MARGIN);

    button.style.left = `${left}px`;
    button.style.top = `${top}px`;
    button.classList.add("is-visible");
  }

  function scheduleRefresh() {
    if (refreshScheduled) {
      return;
    }

    refreshScheduled = true;

    window.requestAnimationFrame(() => {
      refreshScheduled = false;
      refreshAllButtons();
    });
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

  function onVideoPause(event) {
    const state = videoStates.get(event.currentTarget);
    if (state && state.status === "armed" && event.currentTarget.ended) {
      resetState(state);
    }
  }

  function createState(video) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "mvr-record-button";

    const state = {
      video,
      button,
      status: "idle",
      pendingStart: false,
      recorder: null,
      stream: null,
      chunks: [],
      mimeType: "video/webm"
    };

    updateButtonState(state);

    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      armRecording(state);
    });

    video.addEventListener("playing", onVideoPlaying);
    video.addEventListener("ended", onVideoEnded);
    video.addEventListener("pause", onVideoPause);

    document.documentElement.appendChild(button);
    videoStates.set(video, state);
    states.add(state);
    updateButtonPosition(state);
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
    stopRecording(state);
    cleanupStream(state.stream);
    state.video.removeEventListener("playing", onVideoPlaying);
    state.video.removeEventListener("ended", onVideoEnded);
    state.video.removeEventListener("pause", onVideoPause);
    state.button.remove();
    states.delete(state);
  }

  function refreshAllButtons() {
    states.forEach((state) => {
      if (!document.contains(state.video)) {
        disposeState(state);
        return;
      }

      updateButtonPosition(state);
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

  scanVideos();
  refreshAllButtons();

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
