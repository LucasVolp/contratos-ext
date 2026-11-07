"use client";
import { Button } from "@/components/ui/button";

import Link from "next/link";
import { Badge } from "./ui/badge";
import { Label } from "./ui/label";
import { NativeSelect } from "./ui/native-select";
export { FormValidation, focusInvalid } from "./ui/form-validation";
export { Field } from "./ui/field";
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  Plus,
  RefreshCw,
} from "lucide-react";
import { statusLabels } from "@/lib/api";
import { institutionLabel, useSession, type Reach } from "@/lib/session";
export function ReachSelect({
  reach,
  onChange,
}: {
  reach: Reach;
  onChange?: () => void;
}) {
  if (reach.options.length < 2) return null;
  return (
    <div className="reach-control">
      <Label htmlFor="institution-reach">Abrangência da busca</Label>
      <NativeSelect
        id="institution-reach"
        aria-label="Abrangência da busca"
        className="reach-select"
        value={reach.key}
        onChange={(e) => {
          reach.setKey(e.target.value);
          onChange?.();
        }}
      >
        {reach.options.map((option) => (
          <option key={option.key} value={option.key}>
            {option.name}
            {option.uasgs &&
              ` · ${option.uasgs.length} ${option.uasgs.length === 1 ? "UASG" : "UASGs"}`}
            {option.isDefault && " (padrão)"}
          </option>
        ))}
      </NativeSelect>
    </div>
  );
}
/** Header for a single record or form: the title names the record or the action, never the section. */
export function PageHead({
  title,
  description,
  children,
  back,
}: {
  title: string;
  section?: string;
  description?: string;
  children?: React.ReactNode;
  back?: string;
}) {
  return (
    <header className="page-head">
      <div>
        {back && (
          <Link className="back" href={back}>
            <ArrowLeft size={14} /> Voltar
          </Link>
        )}
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      <div className="head-actions">{children}</div>
    </header>
  );
}
/** Slim top bar for listings: what is in view on the left, actions on the right. The sidebar names the page. */
export function PageBar({
  context,
  children,
}: {
  context?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <header className="page-bar">
      <div className="page-bar-context">{context}</div>
      <div className="head-actions">{children}</div>
    </header>
  );
}
/** Reach selector for unrestricted viewers; otherwise the fixed reach of the viewer's institutions. */
export function ReachContext({
  reach,
  onChange,
}: {
  reach: Reach;
  onChange?: () => void;
}) {
  const { viewer } = useSession();
  if (reach.options.length > 1)
    return <ReachSelect reach={reach} onChange={onChange} />;
  return (
    <span className="reach-label">
      <Building2 size={15} />
      {viewer.allInstitutions
        ? "Todas as instituições"
        : viewer.institutions.length === 1
          ? institutionLabel(viewer.institutions[0])
          : `${viewer.institutions.length} instituições vinculadas`}
    </span>
  );
}
export function ErrorState({
  message,
  retry,
  title = "Não foi possível concluir",
}: {
  message: string;
  retry?: () => void;
  title?: string;
}) {
  return (
    <div className="error-state" role="alert">
      <strong>{title}</strong>
      <p>{message}</p>
      {retry && (
        <Button type="button" className="button secondary" onClick={retry}>
          <RefreshCw size={15} />
          Tentar novamente
        </Button>
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
export function Empty({
  kind,
  href,
  title = "Nenhum registro encontrado.",
  description,
  actionLabel,
}: {
  kind: string;
  href: string;
  title?: string;
  description?: string;
  actionLabel?: string;
}) {
  return (
    <div className="empty">
      <h2>{title}</h2>
      <p>
        {description ||
          `Cadastre ${kind} ou ajuste os filtros para encontrar o que procura.`}
      </p>
      <Link href={href} className="button">
        {!actionLabel && <Plus size={16} />}{" "}
        {actionLabel || `Adicionar ${kind}`}
      </Link>
    </div>
  );
}
export function Status({ status }: { status: string }) {
  return (
    <Badge variant="outline" className={`status ${status.toLowerCase()}`}>
      <i />
      {statusLabels[status] || status}
    </Badge>
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
        <Button
          variant="outline"
          size="icon"
          aria-label="Página anterior"
          disabled={page <= 1}
          onClick={() => onChange(page - 1)}
        >
          <ArrowLeft size={16} />
        </Button>
        <span>
          {page} / {Math.max(1, Math.ceil(total / limit))}
        </span>
        <Button
          variant="outline"
          size="icon"
          aria-label="Próxima página"
          disabled={page * limit >= total}
          onClick={() => onChange(page + 1)}
        >
          <ArrowRight size={16} />
        </Button>
      </div>
    </div>
  );
}
