"use client";
import { useEffect, useState } from "react";
import { financeGet } from "@/lib/finance-api";
export function useFinanceQuery<T>(
  key: string | null,
  load: (key: string, signal: AbortSignal) => Promise<T> = financeGet,
  revision = 0,
) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{
    key: string | null;
    data?: T;
    error?: Error;
    loadedAt?: string;
    attempt: number;
    revision?: number;
  }>({ key: null, attempt: -1 });
  useEffect(() => {
    if (!key) return;
    const controller = new AbortController();
    load(key, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted)
          setState({
            key,
            data,
            loadedAt: new Date().toISOString(),
            attempt,
            revision,
          });
      })
      .catch((error: Error) => {
        if (!controller.signal.aborted) {
          setState((previous) => ({
            key,
            data: previous.key === key ? previous.data : undefined,
            loadedAt: previous.key === key ? previous.loadedAt : undefined,
            error,
            attempt,
            revision,
          }));
          controller.abort();
        }
      });
    return () => controller.abort();
  }, [key, load, attempt, revision]);
  const current = state.key === key;
  return {
    data: current ? state.data : undefined,
    error: current ? state.error : undefined,
    loadedAt: current ? state.loadedAt : undefined,
    loading:
      !!key &&
      (!current || state.attempt !== attempt || state.revision !== revision),
    retry: () => setAttempt((n) => n + 1),
  };
}
