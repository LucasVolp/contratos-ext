"use client";
import { Button } from "@/components/ui/button";

import Link from "next/link";
import { useState } from "react";
import { Building2, LogOut, UserRound } from "lucide-react";
import { api } from "@/lib/api";
import { institutionLabel, useSession } from "@/lib/session";

export function WorkspaceAccount() {
  const { viewer, switchUser } = useSession();
  return (
    <section className="account" aria-label="Sua conta">
      <div className="account-profile">
        <span className="account-avatar" aria-hidden="true">
          <UserRound size={17} />
        </span>
        <div>
          <div className="account-name">{viewer.name}</div>
          <div className="account-role">{viewer.roleLabel}</div>
        </div>
      </div>
      <div className="account-scope">
        <Building2 size={13} aria-hidden="true" />
        <span>
          {viewer.allInstitutions
            ? viewer.defaults
              ? `Todas as instituições · busca padrão: ${viewer.defaults.label}`
              : "Todas as instituições"
            : viewer.institutions.length === 1
              ? institutionLabel(viewer.institutions[0])
              : viewer.institutions.length
                ? `${viewer.institutions.length} instituições`
                : "Nenhuma instituição vinculada"}
        </span>
      </div>
      <div className="account-actions">
        <Link href="/conta">
          <UserRound size={14} aria-hidden="true" />
          Minha conta
        </Link>
        <button type="button" onClick={switchUser}>
          <LogOut size={14} aria-hidden="true" />
          Trocar de usuário
        </button>
      </div>
    </section>
  );
}

export function ImpersonationBanner() {
  const { viewer } = useSession();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function back() {
    setBusy(true);
    try {
      await api("/auth/impersonation/stop", { method: "POST" });
      window.location.assign("/administracao/usuarios");
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <div className="impersonation-banner" role="status">
      <span>
        Você está usando a conta de <strong>{viewer.name}</strong> (
        {viewer.roleLabel}). Você vê e altera somente o que este perfil alcança.
        {error && <em> {error}</em>}
      </span>
      <Button type="button" className="button" disabled={busy} onClick={back}>
        Voltar para {viewer.impersonator!.name}
      </Button>
    </div>
  );
}
