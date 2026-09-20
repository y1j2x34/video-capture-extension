# VideoCaptureX

VideoCaptureX is a lightweight Chrome extension that adds a small **Record** button to HTML5 video players on web pages. When you click the button, a small floating settings panel opens so you can choose the recording format and the download file name before recording starts. The extension then waits for the video to start playing, records the video stream directly in the browser, and downloads the recorded file automatically when the recording finishes.

## Before You Start

Please note the following:

- This extension works with normal HTML5 `<video>` elements
- Some websites use protected video systems such as DRM, and those videos cannot be captured
- Some custom players may block stream capture or behave differently
- The settings panel lists multiple candidate video formats
- Format availability is detected automatically in your browser
- Only formats supported by your current browser can be selected

## How to Download

Once this project is uploaded to GitHub, you can download it in either of these ways.

### Option 1: Download ZIP from GitHub

1. Open the GitHub project page in your browser.
2. Click the green `Code` button.
3. Click `Download ZIP`.
4. After the download finishes, extract the ZIP file to a folder on your computer.
5. Remember the location of that folder. You will need it during installation.

### Option 2: Download from a Release

If the project later provides GitHub Releases:

1. Open the `Releases` section on GitHub.
2. Download the latest release source ZIP or packaged files.
3. Extract the downloaded file to a folder on your computer.

## How to Build a CRX Package

`pack-crx.sh` builds a signed `.crx` file. It uses the local Chrome or Chromium
binary to create the package, so the signature and the archive layout are
exactly what a Chrome-based browser expects.

Requirements: `bash`, Chrome or Chromium, and `openssl`.

```sh
./pack-crx.sh            # writes dist/minimal-video-recorder.crx
./pack-crx.sh -z         # also writes a plain .zip of the same files
./pack-crx.sh -k my.pem  # sign with a specific key
./pack-crx.sh -o out/app.crx
```

The script copies only the files the extension needs at runtime
(`manifest.json`, `background.js`, `content.js`, `content.css`, and `icons/`)
into a temporary directory, signs that directory, verifies the package
contains exactly those files, and reports the resulting extension ID.

### The Signing Key

Chrome derives the extension ID from the public part of the signing key. The
first run creates `keys/extension-key.pem` and reuses it on every later run, so
each build installs as the same extension and upgrades replace the previous
version instead of adding a second one.

Keep that file private and out of version control. Losing it means future
builds get a new extension ID; leaking it lets someone else publish builds
that browsers accept as this extension.

### Installing the Built CRX

Chrome refuses to install `.crx` files that are not distributed through the
Chrome Web Store, so a locally built package is normally installed by loading
the unpacked source folder instead (see the next section) or by enterprise
policy. The `.crx` file is what you upload when publishing to the Chrome Web
Store or hand to a system administrator for policy-based deployment.

## How to Install in Chrome

This extension is installed as an unpacked extension.

1. Open Chrome.
2. Type `chrome://extensions` in the address bar and press Enter.
3. Turn on `Developer mode` using the switch in the top-right corner.
4. Click `Load unpacked`.
5. Select the folder that contains this extension's files.
   The folder should include files such as `manifest.json`, `content.js`, and `content.css`.
6. Chrome will load the extension immediately.

If the extension is loaded correctly, it will appear in your extensions list as `VideoCaptureX`.

## How to Use

1. Open a page that contains a normal HTML5 video.
2. Wait until the page finishes loading.
3. Look at the top-right corner of the video player.
4. You should see a small `Record` button.
5. Click `Record`.
6. A small floating settings panel will open.
7. Choose one of the available formats in the settings panel.
8. Enter the file name you want to use.
9. Click `Start`.
10. If the video is not playing yet, the button changes to `Waiting`.
11. Start playing the video.
12. When playback begins, the extension starts recording automatically.
13. While recording is active, the button changes to `Stop`.
14. When the video ends, the browser automatically downloads the recorded file.

## Recording Settings Panel

Before recording starts, the extension opens a small settings panel.

- The panel lists all candidate formats supported by this extension
- Each format is checked in your browser automatically
- Supported formats are shown as available and can be selected
- Unsupported formats stay visible but are disabled
- You only need to type the file name itself
- The extension adds the correct file extension automatically

For example, if you enter `My Clip`, the downloaded file will be saved with the extension that matches the format you selected.

## How to Stop Recording Early

If you do not want to wait until the video ends:

1. Click the `Stop` button while the recording is in progress.
2. The extension will stop recording.
3. The browser will immediately download the recorded video.

## Where the Downloaded File Goes

The recording is downloaded using your browser's normal download system.

- In most cases, the file goes to your default `Downloads` folder
- If Chrome is configured to ask where to save files, Chrome may ask you to choose a location
- If you enter your own file name in the settings panel, that name will be used
- If you leave the file name empty, the extension creates a default name automatically

## If You Do Not See the Record Button

Try these steps:

1. Refresh the page once after installing the extension.
2. Make sure the page uses a real HTML5 video element.
3. Make sure the video is visible on screen.
4. Try another website with a standard video player.
5. Check whether the site uses protected or encrypted media.

## If Recording Does Not Work

Possible reasons include:

- The website blocks `captureStream()`
- The video is protected by DRM
- The player is not using a standard HTML5 video element
- Your browser does not allow recording for that specific player

If the button briefly shows `Unsupported`, the page or browser does not support recording for that video.

If a format such as `mp4`, `ogg`, or `mkv` cannot be selected, it means your current browser does not report support for that format through the recording API used by this extension.

## Privacy

This extension records video directly inside your browser from the page you are viewing. It does not upload the recording to a remote server.

## Browser Support

This project is intended for Chrome and Chromium-based browsers that support video stream capture and recording APIs.
