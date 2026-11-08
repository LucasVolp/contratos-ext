"use client";
import { useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  LayoutList,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { SearchField } from "@/components/ui/search-field";
import { natureCode } from "@/lib/finance-presentation";
import { ExecutionElementList } from "./execution-element-list";
import type { ExecutionNature } from "@/lib/finance-types";

export function ExecutionNavigator({
  collapsed,
  onToggle,
  natures,
  selected,
  search,
  onSearch,
  onSelect,
}: {
  collapsed: boolean;
  onToggle: () => void;
  natures: ExecutionNature[];
  selected: string | null;
  search: string;
  onSearch: (value: string) => void;
  onSelect: (code: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const toggleControl = useRef<HTMLButtonElement>(null);
  const previousCollapsed = useRef(collapsed);
  useEffect(() => {
    if (previousCollapsed.current !== collapsed) {
      toggleControl.current?.focus({ preventScroll: true });
      previousCollapsed.current = collapsed;
    }
  }, [collapsed]);

  const visible = natures.filter((node) =>
    `${node.code} ${natureCode(node.code)} ${node.name || ""}`
      .toLocaleLowerCase("pt-BR")
      .includes(search.trim().toLocaleLowerCase("pt-BR")),
  );
  function select(code: string) {
    setOpen(false);
    onSelect(code);
  }
  if (collapsed)
    return (
      <aside
        className="execution-navigator is-collapsed"
        aria-label="Navegação dos elementos"
      >
        <Button
          type="button"
          variant="outline"
          className="execution-expand"
          ref={toggleControl}
          aria-label="Expandir lista de elementos"
          title="Expandir lista de elementos"
          aria-expanded={false}
          onClick={() => {
            setOpen(true);
            onToggle();
          }}
        >
          <PanelLeftOpen size={18} aria-hidden="true" />
          <span>Mostrar elementos</span>
        </Button>
      </aside>
    );
  return (
    <aside
      className={`execution-navigator ${open ? "is-open" : ""}`}
      aria-label="Navegação dos elementos"
    >
      <div className="execution-navigator-header">
        <Button
          type="button"
          variant="ghost"
          className="execution-collapse"
          ref={toggleControl}
          aria-label="Recolher lista de elementos"
          title="Recolher lista de elementos"
          aria-expanded={true}
          onClick={onToggle}
        >
          <PanelLeftClose size={17} aria-hidden="true" />
          <span>Elementos</span>
        </Button>
        <Button
          type="button"
          variant="outline"
          className="execution-picker"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          Escolher despesa
          <ChevronDown size={15} aria-hidden="true" />
        </Button>
      </div>
      <div className="execution-navigator-body">
        <SearchField
          id="execution-nature-search"
          label="Localizar despesa"
          value={search}
          onChange={(event) => onSearch(event.target.value)}
          placeholder="Código ou descrição"
        />
        <Button
          type="button"
          variant="ghost"
          className="execution-all"
          aria-current={!selected ? "page" : undefined}
          onClick={() => select("")}
        >
          <LayoutList size={15} aria-hidden="true" />
          Todas as despesas
        </Button>
        <ExecutionElementList
          natures={visible}
          selected={selected}
          onSelect={select}
          open={open}
        />
        {!visible.length ? (
          <p className="execution-nav-empty">
            Nenhum elemento encontrado nesta busca.
          </p>
        ) : null}
        <p className="execution-nav-note">
          Os valores do elemento consideram todo o recorte selecionado,
          independentemente das linhas exibidas.
        </p>
      </div>
    </aside>
  );
}
