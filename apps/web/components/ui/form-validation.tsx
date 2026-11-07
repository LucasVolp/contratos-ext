"use client";
import { createContext } from "react";
import type { FieldErrors } from "@contracts/validation";

export const FormValidation = createContext<{
  errors: FieldErrors;
  onBlur?: (name: string) => void;
}>({ errors: {} });
export function focusInvalid(errors: FieldErrors) {
  const key = Object.keys(errors)[0];
  const inputName = key?.replace(/^items\.(\d+)\.(.+)$/, "item-$1-$2");
  const input = document.getElementsByName(inputName)[0] as
    HTMLElement | undefined;
  let ancestor = input?.parentElement;
  while (ancestor) {
    if (ancestor instanceof HTMLDetailsElement) ancestor.open = true;
    ancestor = ancestor.parentElement;
  }
  input?.focus();
}
