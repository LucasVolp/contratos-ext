"use client";
import { useState } from "react";
import { api, date } from "@/lib/api";
import {
  ItemSupplement,
  SupplementPart,
  UnitRow,
  CommitmentRow,
  AdhesionRow,
  quantity,
  known,
  document,
  stamp,
} from "@/lib/catalog-api";
import { ErrorState } from "../ui";
function Part<T>({
  title,
  part,
  children,
  retry,
}: {
  title: string;
  part?: SupplementPart<T>;
  children: (rows: T[]) => React.ReactNode;
  retry: () => void;
}) {
  return (
    <section className="supplement-part">
      <h4>{title}</h4>
      <p className="catalog-section-caption">
        Última consulta salva: {stamp(part?.lastSyncedAt)}
      </p>
      {(!part || part.status === "not_loaded") && (
        <p className="muted">Não consultado.</p>
      )}
      {part?.status === "error" && (
        <>
          <ErrorState
            message={part.error || "Consulta indisponível."}
            retry={retry}
          />
          {part.data.length > 0 && (
            <p className="catalog-notice">
              Exibindo os dados da última consulta salva.
            </p>
          )}
        </>
      )}
      {part?.status === "loaded" && !part.data.length && (
        <p className="muted">
          Nenhum registro informado na última consulta bem sucedida.
        </p>
      )}
      {!!part?.data.length && children(part.data)}
    </section>
  );
}
export function ItemSupplementPanel({
  recordId,
  itemKey,
  initial,
}: {
  recordId: string;
  itemKey: string;
  initial?: ItemSupplement;
}) {
  const [data, setData] = useState(initial),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function refresh() {
    setBusy(true);
    setError("");
    try {
      setData(
        await api<ItemSupplement>(
          `/public-records/${recordId}/items/${encodeURIComponent(itemKey)}/refresh`,
          { method: "POST", body: "{}" },
        ),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="item-supplement">
      <div className="section-heading">
        <div>
          <h3>Participantes e saldos</h3>
          <p className="catalog-section-caption">
            Escopo público: item {itemKey} da ata. Os dados podem abranger mais
            de um fornecedor.
          </p>
        </div>
        <button className="button secondary" onClick={refresh} disabled={busy}>
          {busy ? "Consultando…" : "Consultar participantes e saldos"}
        </button>
      </div>
      <div aria-live="polite">
        {error && <ErrorState message={error} retry={refresh} />}
      </div>
      <Part<UnitRow>
        title="Unidades participantes"
        part={data?.units}
        retry={refresh}
      >
        {(rows) => (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Unidade</th>
                  <th>Tipo / fornecedor</th>
                  <th>Quantidade</th>
                  <th>Saldo de adesão</th>
                  <th>Saldo de empenho</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr key={i}>
                    <td>
                      {known(row.name)}
                      <small className="date-end">
                        {known(row.code)}
                        {row.excluded ? " · Excluída" : ""}
                      </small>
                    </td>
                    <td>
                      {known(row.type)}
                      <small className="date-end">
                        {document(row.supplierDocument)}
                      </small>
                    </td>
                    <td>{quantity(row.quantity)}</td>
                    <td>{quantity(row.adhesionBalance)}</td>
                    <td>{quantity(row.commitmentBalance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Part>
      <Part<CommitmentRow>
        title="Empenhos e saldos"
        part={data?.commitments}
        retry={refresh}
      >
        {(rows) => (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Unidade</th>
                  <th>Tipo</th>
                  <th>Quantidade</th>
                  <th>Empenhado</th>
                  <th>Saldo</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr key={i}>
                    <td>{known(row.unit)}</td>
                    <td>{known(row.type)}</td>
                    <td>{quantity(row.quantity)}</td>
                    <td>{quantity(row.committed)}</td>
                    <td>{quantity(row.balance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Part>
      <Part<AdhesionRow> title="Adesões" part={data?.adhesions} retry={refresh}>
        {(rows) => (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Unidade</th>
                  <th>Aprovação</th>
                  <th>Quantidade</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr key={i}>
                    <td>{known(row.unit)}</td>
                    <td>{date(row.approvedAt)}</td>
                    <td>{quantity(row.quantity)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Part>
    </div>
  );
}
