import { useEffect, useRef, useState } from "react";
import { browser } from "wxt/browser";

import type { SessionResponse, SessionUser } from "@iwatched-scrobbler/api-client";

import {
  AUTH_STORAGE_KEY,
  disconnectExtensionConnection,
  getStoredConnectionSession,
  IWATCHED_BASE_URL,
  startExtensionConnection
} from "../../../lib/iwatched/auth";

export interface PopupSessionState {
  status: "loading" | "authenticated" | "unauthenticated" | "error";
  authenticated: boolean;
  user: SessionUser | null;
  capabilities: SessionResponse["capabilities"] | null;
  error: string | null;
  lastCheckedAt: number | null;
}

const initialSessionState: PopupSessionState = {
  status: "loading",
  authenticated: false,
  user: null,
  capabilities: null,
  error: null,
  lastCheckedAt: null
};

async function openIWatchedPath(path = "/"): Promise<void> {
  await browser.tabs.create({ url: `${IWATCHED_BASE_URL}${path}` });
}

async function readPopupSessionState(forceRefresh = false): Promise<PopupSessionState> {
  const storedSession = await getStoredConnectionSession(forceRefresh);
  if (!storedSession) {
    return {
      status: "unauthenticated",
      authenticated: false,
      user: null,
      capabilities: null,
      error: null,
      lastCheckedAt: Date.now()
    };
  }

  return {
    status: "authenticated",
    authenticated: true,
    user: storedSession.user,
    capabilities: storedSession.capabilities,
    error: null,
    lastCheckedAt: storedSession.lastCheckedAt
  };
}

export function useIWatchedSession() {
  const [session, setSession] = useState<PopupSessionState>(initialSessionState);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const mountedRef = useRef(true);
  const refreshRef = useRef<((forceRefresh?: boolean) => Promise<void>) | null>(null);

  useEffect(() => {
    mountedRef.current = true;

    const refresh = async (forceRefresh = false) => {
      if (mountedRef.current) setIsRefreshing(true);

      try {
        if (!mountedRef.current) return;
        setSession(await readPopupSessionState(forceRefresh));
      } catch (error) {
        if (!mountedRef.current) return;
        setSession({
          status: "error",
          authenticated: false,
          user: null,
          capabilities: null,
          error:
            error instanceof Error && error.message
              ? error.message
              : "Could not reach iWatched",
          lastCheckedAt: Date.now()
        });
      } finally {
        if (mountedRef.current) setIsRefreshing(false);
      }
    };

    refreshRef.current = refresh;
    void refresh(false);

    const handleStorageChange = (
      changes: Record<string, browser.storage.StorageChange>,
      areaName: string
    ) => {
      if (areaName !== "local" || !changes[AUTH_STORAGE_KEY]) return;
      void refresh(false);
    };

    browser.storage.onChanged.addListener(handleStorageChange);

    return () => {
      mountedRef.current = false;
      refreshRef.current = null;
      browser.storage.onChanged.removeListener(handleStorageChange);
    };
  }, []);

  return {
    session,
    isRefreshing,
    openIWatched: () => openIWatchedPath("/"),
    openLogin: async () => {
      try {
        await startExtensionConnection();
        if (refreshRef.current) {
          await refreshRef.current(true);
        }
      } catch (error) {
        if (mountedRef.current) {
          setSession({
            status: "error",
            authenticated: false,
            user: null,
            capabilities: null,
            error: error instanceof Error && error.message
              ? error.message
              : "Could not finish the iWatched connection",
            lastCheckedAt: Date.now()
          });
        }
      }
    },
    openLogout: async () => {
      await disconnectExtensionConnection();
      if (mountedRef.current) {
        setSession({
          status: "unauthenticated",
          authenticated: false,
          user: null,
          capabilities: null,
          error: null,
          lastCheckedAt: Date.now()
        });
      }
    }
  };
}
