// Player-facing roadmap shown at /roadmap. Curated + readable — not the internal
// FR docs. Keep in sync with docs/ROADMAP.md when status changes.

export type RoadmapStatus = "planned" | "blocked" | "rejected" | "done";

export type RoadmapItem = {
  title: string;
  status: RoadmapStatus;
  /** Short, player-readable description (German). */
  desc: string;
  /** Optional note, e.g. why it's blocked. */
  note?: string;
};

export const ROADMAP: RoadmapItem[] = [
  // ── Geplant ──────────────────────────────────────────────────────────
  {
    title: "Event-Verteilung an Partner-Discords",
    status: "planned",
    desc: "Eine Operation per Knopfdruck in verbündete Discord-Server cross-posten, mit Freigabe durch eine Kontaktperson pro Server.",
  },
  {
    title: "Org-Flotte",
    status: "planned",
    desc: "Übersicht, welches Mitglied welches Schiff besitzt (inkl. Anzahl) — um Schiffe auszuleihen oder anzusehen, mit Discord-Kontaktlink.",
  },
  {
    title: "Roadmap & Feedback-Anbindung",
    status: "planned",
    desc: "Diese Roadmap plus automatisches Einlesen von Feedback aus dem Discord-Kanal.",
  },
  {
    title: "Inaktivitäts-Alarm",
    status: "planned",
    desc: "Der Fleetmanager-Bot meldet Mitglieder, die seit einer einstellbaren Zeit (Standard 6 Monate) inaktiv sind, in einen konfigurierten Kanal.",
  },
  {
    title: "Sprachumschaltung",
    status: "planned",
    desc: "Eine Sprache pro Nutzer (DE / EN / EN-US / FR / ES) im Profil — gilt für Fleetplanner, Companion und Mission-Cover. Eigennamen (Schiffe, Funknetze) bleiben englisch.",
  },

  // ── Abgelehnt ────────────────────────────────────────────────────────
  {
    title: "Federation Voice",
    status: "rejected",
    desc: "Gemeinsamer Sprachraum über mehrere Guilds/Events hinweg (Host + Stellvertreter).",
    note: "Abgelehnt — Begründung folgt.",
  },

  // ── Blockiert ────────────────────────────────────────────────────────
  {
    title: "Item-Datenbank (Loot / Verteilung)",
    status: "blocked",
    desc: "Beute erfassen und fair verteilen.",
    note: "Blockiert: aktuell keine brauchbare Items-API verfügbar.",
  },

  // ── Erledigt ─────────────────────────────────────────────────────────
  {
    title: "Wiederkehrende Events",
    status: "done",
    desc: "Operationen können sich wiederholen (wöchentlich, alle 2 Wochen, monatlich, jährlich); jede Wiederholung ist eine eigene Operation mit eigenem Roster.",
  },
  {
    title: "Mission-Cover-Generator",
    status: "done",
    desc: "Kinoreifes Briefing-Cover je Operation aus den Op-Daten — als Banner, Link-Vorschau und Discord-Event-Bild; mit Editor zum Feintuning.",
  },
  {
    title: "Flotten-Import (CCU-Game JSON)",
    status: "done",
    desc: "Eigene Schiffe per JSON-Export im Profil massenhaft importieren; nicht erkannte Namen manuell zuordnen.",
  },
  {
    title: "Bodenfahrzeuge",
    status: "done",
    desc: "Schiffe mit ausreichendem Frachtraum können ein Bodenfahrzeug als bemannbare Untereinheit tragen; der Operator akzeptiert Schiff samt Fahrzeug.",
  },
  {
    title: "Event-Erstellungs-Assistent + Anmelde-Ansicht",
    status: "done",
    desc: "Geführter Assistent zum Anlegen von Operationen und eine mobile, spielerfreundliche Anmelde-Seite.",
  },
  {
    title: "Überarbeitete Oberfläche",
    status: "done",
    desc: "Spieler-zuerst-Eventseite und ein aufgeräumter Operator-Arbeitsbereich mit Statusfluss und Aufmerksamkeits-Tabs.",
  },
];
