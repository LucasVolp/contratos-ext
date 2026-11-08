"use client";
import { useLayoutEffect, useRef, type ReactNode } from "react";

export function FinanceContent({
  identity,
  busy = false,
  children,
}: {
  identity: string;
  busy?: boolean;
  children: ReactNode;
}) {
  const region = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const measured = useRef({ width: 0, height: 0 });
  const previousIdentity = useRef(identity);
  useLayoutEffect(() => {
    const outer = region.current;
    const inner = content.current;
    if (!outer || !inner) return;
    function reserveSpace() {
      if (!outer || !inner) return;
      const width = outer.getBoundingClientRect().width;
      const height = inner.getBoundingClientRect().height;
      // Keep short pages and intermediate loading states from shrinking the viewport.
      measured.current = {
        width,
        height:
          width === measured.current.width
            ? Math.max(measured.current.height, height)
            : height,
      };
      outer.style.minHeight = `${Math.ceil(measured.current.height)}px`;
    }
    reserveSpace();
    const animation =
      previousIdentity.current !== identity &&
      !matchMedia("(prefers-reduced-motion: reduce)").matches
        ? inner.animate([{ opacity: 0.65 }, { opacity: 1 }], {
            duration: 160,
            easing: "ease-out",
          })
        : undefined;
    previousIdentity.current = identity;
    const observer = new ResizeObserver(reserveSpace);
    observer.observe(inner);
    return () => {
      observer.disconnect();
      animation?.cancel();
    };
  }, [identity]);
  return (
    <div className="finance-content" ref={region} aria-busy={busy}>
      <div className="finance-content-body" ref={content}>
        {children}
      </div>
    </div>
  );
}
