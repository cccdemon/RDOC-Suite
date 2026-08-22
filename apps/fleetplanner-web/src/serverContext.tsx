// Persistent "active Discord server" context (IA goal 4).
//
// Org fleet, server settings, partnerships and diagnostics are all *one server's*
// screens. Before this, every one of them kept its own `useState` and silently
// defaulted to the first membership, so switching the server on one screen was
// forgotten by the next. The active server now lives here: remembered in
// localStorage, expressed in the URL as `?guild=<id>`, and shown in the nav.
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import type { SessionResponse } from "./api/types";
import { NAV_GROUPS, type NavAccess } from "./nav";

export type Membership = { guildId: string; guildName: string; role: string };

const STORAGE_KEY = "rdoc.fleetplanner.activeGuild";

function readStored(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null; // private mode / storage disabled — context is per-session then
  }
}
function writeStored(id: string | null) {
  try {
    if (id) window.localStorage.setItem(STORAGE_KEY, id);
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

type ServerContextValue = {
  memberships: Membership[];
  /** guilds the viewer is a fleet operator in */
  manageable: Membership[];
  activeGuildId: string | null;
  activeGuild: Membership | null;
  setActiveGuildId: (id: string | null) => void;
  access: NavAccess;
};

const Ctx = createContext<ServerContextValue>({
  memberships: [],
  manageable: [],
  activeGuildId: null,
  activeGuild: null,
  setActiveGuildId: () => {},
  access: { anyGuild: false, managesGuild: false },
});

/** Routes that address one server — those get `?guild=` pinned into the URL. */
export const SERVER_ROUTES: string[] = NAV_GROUPS.flatMap((g) => g.items)
  .filter((it) => it.server)
  .map((it) => it.to);

export function isServerRoute(pathname: string): boolean {
  return SERVER_ROUTES.some((r) => pathname === r || pathname.startsWith(r + "/"));
}

export function ServerContextProvider({
  session,
  children,
}: {
  session: SessionResponse | null;
  children: React.ReactNode;
}) {
  const memberships = useMemo<Membership[]>(() => (session?.memberships ?? []) as Membership[], [session]);
  const manageable = useMemo(() => memberships.filter((m) => m.role === "fleetoperator"), [memberships]);
  const [searchParams] = useSearchParams();
  const { pathname, search, hash } = useLocation();
  const navigate = useNavigate();
  const [activeGuildId, setActive] = useState<string | null>(() => readStored());

  const setActiveGuildId = useCallback((id: string | null) => {
    setActive(id);
    writeStored(id);
  }, []);

  // A `?guild=` in the URL always wins — that is what makes a deep link into
  // another server's settings work, and it keeps the nav in step with it.
  const urlGuild = searchParams.get("guild");
  useEffect(() => {
    if (urlGuild && urlGuild !== activeGuildId) setActiveGuildId(urlGuild);
  }, [urlGuild, activeGuildId, setActiveGuildId]);

  // Drop a remembered guild the viewer no longer belongs to, and adopt the first
  // membership when nothing is remembered yet.
  useEffect(() => {
    if (memberships.length === 0) return;
    if (activeGuildId && memberships.some((m) => m.guildId === activeGuildId)) return;
    setActiveGuildId((manageable[0] ?? memberships[0]).guildId);
  }, [memberships, manageable, activeGuildId, setActiveGuildId]);

  // On a server screen the URL must say which server it is — otherwise a copied
  // link means "whatever that person had selected".
  useEffect(() => {
    if (!activeGuildId || urlGuild || !isServerRoute(pathname)) return;
    const sp = new URLSearchParams(search);
    sp.set("guild", activeGuildId);
    navigate({ pathname, search: `?${sp.toString()}`, hash }, { replace: true });
  }, [activeGuildId, urlGuild, pathname, search, hash, navigate]);

  const value = useMemo<ServerContextValue>(
    () => ({
      memberships,
      manageable,
      activeGuildId,
      activeGuild: memberships.find((m) => m.guildId === activeGuildId) ?? null,
      setActiveGuildId,
      access: { anyGuild: memberships.length > 0, managesGuild: manageable.length > 0 },
    }),
    [memberships, manageable, activeGuildId, setActiveGuildId],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useServerContext(): ServerContextValue {
  return useContext(Ctx);
}

/**
 * Guild selection for one screen: the shared active server, narrowed to the
 * guilds this screen actually accepts. Selecting here updates the shared
 * context, so the next server screen opens on the same server.
 */
export function useGuildSelection(eligible: Array<{ guildId: string }>): [string | null, (id: string) => void] {
  const { activeGuildId, setActiveGuildId } = useServerContext();
  const ids = eligible.map((e) => e.guildId);
  const resolved = activeGuildId && ids.includes(activeGuildId) ? activeGuildId : (ids[0] ?? null);

  // Keep the shared context honest when this screen had to fall back.
  useEffect(() => {
    if (resolved && resolved !== activeGuildId) setActiveGuildId(resolved);
  }, [resolved, activeGuildId, setActiveGuildId]);

  return [resolved, setActiveGuildId];
}
