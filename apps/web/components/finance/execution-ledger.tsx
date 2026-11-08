import { FinanceContent } from "./finance-content";
import { Pager } from "@/components/ui";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableHeader,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
} from "@/components/ui/table";
import { executionColumns, natureCode } from "@/lib/finance-presentation";
import type { ExecutionNature } from "@/lib/finance-types";
import { currency } from "@/lib/api";

export function ExecutionLedger({
  natures,
  onSelect,
  unclassifiedCount,
  page,
  onPageChange,
}: {
  natures: ExecutionNature[];
  onSelect: (code: string) => void;
  unclassifiedCount: number;
  page: string | null;
  onPageChange: (page: number) => void;
}) {
  const limit = 6;
  const requestedPage = /^\d{1,6}$/.test(page || "") ? Number(page) : 1;
  const currentPage = Math.max(
    1,
    Math.min(requestedPage, Math.ceil(natures.length / limit) || 1),
  );
  const visible = natures.slice((currentPage - 1) * limit, currentPage * limit);
  return (
    <section
      className="execution-ledger"
      aria-labelledby="execution-ledger-title"
    >
      <div className="section-heading">
        <div>
          <h2 id="execution-ledger-title">Detalhamento por elemento</h2>
          <p>
            Abra um elemento para consultar o recorte e acessar seus empenhos.
          </p>
        </div>
        <span>{natures.length} elementos</span>
      </div>
      {unclassifiedCount > 0 ? (
        <p className="execution-data-note">
          Há lançamentos sem classificação completa. Eles permanecem nos totais
          do recorte, mas não são atribuídos a um elemento.
        </p>
      ) : null}
      <FinanceContent identity={String(currentPage)}>
        <div className="table-scroll">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Elemento de despesa</TableHead>
                {executionColumns.map((stage) => (
                  <TableHead key={stage.key}>{stage.label}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((node) => (
                <TableRow key={node.code}>
                  <TableCell>
                    <Button
                      type="button"
                      variant="link"
                      className="execution-ledger-link"
                      aria-label={`Explorar elemento ${natureCode(node.code)}`}
                      onClick={() => onSelect(node.code)}
                    >
                      <span>{natureCode(node.code)}</span>
                      <strong>
                        {node.name || `Elemento ${natureCode(node.code)}`}
                        <ArrowRight size={14} aria-hidden="true" />
                      </strong>
                      <small>Abrir elemento</small>
                    </Button>
                  </TableCell>
                  {executionColumns.map((stage) => (
                    <TableCell key={stage.key}>
                      <span className="execution-cell-label">
                        {stage.label}
                      </span>
                      <span>{currency(node.summary[stage.key])}</span>
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </FinanceContent>
      <Pager
        page={currentPage}
        total={natures.length}
        limit={limit}
        onChange={onPageChange}
      />
    </section>
  );
}
