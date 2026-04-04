import { defineConfig } from "wxt";

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  manifest: {
    name: "iWatched Scrobbler",
    description: "Preview build of the iWatched scrobbler browser extension.",
    permissions: ["alarms", "identity", "storage", "tabs", "scripting"],
    host_permissions: [
      "https://www.primevideo.com/*",
      "https://www.amazon.com/gp/video/*",
      "https://app.plex.tv/*",
      "https://watch.plex.tv/*",
      "https://*.plex.direct/*",
      "http://localhost/*",
      "https://localhost/*",
      "http://127.0.0.1/*",
      "https://127.0.0.1/*",
      "https://iwatched.app/*"
    ],
    icons: {
      "16": "icon-16.png",
      "32": "icon-32.png",
      "48": "icon-48.png",
      "128": "icon-128.png"
    },
    action: {
      default_title: "iWatched Scrobbler"
    }
  }
});
