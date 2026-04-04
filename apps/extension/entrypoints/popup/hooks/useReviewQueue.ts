import { useEffect, useRef, useState } from "react";
import { browser } from "wxt/browser";

import {
  dismissReviewQueueItem,
  getReviewQueue,
  type ReviewQueueItem
} from "../../../lib/iwatched/review-queue";

export function useReviewQueue() {
  const [items, setItems] = useState<ReviewQueueItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;

    const load = async () => {
      try {
        const next = await getReviewQueue();
        if (mountedRef.current) {
          setItems(next);
        }
      } catch (_) {
        if (mountedRef.current) {
          setItems([]);
        }
      } finally {
        if (mountedRef.current) {
          setIsLoading(false);
        }
      }
    };

    void load();

    const handleStorageChange = (_changes: Record<string, browser.storage.StorageChange>, areaName: string) => {
      if (areaName !== "local") return;
      void load();
    };

    browser.storage.onChanged.addListener(handleStorageChange);

    return () => {
      mountedRef.current = false;
      browser.storage.onChanged.removeListener(handleStorageChange);
    };
  }, []);

  const dismissItem = async (id: string) => {
    await dismissReviewQueueItem(id);
    if (mountedRef.current) {
      setItems((current) => current.filter((item) => item.id !== id));
    }
  };

  return {
    items,
    queueCount: items.length,
    isLoading,
    dismissItem
  };
}
