import { Info } from "lucide-react";
import type { ExecutionPurpose } from "@/lib/finance-presentation";

export function ExecutionPurposeUnavailable({
  purpose,
}: {
  purpose: ExecutionPurpose;
}) {
  return (
    <section
      className="execution-unavailable"
      aria-labelledby="execution-purpose-title"
    >
      <Info size={22} aria-hidden="true" />
      <h2 id="execution-purpose-title">Finalidade ainda não classificada</h2>
      <p>
        A consulta atual não identifica quais despesas são{" "}
        {purpose === "own"
          ? "próprias da Reitoria"
          : "de execução adjunta aos campi"}
        . Os totais disponíveis não serão apresentados como se já estivessem
        separados.
      </p>
      <p>
        Use a visão Dados disponíveis para consultar os registros existentes. A
        classificação por destinação depende da próxima etapa de dados.
      </p>
    </section>
  );
}
