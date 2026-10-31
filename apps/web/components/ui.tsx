"use client";
import Link from "next/link";
import { createContext, useContext, useState } from "react";
import {
  maskDocument,
  normalizeDocument,
  formatDecimal,
  validateFields,
  FieldErrors,
} from "@contracts/validation";
export const FormValidation = createContext<{
  errors: FieldErrors;
  onBlur?: (name: string) => void;
}>({ errors: {} });
export function focusInvalid(errors: FieldErrors) {
  const key = Object.keys(errors)[0];
  const inputName = key?.replace(/^items\.(\d+)\.(.+)$/, "item-$1-$2");
  const input = document.getElementsByName(inputName)[0] as
    | HTMLElement
    | undefined;
  let ancestor = input?.parentElement;
  while (ancestor) {
    if (ancestor instanceof HTMLDetailsElement) ancestor.open = true;
    ancestor = ancestor.parentElement;
  }
  input?.focus();
}
import { ArrowLeft, ArrowRight, Plus, RefreshCw } from "lucide-react";
import { statusLabels } from "@/lib/api";
import type { Reach } from "@/lib/session";
export function ReachSelect({
  reach,
  onChange,
}: {
  reach: Reach;
  onChange?: () => void;
}) {
  if (reach.options.length < 2) return null;
  return (
    <select
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
    </select>
  );
}
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
              : section === "Pregões"
                ? "02 — CATÁLOGO DE COMPRAS"
                : section === "Administração"
                  ? "04 — ACESSOS E INSTITUIÇÕES"
                  : section === "Minha conta"
                    ? "SUA CONTA"
                    : "03 — ARQUIVO DOCUMENTAL"}
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
        <button type="button" className="button secondary" onClick={retry}>
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
  error,
  hint,
  onBlur,
}: {
  name: string;
  label: string;
  value: unknown;
  onChange: (name: string, value: string) => void;
  type?: string;
  required?: boolean;
  wide?: boolean;
  error?: string;
  hint?: string;
  onBlur?: () => void;
}) {
  const context = useContext(FormValidation);
  const [focused, setFocused] = useState(false);
  const [focusedDraft, setFocusedDraft] = useState("");
  const [localError, setLocalError] = useState("");
  const key = name.replace(/^item-(\d+)-(.+)$/, "items.$1.$2");
  const message = context.errors[key] || error || localError;
  const documentField = name.endsWith("Document");
  const monetary =
    ["initialValue", "globalValue"].includes(name) ||
    name.endsWith("-unitPrice");
  const help =
    hint ||
    (documentField
      ? name === "organizationDocument"
        ? "CNPJ numérico ou alfanumérico com 14 posições."
        : "CPF com 11 dígitos ou CNPJ com 14 posições; CNPJ também aceita letras."
      : name === "uasg"
        ? "6 dígitos, incluindo os zeros iniciais."
        : name === "organizationState"
          ? "Sigla da unidade federativa, como MS."
          : type === "decimal"
            ? "Até 6 casas decimais. Aceita vírgula ou ponto decimal."
            : "");
  const raw = String(value ?? "");
  const display = documentField
    ? maskDocument(raw, name === "organizationDocument")
    : type === "decimal"
      ? focused
        ? focusedDraft
        : raw
          ? formatDecimal(raw, monetary)
          : raw
      : raw;
  const blur = (
    event: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => {
    setFocused(false);
    // Submit validates the whole form. Avoid adding blur errors between
    // pointer-down and click, which can move the submit button out of reach.
    const next = event.relatedTarget;
    if (
      next instanceof HTMLButtonElement &&
      next.type === "submit" &&
      next.form === event.currentTarget.form
    )
      return;
    const errors = validateFields(
      { number: "ok", object: "ok", uasg: "000001", [name]: raw },
      "record",
    );
    // Blur reuses the record rules for format; whether emptiness is an error
    // depends only on this field's `required`, since filters reuse the same names.
    setLocalError(
      !raw.trim()
        ? required
          ? "Preencha este campo obrigatório."
          : ""
        : errors[name] || "",
    );
    context.onBlur?.(key);
    onBlur?.();
  };
  const common = {
    id: name,
    name,
    required,
    value: display,
    "aria-invalid": !!message,
    "aria-describedby":
      [help && `${name}-hint`, message && `${name}-error`]
        .filter(Boolean)
        .join(" ") || undefined,
    onFocus: (
      event: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>,
    ) => {
      // Keep the DOM value stable so focusing preserves selection and caret.
      setFocusedDraft(event.currentTarget.value);
      setFocused(true);
    },
    onBlur: blur,
  };
  return (
    <div className={`field ${wide ? "wide" : ""}`}>
      <label htmlFor={name}>
        {label}
        {!required && <span> opcional</span>}
      </label>
      {type === "textarea" ? (
        <textarea
          {...common}
          onChange={(e) => {
            setLocalError("");
            onChange(name, e.target.value);
          }}
          rows={3}
        />
      ) : (
        <input
          {...common}
          type={type === "decimal" ? "text" : type}
          inputMode={
            type === "decimal"
              ? "decimal"
              : name === "uasg"
                ? "numeric"
                : undefined
          }
          onKeyDown={(e) => {
            if (!documentField || e.key !== "Backspace") return;
            const input = e.currentTarget,
              position = input.selectionStart ?? 0;
            if (
              position === input.selectionEnd &&
              /[.\/\-]/.test(input.value[position - 1] || "")
            )
              input.setSelectionRange(position - 1, position - 1);
          }}
          onChange={(e) => {
            setLocalError("");
            const input = e.currentTarget;
            let next = input.value;
            if (type === "decimal") setFocusedDraft(next);
            const position = input.selectionStart ?? next.length;
            const count = next
              .slice(0, position)
              .replace(/[^a-zA-Z0-9]/g, "").length;
            if (documentField) next = normalizeDocument(next);
            if (name === "uasg") next = next.replace(/\D/g, "");
            if (name === "organizationState") next = next.toUpperCase();
            onChange(name, next);
            if (documentField)
              requestAnimationFrame(() => {
                let digits = 0,
                  caret = 0;
                while (caret < input.value.length && digits < count) {
                  if (/[A-Z0-9]/.test(input.value[caret])) digits++;
                  caret++;
                }
                input.setSelectionRange(caret, caret);
              });
          }}
        />
      )}
      {help && (
        <small className="field-hint" id={`${name}-hint`}>
          {help}
        </small>
      )}
      {message && (
        <small className="field-error" id={`${name}-error`} role="alert">
          {message}
        </small>
      )}
    </div>
  );
}
