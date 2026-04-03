import { defineContentScript } from "wxt/utils/define-content-script";

import { detectPrimeState } from "../lib/detection/prime";
import { MESSAGE_GET_PRIME_STATE } from "../lib/extension/messages";

export default defineContentScript({
  matches: [
    "https://www.primevideo.com/*",
    "https://www.amazon.com/gp/video/*"
  ],
  runAt: "document_idle",
  main() {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (!message || message.type !== MESSAGE_GET_PRIME_STATE) return undefined;

      sendResponse(detectPrimeState(document, window.location.href));
      return true;
    });
  }
});
