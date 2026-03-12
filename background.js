chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.type !== "mvr-download-url") {
    return false;
  }

  chrome.downloads.download(
    {
      url: message.url,
      filename: message.filename,
      saveAs: false
    },
    (downloadId) => {
      const runtimeError = chrome.runtime.lastError;

      if (runtimeError) {
        sendResponse({
          ok: false,
          error: runtimeError.message || "Download failed."
        });
        return;
      }

      sendResponse({
        ok: true,
        downloadId
      });
    }
  );

  return true;
});
