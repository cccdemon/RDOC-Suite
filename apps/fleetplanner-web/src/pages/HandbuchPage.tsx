import { Link, Navigate, useParams } from "react-router-dom";
import { DocPage } from "./DocPage";
import { RoadmapPage } from "./RoadmapPage";
import { Ic } from "../components/Icons";
import { MONO } from "../components/ui";
import { useSeo } from "../seo";
import { useT } from "../i18n";

const SECTION_DESC: Record<string, string> = {
  "was-ist-das": "Was ist der RDOC Fleetplanner? Operationsplanung für Star-Citizen-Organisationen — Events, Flotten-Slots, Crew und Voice.",
  technobabble: "RDOC Fleetplanner unter der Haube: React-SPA, Fastify, Prisma, PostgreSQL, Discord-OAuth, P2P-WebRTC-Voice — der technische Überblick.",
  architektur: "Softwarearchitektur des RDOC Fleetplanner: Bausteine, Schichten, Datenmodell und die Abläufe hinter Operation, Discord-Event und Partnerverteilung.",
  anleitung: "Anleitung: So planst du Star-Citizen-Operationen, vergibst Flotten-Slots und meldest Crew im RDOC Fleetplanner an.",
  roadmap: "Roadmap des RDOC Fleetplanner — geplante Features für die Star-Citizen-Operationsplanung.",
  changelog: "Changelog des RDOC Fleetplanner — neue Funktionen und Änderungen.",
  unsigniert: "Warum die RDOC Squad Link Companion-Binary unsigniert ausgeliefert wird.",
};

// IA merge B: the 6 help/info docs become sections of one Handbuch hub instead of
// 6 top-level routes. Content still comes from the same backend endpoints
// (GET /api/v1/content/:slug, GET /api/v1/roadmap) — this is pure SPA composition.
const SECTIONS = [
  { key: "was-ist-das", label: "Was ist das?", icon: "eye" },
  { key: "technobabble", label: "Was ist das (Technobabble)", icon: "wrench" },
  { key: "architektur", label: "Softwarearchitektur", icon: "board" },
  { key: "anleitung", label: "Anleitung", icon: "doc" },
  { key: "roadmap", label: "Roadmap", icon: "board" },
  { key: "changelog", label: "Changelog", icon: "doc" },
  { key: "unsigniert", label: "Unsignierte Binary", icon: "alert" },
] as const;

function sectionContent(key: string) {
  switch (key) {
    case "was-ist-das": return <DocPage slug="whatis" lang="de" />;
    case "technobabble": return <DocPage slug="whatis-tech" lang="de" />;
    case "architektur": return <DocPage slug="architecture" lang="de" />;
    case "anleitung": return <DocPage slug="how-to" />;
    case "roadmap": return <RoadmapPage />;
    case "changelog": return <DocPage slug="changelog" />;
    case "unsigniert": return <DocPage slug="why-unsigned" />;
    default: return null;
  }
}

export function HandbuchPage() {
  const t = useT();
  const { section } = useParams<{ section: string }>();
  const active = SECTIONS.find((s) => s.key === section);
  useSeo({
    title: active ? `${t(`handbuch.sec.${active.key}`)} — ${t("handbuch.title")}` : t("handbuch.title"),
    description: active ? SECTION_DESC[active.key] : undefined,
  });
  if (!active) return <Navigate to="/handbuch/was-ist-das" replace />;

  return (
    <div data-testid="handbuch-page" style={{ display: "flex", gap: "1.5rem", alignItems: "flex-start", flexWrap: "wrap" }}>
      <aside className="handbuch-nav" style={{ flex: "0 0 220px", maxWidth: "100%", position: "sticky", top: 84, alignSelf: "flex-start" }}>
        <div style={{ fontFamily: MONO, fontSize: "0.6rem", letterSpacing: "0.14em", color: "var(--dim2)", textTransform: "uppercase", padding: "0 0.55rem 0.5rem" }}>{t("handbuch.title")}</div>
        <nav style={{ display: "flex", flexDirection: "column", gap: "0.12rem" }}>
          {SECTIONS.map((s) => (
            <Link
              key={s.key}
              to={`/handbuch/${s.key}`}
              data-testid={`handbuch-sec-${s.key}`}
              className={`nav-item${s.key === active.key ? " is-active" : ""}`}
            >
              <span className="nav-icon"><Ic name={s.icon} size={15} sw={1.6} /></span>
              <span className="nav-label">{t(`handbuch.sec.${s.key}`)}</span>
            </Link>
          ))}
        </nav>
      </aside>
      <div style={{ flex: "1 1 420px", minWidth: 0 }}>{sectionContent(active.key)}</div>
    </div>
  );
}
