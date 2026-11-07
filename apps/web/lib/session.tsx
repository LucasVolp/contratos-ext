"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import { api, ApiError } from "./api";
export type Role = "GESTOR_GERAL" | "DIRETOR" | "ADMINISTRATIVO" | "USUARIO";
export const roleLabels: Record<Role, string> = {
  GESTOR_GERAL: "Gestor geral",
  DIRETOR: "Diretor",
  ADMINISTRATIVO: "Administrativo",
  USUARIO: "Usuário",
};
export const roleDescriptions: Record<Role, string> = {
  GESTOR_GERAL:
    "Acessa todas as instituições e administra usuários e instituições.",
  DIRETOR: "Acessa somente as instituições vinculadas.",
  ADMINISTRATIVO: "Acessa somente as instituições vinculadas.",
  USUARIO: "Acessa somente as instituições vinculadas.",
};
export type Institution = {
  id: string;
  name: string;
  uasg: string;
  organization?: string;
};
export type Viewer = {
  id: string;
  name: string;
  email: string;
  role: Role;
  roleLabel: string;
  allInstitutions: boolean;
  institutions: Institution[];
  impersonator: { id: string; name: string; email: string } | null;
  defaults: { label: string; uasgs: string[] } | null;
};
export const institutionLabel = (institution: Institution) =>
  `${institution.name} · UASG ${institution.uasg}`;
const RECENT_KEY = "contracts:recent-accounts";
export type RecentAccount = { email: string; name: string };
export function recentAccounts(): RecentAccount[] {
  try {
    const value = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
    return Array.isArray(value) ? value.slice(0, 5) : [];
  } catch {
    return [];
  }
}
/** Remembers e-mails (never passwords) on this browser to speed up switching accounts. */
export function rememberAccount(account: RecentAccount) {
  try {
    const rest = recentAccounts().filter((a) => a.email !== account.email);
    localStorage.setItem(RECENT_KEY, JSON.stringify([account, ...rest].slice(0, 5)));
  } catch {
    /* Storage can be unavailable; switching still works by typing the e-mail. */
  }
}
export function forgetAccount(email: string) {
  try {
    localStorage.setItem(
      RECENT_KEY,
      JSON.stringify(recentAccounts().filter((a) => a.email !== email)),
    );
  } catch {}
  window.dispatchEvent(new Event(RECENT_KEY));
}
function subscribeRecent(notify: () => void) {
  window.addEventListener("storage", notify);
  window.addEventListener(RECENT_KEY, notify);
  return () => {
    window.removeEventListener("storage", notify);
    window.removeEventListener(RECENT_KEY, notify);
  };
}
/** Recent accounts read from this browser; empty while rendering on the server. */
export function useRecentAccounts() {
  const raw = useSyncExternalStore(
    subscribeRecent,
    () => {
      try {
        return localStorage.getItem(RECENT_KEY) ?? "[]";
      } catch {
        return "[]";
      }
    },
    () => "[]",
  );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => recentAccounts(), [raw]);
}
export function loginPath(next?: string) {
  return next && next !== "/" && !next.startsWith("/login")
    ? `/login?next=${encodeURIComponent(next)}`
    : "/login";
}
type SessionValue = {
  viewer: Viewer;
  refresh: () => Promise<void>;
  /** Ends the session and opens the login screen to enter with another account. */
  switchUser: () => Promise<void>;
};
const SessionContext = createContext<SessionValue | null>(null);
export function useSession() {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useSession fora do SessionProvider.");
  return value;
}
/** UASG to prefill when the viewer works with exactly one institution. */
export function useDefaultUasg() {
  const { viewer } = useSession();
  return !viewer.allInstitutions && viewer.institutions.length === 1
    ? viewer.institutions[0].uasg
    : "";
}
export type ReachOption = {
  key: string;
  name: string;
  uasgs: string[] | null;
  isDefault?: boolean;
};
export type Reach = ReturnType<typeof useReach>;
/**
 * Listing reach for unrestricted viewers: their default organization first, then every registered
 * organization (e.g. IFSP), then all institutions. Restricted viewers get no choice; the API scopes them.
 */
export function useReach() {
  const { viewer } = useSession();
  const [organizations, setOrganizations] = useState<ReachOption[]>([]);
  useEffect(() => {
    if (!viewer.allInstitutions) return;
    let live = true;
    api<Institution[]>("/institutions")
      .then((rows) => {
        if (!live) return;
        const groups = new Map<string, string[]>();
        for (const row of rows)
          if (row.organization)
            groups.set(row.organization, [
              ...(groups.get(row.organization) ?? []),
              row.uasg,
            ]);
        setOrganizations(
          [...groups.entries()]
            .sort(([a], [b]) => a.localeCompare(b, "pt-BR"))
            .map(([name, uasgs]) => ({
              key: `org:${name}`,
              name,
              uasgs: uasgs.sort(),
            })),
        );
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [viewer.allInstitutions]);
  const defaults = viewer.allInstitutions ? viewer.defaults : null;
  const options: ReachOption[] = viewer.allInstitutions
    ? [
        ...(defaults
          ? [{ key: "default", name: defaults.label, uasgs: defaults.uasgs, isDefault: true }]
          : []),
        ...organizations.filter((o) => o.name !== defaults?.label),
        { key: "all", name: "Todas as instituições", uasgs: null },
      ]
    : [];
  const [key, setKey] = useState(defaults ? "default" : "all");
  const selected = options.find((o) => o.key === key) ?? options[0] ?? null;
  return {
    options,
    selected,
    key: selected?.key ?? key,
    setKey,
    uasgs: selected?.uasgs?.join(",") ?? "",
  };
}
export function useUasgHint() {
  const { viewer } = useSession();
  if (viewer.allInstitutions) return undefined;
  return viewer.institutions.length
    ? `Suas UASGs: ${viewer.institutions.map((i) => i.uasg).join(", ")}.`
    : "Sua conta ainda não tem instituições vinculadas.";
}
export function SessionProvider({
  children,
  fallback,
}: {
  children: React.ReactNode;
  fallback: React.ReactNode;
}) {
  const [viewer, setViewer] = useState<Viewer | null>(null);
  const [error, setError] = useState("");
  const refresh = useCallback(
    () =>
      api<Viewer>("/auth/me").then(
        (value) => {
          setViewer(value);
          setError("");
        },
        (e) => {
          if (e instanceof ApiError && e.status === 401) {
            window.location.replace(
              loginPath(window.location.pathname + window.location.search),
            );
            return;
          }
          setError((e as Error).message);
        },
      ),
    [],
  );
  useEffect(() => {
    void refresh();
  }, [refresh]);
  const switchUser = useCallback(async () => {
    await api("/auth/logout", { method: "POST" }).catch(() => undefined);
    window.location.assign("/login?trocar=1");
  }, []);
  if (error)
    return (
      <div className="session-gate" role="alert">
        <strong>Não foi possível confirmar sua sessão</strong>
        <p>{error}</p>
        <button className="button secondary" onClick={() => refresh()}>
          Tentar novamente
        </button>
      </div>
    );
  if (!viewer) return <>{fallback}</>;
  return (
    <SessionContext.Provider value={{ viewer, refresh, switchUser }}>
      {children}
    </SessionContext.Provider>
  );
}
