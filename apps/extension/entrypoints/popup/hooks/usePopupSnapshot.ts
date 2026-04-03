import { useEffect, useRef, useState } from "react";
import { browser } from "wxt/browser";

import { createUnsupportedSiteState } from "../../../lib/detection/prime";
import { MESSAGE_GET_POPUP_SNAPSHOT } from "../../../lib/extension/messages";
import { createPopupSnapshot } from "../../../lib/extension/mock-session";
import type { PopupSnapshot } from "../../../lib/types/popup-state";

const REFRESH_MS = 1500;
const fallbackSnapshot = createPopupSnapshot(createUnsupportedSiteState(""), "");

export function usePopupSnapshot() {
  const [snapshot, setSnapshot] = useState<PopupSnapshot>(fallbackSnapshot);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;

    const refresh = async () => {
      setIsRefreshing(true);
      try {
        const next = await browser.runtime.sendMessage({
          type: MESSAGE_GET_POPUP_SNAPSHOT
        });
        if (mountedRef.current && next) {
          setSnapshot(next as PopupSnapshot);
        }
      } catch (_) {
        if (mountedRef.current) setSnapshot(fallbackSnapshot);
      } finally {
        if (mountedRef.current) setIsRefreshing(false);
      }
    };

    refresh();
    const timer = window.setInterval(refresh, REFRESH_MS);

    return () => {
      mountedRef.current = false;
      window.clearInterval(timer);
    };
  }, []);

  return { snapshot, isRefreshing };
}
