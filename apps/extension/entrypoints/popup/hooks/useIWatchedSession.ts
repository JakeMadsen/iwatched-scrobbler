import { useEffect, useRef, useState } from "react";
import { browser } from "wxt/browser";

import type { SessionResponse, SessionUser } from "@iwatched-scrobbler/api-client";

import {
  disconnectExtensionConnection,
  getStoredConnection,
  IWATCHED_BASE_URL,
  startExtensionConnection
} from "../../../lib/iwatched/auth";
import { iwatchedApi } from "../../../lib/iwatched/client";

const REFRESH_MS = 15_000;

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

function toSessionState(payload: SessionResponse): PopupSessionState {
  if (payload && payload.authenticated && payload.user) {
    return {
      status: "authenticated",
      authenticated: true,
      user: payload.user,
      capabilities: payload.capabilities || null,
      error: null,
      lastCheckedAt: Date.now()
    };
  }

  return {
    status: "unauthenticated",
    authenticated: false,
    user: null,
    capabilities: payload.capabilities || null,
    error: null,
    lastCheckedAt: Date.now()
  };
}

export function useIWatchedSession() {
  const [session, setSession] = useState<PopupSessionState>(initialSessionState);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const mountedRef = useRef(true);
  const refreshRef = useRef<(() => Promise<void>) | null>(null);

  useEffect(() => {
    mountedRef.current = true;

    const refresh = async () => {
      if (mountedRef.current) setIsRefreshing(true);

      try {
        const stored = await getStoredConnection();
        if (!stored) {
          if (!mountedRef.current) return;
          setSession({
            status: "unauthenticated",
            authenticated: false,
            user: null,
            capabilities: null,
            error: null,
            lastCheckedAt: Date.now()
          });
          return;
        }

        const response = await iwatchedApi.getSession();
        if (!mountedRef.current) return;
        setSession(toSessionState(response));
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
    void refresh();
    const timer = window.setInterval(() => {
      void refresh();
    }, REFRESH_MS);

    return () => {
      mountedRef.current = false;
      refreshRef.current = null;
      window.clearInterval(timer);
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
          await refreshRef.current();
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
