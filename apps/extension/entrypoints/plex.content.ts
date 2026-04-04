import { defineContentScript } from "wxt/utils/define-content-script";

import { detectPlexState } from "../lib/detection/plex";
import { MESSAGE_GET_SITE_STATE } from "../lib/extension/messages";

export default defineContentScript({
  matches: [
    "https://app.plex.tv/*",
    "https://watch.plex.tv/*",
    "https://*.plex.direct/*",
    "http://localhost/*",
    "https://localhost/*",
    "http://127.0.0.1/*",
    "https://127.0.0.1/*"
  ],
  runAt: "document_idle",
  main() {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (!message || message.type !== MESSAGE_GET_SITE_STATE) return undefined;

      sendResponse(detectPlexState(document, window.location.href));
      return true;
    });
  }
});
