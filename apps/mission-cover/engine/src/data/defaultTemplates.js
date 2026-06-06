// Star Citizen Mission Cover Generator - Default Template Configurations
import communityBadge from '../assets/community-badge.png';
import scBadge from '../assets/sc-badge.png';


// High-fidelity SVG paths for Star Citizen logos to keep them crisp and theme-colored
export const LOGO_SVGS = {
  uee: {
    name: "UEE Navy",
    viewBox: "0 0 100 100",
    path: `<g fill="currentColor">
      <path d="M50,10 L85,25 L80,55 L50,85 L20,55 L15,25 Z" fill="none" stroke="currentColor" stroke-width="4" />
      <path d="M50,18 L76,29 L72,52 L50,75 L28,52 L24,29 Z" fill="none" stroke="currentColor" stroke-dasharray="2,2" stroke-width="2" />
      <!-- Stylized Eagle / Wings -->
      <path d="M50,30 L65,40 L60,45 L50,38 L40,45 L35,40 Z" />
      <path d="M50,42 L72,48 L68,54 L50,48 L32,54 L28,48 Z" />
      <path d="M50,52 L62,58 L50,65 L38,58 Z" />
      <circle cx="50" cy="24" r="3" />
    </g>`
  },
  crusader: {
    name: "Crusader Industries",
    viewBox: "0 0 100 100",
    path: `<g fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">
      <!-- Stylized Star/Cross -->
      <path d="M50,15 L50,85 M15,50 L85,50" stroke-width="3" />
      <!-- Wing sweeps -->
      <path d="M30,30 C40,45 60,45 70,30" />
      <path d="M30,70 C40,55 60,55 70,70" />
      <!-- Outer technical ring segments -->
      <path d="M22,35 A35,35 0 0,1 78,35" stroke-dasharray="8,4" stroke-width="2" />
      <path d="M22,65 A35,35 0 0,0 78,65" stroke-dasharray="8,4" stroke-width="2" />
      <circle cx="50" cy="50" r="10" fill="currentColor" />
    </g>`
  },
  hurston: {
    name: "Hurston Dynamics",
    viewBox: "0 0 100 100",
    path: `<g fill="currentColor">
      <!-- Outer hexagon -->
      <polygon points="50,12 83,31 83,69 50,88 17,69 17,31" fill="none" stroke="currentColor" stroke-width="4" />
      <!-- Inner heavy H and vertical division -->
      <path d="M32,35 H42 V45 H58 V35 H68 V65 H58 V55 H42 V65 H32 Z" />
      <line x1="50" y1="12" x2="50" y2="30" stroke="currentColor" stroke-width="2" />
      <line x1="50" y1="70" x2="50" y2="88" stroke="currentColor" stroke-width="2" />
    </g>`
  },
  microtech: {
    name: "microTech",
    viewBox: "0 0 100 100",
    path: `<g fill="none" stroke="currentColor" stroke-width="4">
      <!-- Concentric tech rings and data arcs -->
      <circle cx="50" cy="50" r="38" stroke-dasharray="15,5 5,5" />
      <circle cx="50" cy="50" r="26" stroke-dasharray="35,10" />
      <circle cx="50" cy="50" r="14" fill="currentColor" />
      <path d="M50,12 L50,2" stroke-width="2" />
      <path d="M50,88 L50,98" stroke-width="2" />
      <path d="M12,50 L2,50" stroke-width="2" />
      <path d="M88,50 L98,50" stroke-width="2" />
    </g>`
  },
  drake: {
    name: "Drake Interplanetary",
    viewBox: "0 0 100 100",
    path: `<g fill="none" stroke="currentColor" stroke-width="4" stroke-linejoin="miter">
      <!-- Rugged, angular, double chevrons and frame -->
      <polygon points="15,20 50,45 85,20 85,32 50,57 15,32" fill="currentColor" stroke="none" />
      <polygon points="15,42 50,67 85,42 85,54 50,79 15,54" fill="currentColor" stroke="none" />
      <rect x="10" y="10" width="80" height="80" stroke-width="2" stroke-dasharray="10,6" />
      <!-- Central core dot -->
      <circle cx="50" cy="18" r="4" fill="currentColor" stroke="none" />
    </g>`
  },
  aegis: {
    name: "Aegis Dynamics",
    viewBox: "0 0 100 100",
    path: `<g fill="currentColor">
      <!-- Shield shape -->
      <path d="M50,15 L80,28 L72,62 C68,78 50,88 50,88 C50,88 32,78 28,62 L20,28 Z" fill="none" stroke="currentColor" stroke-width="4" />
      <!-- Stylized center 'A' triangle -->
      <polygon points="50,28 70,68 60,68 50,48 40,68 30,68" />
      <line x1="28" y1="48" x2="72" y2="48" stroke="currentColor" stroke-width="2" />
    </g>`
  },
  anvil: {
    name: "Anvil Aerospace",
    viewBox: "0 0 100 100",
    path: `<g fill="none" stroke="currentColor" stroke-width="4">
      <!-- Anvil block and technical frames -->
      <path d="M20,25 H80 L70,45 H30 Z" fill="currentColor" />
      <path d="M40,45 H60 L65,75 H35 Z" />
      <path d="M15,80 H85" stroke-width="5" stroke-linecap="square" />
      <!-- Outer guide box -->
      <polygon points="50,10 90,35 90,75 50,90 10,75 10,35" stroke-width="1.5" stroke-dasharray="6,4" />
    </g>`
  },
  pirate: {
    name: "Outlaw / GrimHEX",
    viewBox: "0 0 100 100",
    path: `<g fill="currentColor">
      <!-- Skull with target overlay -->
      <path d="M50,22 C37,22 30,28 30,42 C30,50 35,55 38,58 L38,70 H62 L62,58 C65,55 70,50 70,42 C70,28 63,22 50,22 Z" fill="none" stroke="currentColor" stroke-width="4" />
      <circle cx="42" cy="38" r="4" />
      <circle cx="58" cy="38" r="4" />
      <rect x="44" y="52" width="12" height="4" />
      <!-- Crosshair lines -->
      <line x1="50" y1="12" x2="50" y2="88" stroke="currentColor" stroke-width="2" stroke-dasharray="4,4" />
      <line x1="12" y1="50" x2="88" y2="50" stroke="currentColor" stroke-width="2" stroke-dasharray="4,4" />
      <!-- Target rings -->
      <circle cx="50" cy="50" r="45" fill="none" stroke="currentColor" stroke-width="1" />
    </g>`
  }
};

export const BUILTIN_PNG_LOGOS = {
  community: {
    name: "Made by the Community",
    url: communityBadge
  },
  sc: {
    name: "Star Citizen Logo",
    url: scBadge
  }
};

export const defaultTemplates = [
  {
    id: "fleet-ops",
    name: "Fleet Operations",
    primaryColor: "#00f0ff", // Bright Teal HUD
    secondaryColor: "#005577",
    glowColor: "rgba(0, 240, 255, 0.4)",
    backgroundColor: "rgba(0, 10, 20, 0.85)",
    textColor: "#e5e7eb",
    accentColor: "#38bdf8",
    fontTitle: "Russo One",
    fontBody: "Rajdhani",
    scanlinesIntensity: 25,
    noiseIntensity: 15,
    vignetteIntensity: 45,
    glitchIntensity: 10,
    chromaticAberration: 15,
    gridOverlay: "dots",
    
    // Default Texts
    dossierLabel: "MISSION DOSSIER >>>",
    statusLabel: "STATUS: BEREIT // STANDBY",
    title: "OPERATION DATENKERN",
    subtitle: "ASD-SICHERHEITSKOMPLEX",
    tagline: "Sichern. Halten. Extrahieren.",
    objectiveTitle: "ZIEL:",
    objectiveText: "Datenkern sichern und verlustfrei zum Extraktionspunkt auf Daymar bringen.",
    location: "SYSTEM: STANTON // ORT: ARC-L1 WAREHOUSE",
    dateTime: "ZEIT: 04.06.2026 - 20:00 UTC",
    securityText: "VERTRAULICH // NUR FÜR AUTORISIERTE PERSONEN",
    fileCode: "DATEI: ASD-OP-DATENKERN-07",
    logoType: "uee",
    logoPlacement: "left",
    cropMarks: true,

    // Additional badges defaults
    showCommunityBadge: true,
    showScBadge: true,
    badgeSize: 75,
    logo1X: 40,
    logo1Y: 90,
    logo2X: 200,
    logo2Y: 90,

    // Additional filters
    colorFilter: "none",
    focusLensBlur: 0,

    // Background defaults
    backgroundBrightness: 100,
    backgroundContrast: 105,
    backgroundBlur: 0,
    backgroundSaturate: 100
  },
  {
    id: "black-ops",
    name: "Black Ops (Stealth/Tactical)",
    primaryColor: "#ef4444", // Crimson Red
    secondaryColor: "#7f1d1d",
    glowColor: "rgba(239, 68, 68, 0.45)",
    backgroundColor: "rgba(10, 0, 0, 0.9)",
    textColor: "#f3f4f6",
    accentColor: "#f87171",
    fontTitle: "Orbitron",
    fontBody: "Rajdhani",
    scanlinesIntensity: 45,
    noiseIntensity: 25,
    vignetteIntensity: 65,
    glitchIntensity: 30,
    chromaticAberration: 35,
    gridOverlay: "squares",
    
    // Default Texts
    dossierLabel: "CLASSIFIED DOCUMENT // SECURE EYES ONLY",
    statusLabel: "ALERT: SECURITY ACTIVE // LEVEL RED",
    title: "PROJECT BLACKOUT",
    subtitle: "CLAW-D1 COVERT INFILTRATION",
    tagline: "Infiltrieren. Sabotieren. Verschwinden.",
    objectiveTitle: "PRIMÄRZIEL:",
    objectiveText: "Stromgeneratoren der Hurston-Anlage überbrücken und ohne Signalmeldung entkommen.",
    location: "SYSTEM: STANTON // PLANET: HURSTON // SEKTOR: HDMS-LATHAM",
    dateTime: "ZEIT: CLASSIFIED // UNBEKANNT",
    securityText: "STRENG GEHEIM // ZUGRIFF ENTZUGEN BEI MISSACHTUNG",
    fileCode: "REF-COD: SEC-994A-GLITCH",
    logoType: "aegis",
    logoPlacement: "both",
    cropMarks: true,

    // Additional badges defaults
    showCommunityBadge: true,
    showScBadge: true,
    badgeSize: 75,
    logo1X: 40,
    logo1Y: 90,
    logo2X: 200,
    logo2Y: 90,

    // Additional filters
    colorFilter: "none",
    focusLensBlur: 0,

    // Background defaults
    backgroundBrightness: 85,
    backgroundContrast: 120,
    backgroundBlur: 1,
    backgroundSaturate: 75
  },
  {
    id: "exploration",
    name: "Exploration & Recon",
    primaryColor: "#10b981", // Deep Emerald Green / Amber Mix
    secondaryColor: "#065f46",
    glowColor: "rgba(16, 185, 129, 0.35)",
    backgroundColor: "rgba(2, 15, 10, 0.85)",
    textColor: "#e5e7eb",
    accentColor: "#34d399",
    fontTitle: "Orbitron",
    fontBody: "Rajdhani",
    scanlinesIntensity: 15,
    noiseIntensity: 10,
    vignetteIntensity: 35,
    glitchIntensity: 5,
    chromaticAberration: 8,
    gridOverlay: "dots",
    
    // Default Texts
    dossierLabel: "CARTOGRAPH DATA LOG // UEE MAPPING",
    statusLabel: "STATUS: SCANNING METRIC FLUX",
    title: "EXPEDITION ODYSSEY",
    subtitle: "PYRO SYSTEM - UNKARTIERTER SEKTOR",
    tagline: "Scannen. Vermessen. Überleben.",
    objectiveTitle: "EXPEDITIONSZIEL:",
    objectiveText: "Wurmloch-Signaturen vermessen und Gravitations-Scans anfertigen.",
    location: "SYSTEM: PYRO // JUMP POINT VECTOR: STN-PYR-01",
    dateTime: "ZEIT: STARDATE: 2956.156",
    securityText: "WISSENSCHAFTLICHE FREIGABE // ARCHIV-NUMMER EXP-84",
    fileCode: "LOG: PYR-RECON-V",
    logoType: "microtech",
    logoPlacement: "left",
    cropMarks: true,

    // Additional badges defaults
    showCommunityBadge: true,
    showScBadge: true,
    badgeSize: 75,
    logo1X: 40,
    logo1Y: 90,
    logo2X: 200,
    logo2Y: 90,

    // Additional filters
    colorFilter: "none",
    focusLensBlur: 0,

    // Background defaults
    backgroundBrightness: 110,
    backgroundContrast: 100,
    backgroundBlur: 0,
    backgroundSaturate: 110
  },
  {
    id: "outlaw",
    name: "Outlaw (GrimHEX)",
    primaryColor: "#f59e0b", // Hazard Orange / Outlaw Yellow
    secondaryColor: "#b45309",
    glowColor: "rgba(245, 158, 11, 0.4)",
    backgroundColor: "rgba(18, 12, 2, 0.9)",
    textColor: "#f9fafb",
    accentColor: "#fbbf24",
    fontTitle: "Russo One",
    fontBody: "Rajdhani",
    scanlinesIntensity: 55,
    noiseIntensity: 30,
    vignetteIntensity: 55,
    glitchIntensity: 40,
    chromaticAberration: 45,
    gridOverlay: "none",
    
    // Default Texts
    dossierLabel: "OUTLAW CONTRACT // NO CRIME STAT REPORT",
    statusLabel: "BOUNTY VALUE: 250.000 aUEC",
    title: "GRIMHEX HEIST",
    subtitle: "STERNENSTRASSE SCHMUGGLER-LAUF",
    tagline: "Abfangen. Plündern. Verkaufen.",
    objectiveTitle: "AUFTRAG:",
    objectiveText: "Abfangen des Hurston Transporters C2 im Orbit und Fracht im GrimHEX Tresor abliefern.",
    location: "SYSTEM: STANTON // ORBIT: YELA // SCHLUPFWINKEL: GRIMHEX",
    dateTime: "ZEIT: WENN DIE LUFT REIN IST // CRIME STAT 4+",
    securityText: "NUR FÜR DIE CREW // VERBRENNEN NACH ERHALT",
    fileCode: "HASH: GRIM-HAZARD-C2",
    logoType: "drake",
    logoPlacement: "right",
    cropMarks: true,

    // Additional badges defaults
    showCommunityBadge: true,
    showScBadge: true,
    badgeSize: 75,
    logo1X: 40,
    logo1Y: 90,
    logo2X: 200,
    logo2Y: 90,

    // Additional filters
    colorFilter: "none",
    focusLensBlur: 0,

    // Background defaults
    backgroundBrightness: 90,
    backgroundContrast: 115,
    backgroundBlur: 0,
    backgroundSaturate: 120
  }
];
