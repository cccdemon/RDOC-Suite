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
  /** Optional long rationale (paragraphs separated by blank lines), e.g. for rejected items. */
  reason?: string;
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
    note: "Abgelehnt — Begründung:",
    reason: [
      "Warum wir dieses Feature derzeit nicht umsetzen",
      "Uns wurde der Wunsch nach einem organisationsübergreifenden Sprachraum vorgetragen, bei dem mehrere Organisationen während gemeinsamer Operationen verbunden werden können, ohne dass Mitglieder ihren jeweiligen Discord-Server verlassen müssen.",
      "Die dahinterstehende Motivation ist nachvollziehbar: Organisationen möchten ihren Mitgliedern eine vertraute Umgebung bieten und gleichzeitig vermeiden, dass diese unmittelbar mit anderen Communities in Kontakt kommen, die möglicherweise aktiver oder größer erscheinen.",
      "Dennoch entspricht ein solches Konzept nicht der Philosophie, die wir mit dem Raumdock und dem RDOC Fleetmanager verfolgen.",
      "Unser Ziel ist es, die deutschsprachige Star-Citizen-Community miteinander zu vernetzen und Zusammenarbeit zwischen Organisationen zu fördern. Gemeinsame Operationen sollen Begegnungen ermöglichen, Brücken bauen und den Austausch zwischen Spielern und Communities erleichtern. Wir glauben an ein offenes „Jump-on, Jump-off“-Prinzip, bei dem Organisationen temporär zusammenarbeiten können, ohne sich voneinander abzuschotten.",
      "Eine technische Lösung, deren primärer Zweck darin besteht, die Sichtbarkeit anderer Communities zu reduzieren, sehen wir daher kritisch. Die langfristige Bindung von Mitgliedern entsteht aus einer aktiven Gemeinschaft, interessanten Inhalten, guter Organisation und einem attraktiven Miteinander. Diese Verantwortung liegt bei jeder Organisation selbst.",
      "Wenn Mitglieder ausschließlich deshalb gehalten werden können, weil ihnen Alternativen verborgen bleiben, löst Technologie nicht das eigentliche Problem. Unser Anspruch ist es nicht, solche Herausforderungen zu kaschieren, sondern Werkzeuge bereitzustellen, die Zusammenarbeit, Transparenz und gemeinsames Wachstum fördern.",
      "Deshalb werden wir ein Feature, das primär auf die Abschottung von Communities abzielt, aktuell nicht in unsere Roadmap aufnehmen.",
    ].join("\n\n"),
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
