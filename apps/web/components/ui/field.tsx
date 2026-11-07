"use client";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";

import { useContext, useState } from "react";
import {
  maskDocument,
  normalizeDocument,
  formatDecimal,
  validateFields,
} from "@contracts/validation";
import { FormValidation } from "./form-validation";

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
      <Label htmlFor={name}>
        {label}
        {!required && <span> opcional</span>}
      </Label>
      {type === "textarea" ? (
        <Textarea
          {...common}
          onChange={(e) => {
            setLocalError("");
            onChange(name, e.target.value);
          }}
          rows={3}
        />
      ) : (
        <Input
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
