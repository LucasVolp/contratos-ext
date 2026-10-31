"use client";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Plus, RefreshCw } from "lucide-react";
import { statusLabels } from "@/lib/api";
export function PageHead({
  section,
  title,
  description,
  children,
  back,
}: {
  section: string;
  title: string;
  description?: string;
  children?: React.ReactNode;
  back?: string;
}) {
  return (
    <>
      <div className="breadcrumb">
        Área de trabalho <span>/</span> {section}
      </div>
      <header className="page-head">
        <div>
          {back && (
            <Link className="back" href={back}>
              <ArrowLeft size={14} /> Voltar
            </Link>
          )}
          <div className="eyebrow">
            {section === "Contratos"
              ? "01 — GESTÃO CONTRATUAL"
              : "02 — ARQUIVO DOCUMENTAL"}
          </div>
          <h1>{title}</h1>
          {description && <p>{description}</p>}
        </div>
        <div className="head-actions">{children}</div>
      </header>
    </>
  );
}
export function ErrorState({
  message,
  retry,
}: {
  message: string;
  retry?: () => void;
}) {
  return (
    <div className="error-state" role="alert">
      <strong>Não foi possível concluir</strong>
      <p>{message}</p>
      {retry && (
        <button className="button secondary" onClick={retry}>
          <RefreshCw size={15} />
          Tentar novamente
        </button>
      )}
    </div>
  );
}
export function Loading() {
  return (
    <div className="loading" role="status">
      <span className="spinner" />
      Carregando seu arquivo…
    </div>
  );
}
export function Empty({ kind, href }: { kind: string; href: string }) {
  return (
    <div className="empty">
      <div className="eyebrow">UM NOVO COMEÇO</div>
      <h2>Nenhum registro por aqui.</h2>
      <p>Cadastre {kind} ou ajuste os filtros para encontrar o que procura.</p>
      <Link href={href} className="button">
        <Plus size={16} />
        Adicionar {kind}
      </Link>
    </div>
  );
}
export function Status({ status }: { status: string }) {
  return (
    <span className={`status ${status.toLowerCase()}`}>
      <i />
      {statusLabels[status] || status}
    </span>
  );
}
export function Pager({
  page,
  total,
  limit,
  onChange,
}: {
  page: number;
  total: number;
  limit: number;
  onChange: (n: number) => void;
}) {
  return (
    <div className="pager">
      <span>
        {total
          ? `${(page - 1) * limit + 1}–${Math.min(page * limit, total)}`
          : "0"}{" "}
        de {total} registros
      </span>
      <div>
        <button
          aria-label="Página anterior"
          disabled={page <= 1}
          onClick={() => onChange(page - 1)}
        >
          <ArrowLeft size={16} />
        </button>
        <span>
          {page} / {Math.max(1, Math.ceil(total / limit))}
        </span>
        <button
          aria-label="Próxima página"
          disabled={page * limit >= total}
          onClick={() => onChange(page + 1)}
        >
          <ArrowRight size={16} />
        </button>
      </div>
    </div>
  );
}
export function Field({
  name,
  label,
  value,
  onChange,
  type = "text",
  required = false,
  wide = false,
}: {
  name: string;
  label: string;
  value: unknown;
  onChange: (name: string, value: string) => void;
  type?: string;
  required?: boolean;
  wide?: boolean;
}) {
  return (
    <div className={`field ${wide ? "wide" : ""}`}>
      <label htmlFor={name}>
        {label}
        {!required && <span> opcional</span>}
      </label>
      {type === "textarea" ? (
        <textarea
          id={name}
          name={name}
          required={required}
          value={String(value ?? "")}
          onChange={(e) => onChange(name, e.target.value)}
          rows={3}
        />
      ) : (
        <input
          id={name}
          name={name}
          required={required}
          type={type === "decimal" ? "text" : type}
          inputMode={type === "decimal" ? "decimal" : undefined}
          value={String(value ?? "")}
          onChange={(e) => onChange(name, e.target.value)}
        />
      )}
    </div>
  );
}
