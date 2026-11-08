"use client";
import { useState } from "react";
import { ExecutionSubelementOverview } from "./execution-subelement-overview";
import { ExecutionSubitems } from "./execution-subitems";
export function ExecutionElementDetail({
  scopeQuery,
  documentQuery,
  urlQuery,
  onChange,
  revision,
}: {
  scopeQuery: string;
  documentQuery: string;
  urlQuery: string;
  onChange: (values: Record<string, string>) => void;
  revision: number;
}) {
  const [open, setOpen] = useState(
    Boolean(new URLSearchParams(urlQuery).get("document")),
  );
  return (
    <>
      <ExecutionSubelementOverview
        query={scopeQuery}
        documentQuery={documentQuery}
        urlQuery={urlQuery}
        onChange={onChange}
        revision={revision}
      />
      <details
        className="execution-evidence"
        open={open}
        onToggle={(event) => setOpen(event.currentTarget.open)}
      >
        <summary>Consultar documentos de origem</summary>
        {open ? (
          <ExecutionSubitems
            query={documentQuery}
            urlQuery={urlQuery}
            onChange={onChange}
            revision={revision}
          />
        ) : null}
      </details>
    </>
  );
}
