import { useEffect, useRef, useState } from "react";
import { browser } from "wxt/browser";

import {
  createDefaultExtensionUpdateState,
  EXTENSION_UPDATE_STATE_STORAGE_KEY,
  type ExtensionUpdateState
} from "../../../lib/iwatched/update-state";

const CURRENT_EXTENSION_VERSION = browser.runtime.getManifest().version || "0.1.1";

export function useExtensionUpdateState() {
  const [updateState, setUpdateState] = useState<ExtensionUpdateState>(
    createDefaultExtensionUpdateState(CURRENT_EXTENSION_VERSION)
  );
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;

    const load = async () => {
      const stored = await browser.storage.local.get(EXTENSION_UPDATE_STATE_STORAGE_KEY);
      const next = stored[EXTENSION_UPDATE_STATE_STORAGE_KEY];
      if (!mountedRef.current || !next || typeof next !== "object") return;
      setUpdateState(next as ExtensionUpdateState);
    };

    void load();

    const handleStorageChange = (
      changes: Record<string, browser.storage.StorageChange>,
      areaName: string
    ) => {
      if (areaName !== "local" || !changes[EXTENSION_UPDATE_STATE_STORAGE_KEY]) return;
      const nextValue = changes[EXTENSION_UPDATE_STATE_STORAGE_KEY].newValue;
      if (!mountedRef.current || !nextValue || typeof nextValue !== "object") return;
      setUpdateState(nextValue as ExtensionUpdateState);
    };

    browser.storage.onChanged.addListener(handleStorageChange);

    return () => {
      mountedRef.current = false;
      browser.storage.onChanged.removeListener(handleStorageChange);
    };
  }, []);

  return {
    updateState,
    hasUpdateAvailable: updateState.status === "update_available"
  };
}
