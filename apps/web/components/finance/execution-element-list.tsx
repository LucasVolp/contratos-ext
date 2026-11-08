"use client";
import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { natureCode } from "@/lib/finance-presentation";
import type { ExecutionNature } from "@/lib/finance-types";
export function ExecutionElementList({
  natures,
  selected,
  onSelect,
  open,
}: {
  natures: ExecutionNature[];
  selected: string | null;
  onSelect: (code: string) => void;
  open: boolean;
}) {
  const list = useRef<HTMLElement>(null);
  const [scroll, setScroll] = useState({
    overflow: false,
    before: false,
    after: false,
  });
  function measure(node: HTMLElement) {
    const next = {
      overflow: node.scrollHeight > node.clientHeight + 1,
      before: node.scrollTop > 1,
      after: node.scrollTop + node.clientHeight < node.scrollHeight - 1,
    };
    setScroll((previous) =>
      previous.overflow === next.overflow &&
      previous.before === next.before &&
      previous.after === next.after
        ? previous
        : next,
    );
  }
  useEffect(() => {
    const node = list.current;
    if (!node) return;
    const observer = new ResizeObserver(() => measure(node));
    observer.observe(node);
    const frame = requestAnimationFrame(() => measure(node));
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [open, natures]);
  return (
    <>
      <div className="execution-list-heading">
        <span className="eyebrow">
          {natures.length} {natures.length === 1 ? "elemento" : "elementos"}
        </span>
        {scroll.overflow ? (
          <span id="execution-scroll-hint">
            Role para ver mais <ChevronDown size={13} aria-hidden="true" />
          </span>
        ) : null}
      </div>
      <nav
        ref={list}
        aria-label="Elementos da despesa"
        tabIndex={0}
        aria-describedby={scroll.overflow ? "execution-scroll-hint" : undefined}
        onScroll={(event) => measure(event.currentTarget)}
      >
        {natures.map((node) => (
          <Button
            type="button"
            variant="ghost"
            key={node.code}
            className="execution-nature"
            aria-label={`Explorar elemento ${natureCode(node.code)}`}
            aria-current={selected === node.code ? "page" : undefined}
            onClick={() => onSelect(node.code)}
          >
            <span>{natureCode(node.code)}</span>
            <strong>{node.name || `Elemento ${natureCode(node.code)}`}</strong>
            <ChevronRight size={13} aria-hidden="true" />
          </Button>
        ))}
      </nav>
      {scroll.overflow ? (
        <div className="execution-scroll-controls">
          <Button
            type="button"
            variant="outline"
            aria-label="Ver elementos anteriores"
            disabled={!scroll.before}
            onClick={() =>
              list.current?.scrollBy({
                top: -list.current.clientHeight * 0.8,
              })
            }
          >
            <ChevronDown
              size={16}
              className="execution-scroll-up"
              aria-hidden="true"
            />
          </Button>
          <span aria-live="polite">
            {scroll.after ? "Mais elementos abaixo" : "Fim da lista"}
          </span>
          <Button
            type="button"
            variant="outline"
            aria-label="Ver próximos elementos"
            disabled={!scroll.after}
            onClick={() =>
              list.current?.scrollBy({ top: list.current.clientHeight * 0.8 })
            }
          >
            <ChevronDown size={16} aria-hidden="true" />
          </Button>
        </div>
      ) : null}
    </>
  );
}
