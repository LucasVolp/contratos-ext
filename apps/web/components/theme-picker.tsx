"use client";

import { Monitor } from "lucide-react";
import { useTheme } from "next-themes";
import { useSyncExternalStore } from "react";
import { Label } from "./ui/label";
import { NativeSelect, NativeSelectOption } from "./ui/native-select";

const subscribe = () => () => {};

export function ThemePicker() {
  const { theme, setTheme } = useTheme();
  const mounted = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
  return (
    <div className="theme-picker">
      <Monitor size={16} aria-hidden="true" />
      <Label htmlFor="appearance">Aparência</Label>
      <NativeSelect
        id="appearance"
        value={mounted ? theme : "system"}
        disabled={!mounted}
        onChange={(event) => setTheme(event.target.value)}
      >
        <NativeSelectOption value="light">Claro</NativeSelectOption>
        <NativeSelectOption value="dark">Escuro</NativeSelectOption>
        <NativeSelectOption value="system">Sistema</NativeSelectOption>
      </NativeSelect>
    </div>
  );
}
