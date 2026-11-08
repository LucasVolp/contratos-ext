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
const serverSnapshot = () => false;

export function useSidebarPreference(name: "main" | "finance") {
  const key = `contracts:sidebar:${name}`;
  const collapsed = useSyncExternalStore(
    subscribe,
    () => {
      if (temporary.has(key)) return memory.get(key) || false;
      try {
        return localStorage.getItem(key) === "collapsed";
      } catch {
        return memory.get(key) || false;
      }
    },
    serverSnapshot,
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
