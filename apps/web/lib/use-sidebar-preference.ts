"use client";
import { useSyncExternalStore } from "react";

const eventName = "contracts:sidebar-preference";
const memory = new Map<string, boolean>();
const temporary = new Set<string>();
function subscribe(notify: () => void) {
  window.addEventListener("storage", notify);
  window.addEventListener(eventName, notify);
  return () => {
    window.removeEventListener("storage", notify);
    window.removeEventListener(eventName, notify);
  };
}

export function useSidebarPreference(name: "main" | "finance") {
  const key = `contracts:sidebar:${name}`;
  const defaultCollapsed = name === "finance";
  const collapsed = useSyncExternalStore(
    subscribe,
    () => {
      if (temporary.has(key)) return memory.get(key) ?? defaultCollapsed;
      try {
        const stored = localStorage.getItem(key);
        return stored ? stored === "collapsed" : defaultCollapsed;
      } catch {
        return memory.get(key) ?? defaultCollapsed;
      }
    },
    () => defaultCollapsed,
  );
  function toggle() {
    memory.set(key, !collapsed);
    try {
      localStorage.setItem(key, collapsed ? "expanded" : "collapsed");
    } catch {
      temporary.add(key);
      /* The current session remains usable when persistent storage is unavailable. */
    }
    window.dispatchEvent(new Event(eventName));
  }
  return [collapsed, toggle] as const;
}
