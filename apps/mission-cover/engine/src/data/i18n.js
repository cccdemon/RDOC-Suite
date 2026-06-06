// Star Citizen Mission Cover Generator - Internationalization Dictionary
// Supports DE (German) and EN (English)

export const translations = {
  de: {
    // Header
    appTitle: 'STAR CITIZEN',
    appSubtitle: 'MISSION COVER GENERATOR v2.0',
    shuffle: 'SHUFFLE',
    jsonLoad: 'JSON LADEN',
    jsonExport: 'JSON EXPORTIEREN',
    reset: 'RESET',
    undo: 'RÜCKGÄNGIG',
    redo: 'WIEDERHOLEN',

    // Tabs
    tabPresets: 'PRESETS & SCHRIFT',
    tabBackground: 'HINTERGRUND',
    tabEffects: 'HUD OPTIK',
    tabLayers: 'EBENEN',

    // Presets & Font tab
    sectionPresets: 'MISSION STILRICHTUNG PRESETS',
    sectionColors: 'HUD AKZENTFARBEN ANPASSEN',
    sectionTypography: 'TYPOGRAFIE (Schriftarten)',
    sectionInsignia: 'ABZEICHEN & INSIGNIEN',
    sectionCommunity: 'ZUSÄTZLICHE COMMUNITY STAMPS',
    labelPrimaryColor: 'HUD Hauptfarbe',
    labelAccentColor: 'HUD Akzentfarbe',
    labelTitleFont: 'Titel-Schrift',
    labelBodyFont: 'Body-Schrift',
    labelTitleEffect: 'Titel Text-Effekt',
    labelTitleSize: 'Titel-Größe',
    labelSubtitleSize: 'Subtitel-Größe',
    labelEmblemSelect: 'Emblem wählen / hochladen',
    labelEmblemPlacement: 'Emblem-Platzierung',
    labelCommunityBadge: '"Made by the Community" Badge',
    labelScBadge: '"Star Citizen Logo" Badge',
    placementLeft: 'Links',
    placementRight: 'Rechts',
    placementBoth: 'Beide',
    placementOff: 'Aus',

    // Title effects
    effectGlow: 'HUD Glow',
    effectOutline: 'Outline',
    effectGlitch: 'Glitch',
    effectScanlines: 'Raster',
    effectStencil: 'Stencil',

    // Preset descriptions
    presetFleetOps: 'Klassisch UEE Militär Blau',
    presetBlackOps: 'Geheimdienst Rotlicht',
    presetExploration: 'Aufklärung Grünlicht',
    presetOutlaw: 'GrimHEX Gefahren-Gelb',

    // Background tab
    sectionBgUpload: 'HINTERGRUND GRAFIK LADEN',
    sectionAutoFit: 'HINTERGRUND AUTO-FIT MODUS',
    sectionPosition: 'POSITION & SKALIERUNG',
    sectionImageAdjust: 'BILDANPASSUNGEN (LUT / Filter)',
    labelUpload: 'HINTERGRUNDBILD UPLOAD',
    labelRemoveImage: 'BILD ENTFERNEN',
    labelZoom: 'Zoom (Größe)',
    labelHorizontal: 'Horizontale Verschiebung',
    labelVertical: 'Vertikale Verschiebung',
    labelBrightness: 'Helligkeit',
    labelContrast: 'Kontrast',
    labelSaturation: 'Sättigung',
    labelBlur: 'Fokus-Unschärfe (Blur)',
    labelColorFilter: 'Farbfilter Presets (LUTs)',
    labelFocusLens: 'Focus Lens (Fokus-Tiefe)',
    fitCover: 'Cover',
    fitContain: 'Contain',
    fitManual: 'Manuell',

    // Color filters
    filterNone: 'Normal',
    filterMono: 'S/W',
    filterNightvision: 'Nachtsicht',
    filterCyberpunk: 'Cyberpunk',
    filterThermal: 'Infrarot',
    filterColdspace: 'Deep Space',
    filterSepia: 'Sepia',
    filterRetrowave: 'Retrowave',
    filterBleach: 'Bleach',
    filterDuotone: 'Duotone',
    filterHDR: 'HDR',

    // Effects tab
    sectionGrid: 'HUD-HINTERGRUND RASTER',
    sectionHudElements: 'TACTICAL HUD ELEMENTE',
    sectionHudFilters: 'HUD FILTER & EFFEKTE',
    sectionGradient: 'GRADIENT OVERLAY',
    sectionQrCode: 'QR-CODE OVERLAY',
    gridDots: 'Dotted Grid',
    gridSquares: 'Karomuster',
    gridHalftone: 'Halftone',
    gridNone: 'Kein',
    labelCropMarks: 'Eck-Fadenkreuze (Crop Marks)',
    labelScanlines: 'Scanlines Intensität',
    labelNoise: 'Digitales Bildrauschen',
    labelVignette: 'Dunkler Rand (Vignette)',
    labelGlitch: 'Glitch-Flimmern (Glow)',
    labelChromatic: 'Chromatische Aberration',
    labelGradientEnable: 'Gradient Overlay aktivieren',
    labelGradientColor1: 'Farbe 1',
    labelGradientColor2: 'Farbe 2',
    labelGradientAngle: 'Richtung (Winkel)',
    labelGradientOpacity: 'Deckkraft',
    labelGradientBlend: 'Blend-Mode',
    labelQrEnable: 'QR-Code anzeigen',
    labelQrUrl: 'QR-Code URL',

    // Layers tab
    sectionLayers: 'EBENEN-VERWALTUNG',
    layerBackground: 'Hintergrund',
    layerEffects: 'HUD Effekte',
    layerLogos: 'Logos & Badges',
    layerTitle: 'Titel-Block',
    layerObjective: 'Ziel-Box',
    layerHeader: 'Header-Leiste',
    layerQr: 'QR-Code',
    layerGradient: 'Gradient',
    labelOpacity: 'Deckkraft',

    // Format selector
    sectionFormat: 'COVER FORMAT',
    format169: '16:9 Kino',
    format11: '1:1 Insta',
    format916: '9:16 Story',
    format43: '4:3 Std.',
    formatCustom: 'Custom',
    labelCustomWidth: 'Breite',
    labelCustomHeight: 'Höhe',

    // Export
    labelExportFormat: 'BILD EXPORTFORMAT',
    exportImage: 'COVER EXPORTIEREN',
    exportGif: 'GLITCH GIF EXPORTIEREN',
    exportingImage: 'EXPORTIERE...',
    exportingGif: 'GIF WIRD GENERIERT...',
    shortcutHint: 'Tastenkombination:',

    // Keyboard shortcuts
    shortcutsTitle: 'TASTENKÜRZEL ÜBERSICHT',
    shortcutUndo: 'Rückgängig',
    shortcutRedo: 'Wiederholen',
    shortcutSave: 'Bild exportieren',
    shortcutJson: 'JSON exportieren',
    shortcutShuffle: 'Zufällig mischen',
    shortcutPresets: 'Preset 1-4 wählen',
    shortcutShortcuts: 'Tastenkürzel anzeigen',
    shortcutClose: 'Modal schließen',
    shortcutClose2: 'Schließen',

    // Tip banner
    tipTitle: 'EDITIONSHINWEIS:',
    tipText: 'Klicke direkt auf die Texte auf dem Cover, um sie anzupassen! Logos und HUD-Farben lassen sich rechts anpassen. Textelemente sind per Drag & Drop verschiebbar.',

    // Canvas placeholders
    canvasNoImage: 'Kein Hintergrundbild geladen',

    // Logo selector
    logoSelectorTitle: 'HERALDRY & INSIGNIA SELECTOR',
    logoCustomTitle: 'CUSTOM LOGO (PNG/SVG)',
    logoPresetsTitle: 'FRAKTIONEN & HERSTELLER PRESETS',
    logoCommunityTitle: 'COMMUNITY & GAME BADGES',
    logoUploadTitle: 'Eigenes Abzeichen hochladen',
    logoUploadDesc: 'Unterstützt transparente PNG, SVG oder JPEG',
    logoCustomActive: 'Custom Logo Aktiv',
    logoRemove: 'ENTFERNEN',
    logoClose: 'SCHLIESSEN',

    // Preset library
    presetLibraryTitle: 'PRESET BIBLIOTHEK',
    presetLibrarySave: 'Aktuellen Style speichern',
    presetLibraryEmpty: 'Noch keine gespeicherten Presets. Speichere deinen aktuellen Style!',
    presetLibraryName: 'Preset Name:',
    presetLibraryDelete: 'Löschen',
    presetLibraryLoad: 'Laden',
    presetLibrarySaved: 'GESPEICHERTE STYLES',

    // Errors
    errorInvalidJson: 'Fehler: Ungültiges Dateiformat. Keine gültige Generator-Konfiguration gefunden.',
    errorJsonParse: 'Fehler beim Parsen der JSON-Datei.',
    errorExport: 'Fehler beim Exportieren des Bildes. Bitte versuche es erneut.',

    // Misc
    designShuffled: 'Design zufällig anpassen'
  },

  en: {
    // Header
    appTitle: 'STAR CITIZEN',
    appSubtitle: 'MISSION COVER GENERATOR v2.0',
    shuffle: 'SHUFFLE',
    jsonLoad: 'LOAD JSON',
    jsonExport: 'EXPORT JSON',
    reset: 'RESET',
    undo: 'UNDO',
    redo: 'REDO',

    // Tabs
    tabPresets: 'PRESETS & FONTS',
    tabBackground: 'BACKGROUND',
    tabEffects: 'HUD VISUALS',
    tabLayers: 'LAYERS',

    // Presets & Font tab
    sectionPresets: 'MISSION STYLE PRESETS',
    sectionColors: 'HUD ACCENT COLOR OVERRIDE',
    sectionTypography: 'TYPOGRAPHY (Fonts)',
    sectionInsignia: 'INSIGNIA & EMBLEMS',
    sectionCommunity: 'ADDITIONAL COMMUNITY STAMPS',
    labelPrimaryColor: 'HUD Primary Color',
    labelAccentColor: 'HUD Accent Color',
    labelTitleFont: 'Title Font',
    labelBodyFont: 'Body Font',
    labelTitleEffect: 'Title Text Effect',
    labelTitleSize: 'Title Size',
    labelSubtitleSize: 'Subtitle Size',
    labelEmblemSelect: 'Select / Upload Emblem',
    labelEmblemPlacement: 'Emblem Placement',
    labelCommunityBadge: '"Made by the Community" Badge',
    labelScBadge: '"Star Citizen Logo" Badge',
    placementLeft: 'Left',
    placementRight: 'Right',
    placementBoth: 'Both',
    placementOff: 'Off',

    // Title effects
    effectGlow: 'HUD Glow',
    effectOutline: 'Outline',
    effectGlitch: 'Glitch',
    effectScanlines: 'Scanline',
    effectStencil: 'Stencil',

    // Preset descriptions
    presetFleetOps: 'Classic UEE Military Blue',
    presetBlackOps: 'Intelligence Red Alert',
    presetExploration: 'Recon Green Light',
    presetOutlaw: 'GrimHEX Hazard Yellow',

    // Background tab
    sectionBgUpload: 'BACKGROUND IMAGE UPLOAD',
    sectionAutoFit: 'BACKGROUND AUTO-FIT MODE',
    sectionPosition: 'POSITION & SCALE',
    sectionImageAdjust: 'IMAGE ADJUSTMENTS (LUT / Filter)',
    labelUpload: 'UPLOAD BACKGROUND IMAGE',
    labelRemoveImage: 'REMOVE IMAGE',
    labelZoom: 'Zoom (Scale)',
    labelHorizontal: 'Horizontal Offset',
    labelVertical: 'Vertical Offset',
    labelBrightness: 'Brightness',
    labelContrast: 'Contrast',
    labelSaturation: 'Saturation',
    labelBlur: 'Focus Blur',
    labelColorFilter: 'Color Filter Presets (LUTs)',
    labelFocusLens: 'Focus Lens (Depth of Field)',
    fitCover: 'Cover',
    fitContain: 'Contain',
    fitManual: 'Manual',

    // Color filters
    filterNone: 'Normal',
    filterMono: 'B/W',
    filterNightvision: 'Night Vision',
    filterCyberpunk: 'Cyberpunk',
    filterThermal: 'Thermal',
    filterColdspace: 'Deep Space',
    filterSepia: 'Sepia',
    filterRetrowave: 'Retrowave',
    filterBleach: 'Bleach',
    filterDuotone: 'Duotone',
    filterHDR: 'HDR',

    // Effects tab
    sectionGrid: 'HUD BACKGROUND GRID',
    sectionHudElements: 'TACTICAL HUD ELEMENTS',
    sectionHudFilters: 'HUD FILTERS & EFFECTS',
    sectionGradient: 'GRADIENT OVERLAY',
    sectionQrCode: 'QR CODE OVERLAY',
    gridDots: 'Dotted Grid',
    gridSquares: 'Square Grid',
    gridHalftone: 'Halftone',
    gridNone: 'None',
    labelCropMarks: 'Corner Brackets (Crop Marks)',
    labelScanlines: 'Scanlines Intensity',
    labelNoise: 'Digital Noise',
    labelVignette: 'Dark Edge (Vignette)',
    labelGlitch: 'Glitch Flicker (Glow)',
    labelChromatic: 'Chromatic Aberration',
    labelGradientEnable: 'Enable Gradient Overlay',
    labelGradientColor1: 'Color 1',
    labelGradientColor2: 'Color 2',
    labelGradientAngle: 'Direction (Angle)',
    labelGradientOpacity: 'Opacity',
    labelGradientBlend: 'Blend Mode',
    labelQrEnable: 'Show QR Code',
    labelQrUrl: 'QR Code URL',

    // Layers tab
    sectionLayers: 'LAYER MANAGEMENT',
    layerBackground: 'Background',
    layerEffects: 'HUD Effects',
    layerLogos: 'Logos & Badges',
    layerTitle: 'Title Block',
    layerObjective: 'Objective Box',
    layerHeader: 'Header Bar',
    layerQr: 'QR Code',
    layerGradient: 'Gradient',
    labelOpacity: 'Opacity',

    // Format selector
    sectionFormat: 'COVER FORMAT',
    format169: '16:9 Cinema',
    format11: '1:1 Insta',
    format916: '9:16 Story',
    format43: '4:3 Std.',
    formatCustom: 'Custom',
    labelCustomWidth: 'Width',
    labelCustomHeight: 'Height',

    // Export
    labelExportFormat: 'IMAGE EXPORT FORMAT',
    exportImage: 'EXPORT COVER',
    exportGif: 'EXPORT GLITCH GIF',
    exportingImage: 'EXPORTING...',
    exportingGif: 'GENERATING GIF...',
    shortcutHint: 'Shortcut:',

    // Keyboard shortcuts
    shortcutsTitle: 'KEYBOARD SHORTCUTS',
    shortcutUndo: 'Undo',
    shortcutRedo: 'Redo',
    shortcutSave: 'Export Image',
    shortcutJson: 'Export JSON',
    shortcutShuffle: 'Randomize',
    shortcutPresets: 'Select Preset 1-4',
    shortcutShortcuts: 'Show Shortcuts',
    shortcutClose: 'Close Modal',
    shortcutClose2: 'Close',

    // Tip banner
    tipTitle: 'EDITING TIP:',
    tipText: 'Click directly on text elements on the cover to edit them! Logos and HUD colors can be adjusted in the sidebar. Text elements are draggable.',

    // Canvas placeholders
    canvasNoImage: 'No background image loaded',

    // Logo selector
    logoSelectorTitle: 'HERALDRY & INSIGNIA SELECTOR',
    logoCustomTitle: 'CUSTOM LOGO (PNG/SVG)',
    logoPresetsTitle: 'FACTION & MANUFACTURER PRESETS',
    logoCommunityTitle: 'COMMUNITY & GAME BADGES',
    logoUploadTitle: 'Upload Custom Emblem',
    logoUploadDesc: 'Supports transparent PNG, SVG or JPEG',
    logoCustomActive: 'Custom Logo Active',
    logoRemove: 'REMOVE',
    logoClose: 'CLOSE',

    // Preset library
    presetLibraryTitle: 'PRESET LIBRARY',
    presetLibrarySave: 'Save Current Style',
    presetLibraryEmpty: 'No saved presets yet. Save your current style!',
    presetLibraryName: 'Preset Name:',
    presetLibraryDelete: 'Delete',
    presetLibraryLoad: 'Load',
    presetLibrarySaved: 'SAVED STYLES',

    // Errors
    errorInvalidJson: 'Error: Invalid file format. No valid generator configuration found.',
    errorJsonParse: 'Error parsing JSON file.',
    errorExport: 'Error exporting image. Please try again.',

    // Misc
    designShuffled: 'Randomize design'
  }
};

export const defaultLang = 'de';

export function useTranslation(lang = defaultLang) {
  const t = (key) => translations[lang]?.[key] || translations.de[key] || key;
  return t;
}
