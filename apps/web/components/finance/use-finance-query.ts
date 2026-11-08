"use client";
import { useEffect, useState } from "react";
import { financeGet } from "@/lib/finance-api";
export function useFinanceQuery<T>(
  key: string | null,
  load: (key: string, signal: AbortSignal) => Promise<T> = financeGet,
  revision = 0,
  dataScope: string | null = key,
) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{
    key: string | null;
    dataScope?: string | null;
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
            dataScope,
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
            dataScope,
            data: previous.dataScope === dataScope ? previous.data : undefined,
            loadedAt:
              previous.dataScope === dataScope ? previous.loadedAt : undefined,
            error,
            attempt,
            revision,
          }));
          controller.abort();
        }
      });
    return () => controller.abort();
  }, [key, load, attempt, revision, dataScope]);
  const current = state.key === key;
  const sameScope = state.dataScope === dataScope;
  return {
    data: sameScope ? state.data : undefined,
    error: current ? state.error : undefined,
    loadedAt: sameScope ? state.loadedAt : undefined,
    loading:
      !!key &&
      (!current || state.attempt !== attempt || state.revision !== revision),
    retry: () => setAttempt((n) => n + 1),
  };
}
