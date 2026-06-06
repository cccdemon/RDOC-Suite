import React, { useState, useRef, useEffect, useCallback } from 'react';
import { defaultTemplates, LOGO_SVGS, BUILTIN_PNG_LOGOS } from './data/defaultTemplates';
import CoverCanvas from './components/CoverCanvas';
import LogoSelector from './components/LogoSelector';
import KeyboardShortcuts from './components/KeyboardShortcuts';
import useHistory from './hooks/useHistory';
import { translations, useTranslation } from './data/i18n';
import gifshot from 'gifshot';

import { 
  Upload, 
  Download, 
  Sparkles, 
  RotateCcw, 
  FileJson, 
  Image as ImageIcon, 
  Sliders, 
  Layout, 
  FolderOpen,
  Eye,
  EyeOff,
  Layers,
  Languages,
  HelpCircle,
  Trash2,
  Plus,
  Film
} from 'lucide-react';
import { toPng, toJpeg } from 'html-to-image';
import confetti from 'canvas-confetti';

const SCIFI_COLORS = [
  '#00f0ff', // Teal/Cyan
  '#ef4444', // Crimson Red
  '#10b981', // Emerald Green
  '#f59e0b', // Hazard Orange
  '#a855f7', // Purple/Violet
  '#3b82f6', // Cobalt Blue
  '#ec4899', // Pink
  '#f97316', // Bright Orange
  '#eab308', // Gold Yellow
  '#06b6d4', // Bright Teal
  '#14b8a6', // Turquoise
  '#22c55e'  // Lime Green
];

const TITLE_FONTS = [
  'Orbitron',
  'Russo One',
  'Rajdhani',
  'Bahnschrift',
  'Courier Prime',
  'Oxanium',
  'Teko',
  'Audiowide',
  'Syncopate'
];

const BODY_FONTS = [
  'Rajdhani',
  'Inter',
  'Bahnschrift',
  'Courier Prime',
  'Share Tech Mono',
  'Oxanium'
];

const LOCAL_STORAGE_KEY = "star-citizen-cover-generator-config";
const LOCAL_STORAGE_BG_KEY = "star-citizen-cover-generator-bg";
const LOCAL_STORAGE_LANG_KEY = "star-citizen-cover-generator-lang";
const LOCAL_STORAGE_PRESETS_KEY = "star-citizen-cover-generator-custom-presets";

// Safe wrapper for localStorage access under file:// protocol
const safeStorage = {
  getItem: (key) => {
    try {
      return localStorage.getItem(key);
    } catch (e) {
      console.warn("localStorage.getItem blocked:", e);
      return null;
    }
  },
  setItem: (key, value) => {
    try {
      localStorage.setItem(key, value);
    } catch (e) {
      console.warn("localStorage.setItem blocked:", e);
    }
  },
  removeItem: (key) => {
    try {
      localStorage.removeItem(key);
    } catch (e) {
      console.warn("localStorage.removeItem blocked:", e);
    }
  }
};

const defaultLayers = {
  background: { visible: true, opacity: 100 },
  effects: { visible: true, opacity: 100 },
  logos: { visible: true, opacity: 100 },
  title: { visible: true, opacity: 100 },
  objective: { visible: true, opacity: 100 },
  header: { visible: true, opacity: 100 },
  qr: { visible: true, opacity: 100 },
  gradient: { visible: true, opacity: 100 }
};

export default function App() {
  // 1. Language state & localization hook
  const [lang, setLang] = useState(() => {
    return safeStorage.getItem(LOCAL_STORAGE_LANG_KEY) || 'de';
  });
  const t = useTranslation(lang);

  // Toggle app language
  const toggleLanguage = () => {
    const nextLang = lang === 'de' ? 'en' : 'de';
    setLang(nextLang);
    safeStorage.setItem(LOCAL_STORAGE_LANG_KEY, nextLang);
  };

  // 2. Load initial configuration
  const getInitialConfig = () => {
    // Server-render / editor prefill: globals win over localStorage so uploaded
    // images (bg, custom logo) never have to fit the localStorage quota.
    if (typeof window !== 'undefined' && window.__MC_CONFIG__ && typeof window.__MC_CONFIG__ === 'object') {
      const injected = window.__MC_CONFIG__;
      if (!injected.layers) injected.layers = { ...defaultLayers };
      return injected;
    }
    const saved = safeStorage.getItem(LOCAL_STORAGE_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed && typeof parsed === 'object') {
          // Ensure layers config is loaded or fallback
          if (!parsed.layers) parsed.layers = { ...defaultLayers };
          return parsed;
        }
      } catch (e) {
        console.error("Failed to parse saved config:", e);
      }
    }
    return { 
      ...defaultTemplates[0],
      layers: { ...defaultLayers }
    };
  };

  // 3. Undo/Redo history state setup
  const {
    state: config,
    setState: setConfig,
    undo,
    redo,
    reset: resetHistory,
    canUndo,
    canRedo
  } = useHistory(getInitialConfig());

  // 4. Other core states
  const [bgImage, setBgImage] = useState(() => {
    if (typeof window !== 'undefined' && window.__MC_BG__) return window.__MC_BG__;
    return safeStorage.getItem(LOCAL_STORAGE_BG_KEY) || null;
  });

  // Publish live state so the server-render/editor save can read the real
  // current cover (bg + custom logo included) without relying on localStorage,
  // which silently drops large data-URL images when the quota is exceeded.
  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.__MC_STATE__ = { config, bgImage };
    }
  }, [config, bgImage]);

  const [customPresets, setCustomPresets] = useState(() => {
    const saved = safeStorage.getItem(LOCAL_STORAGE_PRESETS_KEY);
    return saved ? JSON.parse(saved) : [];
  });

  const [newPresetName, setNewPresetName] = useState("");
  const [showLogoSelector, setShowLogoSelector] = useState(false);
  const [showShortcutsModal, setShowShortcutsModal] = useState(false);
  const [activeTab, setActiveTab] = useState('style'); // 'style', 'bg', 'fx', 'layers'
  const [exportFormat, setExportFormat] = useState('png'); // 'png' or 'jpeg'
  const [isExporting, setIsExporting] = useState(false);
  const [isExportingGif, setIsExportingGif] = useState(false);
  const [canvasZoom, setCanvasZoom] = useState(1);

  const canvasRef = useRef(null);
  const fileInputRef = useRef(null);
  const jsonInputRef = useRef(null);

  // Auto-save settings to localStorage
  useEffect(() => {
    try {
      safeStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(config));
    } catch (e) {
      console.warn("Could not save config to localStorage:", e);
    }
  }, [config]);

  // Auto-save background image to localStorage
  useEffect(() => {
    if (bgImage) {
      try {
        safeStorage.setItem(LOCAL_STORAGE_BG_KEY, bgImage);
      } catch (e) {
        console.warn("Could not save background image to localStorage (likely quota limit):", e);
      }
    } else {
      safeStorage.removeItem(LOCAL_STORAGE_BG_KEY);
    }
  }, [bgImage]);

  // Sync custom logo into config when it changes
  const handleUploadCustomLogo = (dataUrl) => {
    setConfig(prev => ({
      ...prev,
      customLogoUrl: dataUrl,
      logoType: dataUrl ? 'custom' : 'uee'
    }));
  };

  const handleSelectLogo = (logoKey) => {
    setConfig(prev => ({
      ...prev,
      logoType: logoKey
    }));
  };

  // Switch the visual STYLE only — keep all of the user's content (texts,
  // positions, badges, background, logo). Previously this replaced the whole
  // config with the preset, wiping every edit on a style change.
  const STYLE_FIELDS = [
    'primaryColor', 'secondaryColor', 'glowColor', 'backgroundColor', 'textColor',
    'accentColor', 'fontTitle', 'fontBody', 'scanlinesIntensity', 'noiseIntensity',
    'vignetteIntensity', 'glitchIntensity', 'chromaticAberration', 'gridOverlay',
  ];
  const handleSelectPreset = (presetId) => {
    const preset = defaultTemplates.find(t => t.id === presetId);
    if (preset) {
      setConfig(prev => {
        const next = { ...prev, id: preset.id, name: preset.name };
        for (const k of STYLE_FIELDS) next[k] = preset[k];
        if (!next.layers) next.layers = { ...defaultLayers };
        return next;
      });
    }
  };

  // Modify individual config values
  const handleChangeField = useCallback((key, value) => {
    setConfig(prev => ({
      ...prev,
      [key]: value
    }));
  }, [setConfig]);

  // Handle upload of background image
  const handleBgUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        setBgImage(event.target.result);
      };
      reader.readAsDataURL(file);
    }
  };

  // Remove background image
  const handleBgRemove = () => {
    setBgImage(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // Reset current theme/texts to its template defaults
  const handleReset = () => {
    const defaultForTheme = defaultTemplates.find(t => t.id === config.id) || defaultTemplates[0];
    setConfig({ 
      ...defaultForTheme,
      layers: { ...defaultLayers }
    });
    setBgImage(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
    resetHistory({ 
      ...defaultForTheme,
      layers: { ...defaultLayers }
    });
  };

  // Export config as a JSON file
  const handleExportJSON = () => {
    const exportData = {
      version: "2.0",
      config: {
        ...config,
      },
      bgImage: bgImage
    };

    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(exportData, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `mission-cover-config-${config.title.toLowerCase().replace(/\s+/g, '-') || 'style'}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  // Import config from a JSON file
  const handleImportJSON = (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const parsed = JSON.parse(event.target.result);
          if (parsed && parsed.config) {
            if (!parsed.config.layers) parsed.config.layers = { ...defaultLayers };
            setConfig(parsed.config);
            if (parsed.bgImage) {
              setBgImage(parsed.bgImage);
            }
            resetHistory(parsed.config);
            confetti({
              particleCount: 40,
              spread: 60,
              origin: { y: 0.8 },
              colors: [parsed.config.primaryColor || '#00f0ff', '#ffffff']
            });
          } else {
            alert(t('errorInvalidJson'));
          }
        } catch (err) {
          alert(t('errorJsonParse'));
        }
      };
      reader.readAsText(file);
    }
  };

  // Randomize layouts, styles, filters, and placements
  const handleShuffle = () => {
    const randomColor1 = SCIFI_COLORS[Math.floor(Math.random() * SCIFI_COLORS.length)];
    const randomColor2 = SCIFI_COLORS[Math.floor(Math.random() * SCIFI_COLORS.length)];
    const randomTitle = TITLE_FONTS[Math.floor(Math.random() * TITLE_FONTS.length)];
    const randomBody = BODY_FONTS[Math.floor(Math.random() * BODY_FONTS.length)];
    
    const placements = ['left', 'right', 'both', 'none'];
    const randomPlacement = placements[Math.floor(Math.random() * placements.length)];
    
    const logos = ['uee', 'crusader', 'hurston', 'microtech', 'drake', 'aegis', 'anvil', 'pirate', 'community', 'sc'];
    const randomLogo = logos[Math.floor(Math.random() * logos.length)];
    
    const gridOverlays = ['dots', 'squares', 'halftone', 'none'];
    const randomGrid = gridOverlays[Math.floor(Math.random() * gridOverlays.length)];
    
    const autoFits = ['cover', 'contain', 'custom'];
    const randomAutoFit = autoFits[Math.floor(Math.random() * autoFits.length)];

    const randomFilters = ['none', 'monochrome', 'nightvision', 'cyberpunk', 'thermal', 'coldspace', 'sepia', 'retrowave', 'bleach', 'duotone', 'hdr'];
    const randomFilter = randomFilters[Math.floor(Math.random() * randomFilters.length)];

    setConfig(prev => ({
      ...prev,
      primaryColor: randomColor1,
      secondaryColor: `${randomColor1}99`,
      glowColor: `${randomColor1}55`,
      accentColor: randomColor2,
      fontTitle: randomTitle,
      fontBody: randomBody,
      logoPlacement: randomPlacement,
      logoType: randomLogo,
      gridOverlay: randomGrid,
      cropMarks: Math.random() > 0.3,
      autoFit: randomAutoFit,
      scanlinesIntensity: Math.floor(Math.random() * 45) + 10,
      noiseIntensity: Math.floor(Math.random() * 25) + 5,
      vignetteIntensity: Math.floor(Math.random() * 40) + 30,
      glitchIntensity: Math.floor(Math.random() * 35) + 5,
      chromaticAberration: Math.floor(Math.random() * 35) + 5,
      backgroundBrightness: Math.floor(Math.random() * 40) + 80,
      backgroundContrast: Math.floor(Math.random() * 40) + 90,
      backgroundBlur: Math.floor(Math.random() * 3),
      backgroundSaturate: Math.floor(Math.random() * 70) + 70,
      colorFilter: randomFilter,
      focusLensBlur: Math.floor(Math.random() * 8),
      titleEffect: ['glow', 'outline', 'glitch', 'scanlines', 'stencil'][Math.floor(Math.random() * 5)],
      titleSize: Math.floor(Math.random() * 24) + 36,
      subtitleSize: Math.floor(Math.random() * 6) + 11,
      gradientEnabled: Math.random() > 0.6,
      gradientColor1: SCIFI_COLORS[Math.floor(Math.random() * SCIFI_COLORS.length)],
      gradientColor2: SCIFI_COLORS[Math.floor(Math.random() * SCIFI_COLORS.length)],
      gradientAngle: Math.floor(Math.random() * 360),
      gradientOpacity: Math.floor(Math.random() * 30) + 10,
      gradientBlend: ['overlay', 'multiply', 'screen', 'color-dodge'][Math.floor(Math.random() * 4)]
    }));

    confetti({
      particleCount: 50,
      spread: 50,
      origin: { y: 0.85 },
      colors: [randomColor1, randomColor2, '#ffffff']
    });
  };

  // Convert cover HTML DOM to Image and download
  const handleExportImage = () => {
    if (!canvasRef.current) return;
    setIsExporting(true);

    // Give a minor delay to make sure UI states update (e.g. contenteditable focus borders hide)
    setTimeout(() => {
      // Scale options for higher crispness
      const options = {
        pixelRatio: 2, // Double size for high quality print/digital
        cacheBust: true,
        style: {
          transform: 'scale(1)',
          transformOrigin: 'top left',
          width: '100%',
          height: '100%'
        }
      };

      const exportFn = exportFormat === 'png' ? toPng : toJpeg;
      const fileExt = exportFormat === 'png' ? 'png' : 'jpg';

      exportFn(canvasRef.current, options)
        .then((dataUrl) => {
          const link = document.createElement('a');
          const safeTitle = config.title ? config.title.toLowerCase().replace(/[^a-z0-9]+/g, '-') : 'mission-cover';
          link.download = `${safeTitle}.${fileExt}`;
          link.href = dataUrl;
          link.click();
          
          confetti({
            particleCount: 100,
            spread: 70,
            origin: { y: 0.6 },
            colors: [config.primaryColor, '#ffffff', config.accentColor]
          });
          
          setIsExporting(false);
        })
        .catch((error) => {
          console.error('Export failed:', error);
          alert(t('errorExport'));
          setIsExporting(false);
        });
    }, 300);
  };

  // Canvas GIF Glitch recording
  const handleExportGIF = async () => {
    if (!canvasRef.current || isExportingGif) return;
    setIsExportingGif(true);

    const originalConfig = { ...config };
    const frames = [];
    const numFrames = 10;
    const interval = 120; // ms between frames

    // Capture loop
    for (let i = 0; i < numFrames; i++) {
      // Randomize glitches on every frame
      setConfig(prev => ({
        ...prev,
        glitchIntensity: Math.floor(Math.random() * 60) + 20,
        chromaticAberration: Math.floor(Math.random() * 50) + 15,
        noiseIntensity: Math.floor(Math.random() * 45) + 15
      }));

      // Wait for React to re-render the canvas
      await new Promise(resolve => setTimeout(resolve, interval));

      try {
        const frameDataUrl = await toPng(canvasRef.current, {
          pixelRatio: 1, // smaller size to keep gif file size down
          cacheBust: true,
          style: {
            transform: 'scale(1)',
            transformOrigin: 'top left'
          }
        });
        frames.push(frameDataUrl);
      } catch (err) {
        console.error("Frame capture error:", err);
      }
    }

    // Restore original state
    setConfig(originalConfig);

    if (frames.length > 0) {
      gifshot.createGIF({
        images: frames,
        gifWidth: 800,
        gifHeight: 450,
        interval: interval / 1000,
        numFrames: numFrames,
        frameDuration: 1.2
      }, (obj) => {
        if (!obj.error) {
          const link = document.createElement('a');
          const safeTitle = config.title ? config.title.toLowerCase().replace(/[^a-z0-9]+/g, '-') : 'mission-cover';
          link.download = `${safeTitle}-animated.gif`;
          link.href = obj.image;
          link.click();
          
          confetti({
            particleCount: 50,
            spread: 50,
            origin: { y: 0.6 },
            colors: ['#a855f7', '#ffffff', config.primaryColor]
          });
        } else {
          alert(t('errorExport'));
        }
        setIsExportingGif(false);
      });
    } else {
      setIsExportingGif(false);
    }
  };

  // Keyboard Shortcuts handler
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Check for modifier keys
      const ctrlOrMeta = e.ctrlKey || e.metaKey;

      if (ctrlOrMeta) {
        switch (e.key.toLowerCase()) {
          case 'z':
            e.preventDefault();
            undo();
            break;
          case 'y':
            e.preventDefault();
            redo();
            break;
          case 's':
            e.preventDefault();
            handleExportImage();
            break;
          case 'e':
            e.preventDefault();
            handleExportJSON();
            break;
          default:
            break;
        }
      } else {
        // Single character shortcuts (only if not editing inline text)
        if (document.activeElement.tagName === 'INPUT' || document.activeElement.contentEditable === 'true') {
          return;
        }

        switch (e.key.toLowerCase()) {
          case 'r':
            e.preventDefault();
            handleShuffle();
            break;
          case '?':
            e.preventDefault();
            setShowShortcutsModal(prev => !prev);
            break;
          case '1':
            e.preventDefault();
            handleSelectPreset('fleet-ops');
            break;
          case '2':
            e.preventDefault();
            handleSelectPreset('black-ops');
            break;
          case '3':
            e.preventDefault();
            handleSelectPreset('exploration');
            break;
          case '4':
            e.preventDefault();
            handleSelectPreset('outlaw');
            break;
          default:
            break;
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [config, bgImage, exportFormat, undo, redo]);

  // Ctrl+Scroll zoom handler for the canvas wrapper
  useEffect(() => {
    const handleWheel = (e) => {
      if (e.ctrlKey) {
        e.preventDefault();
        const delta = e.deltaY < 0 ? 0.05 : -0.05;
        setCanvasZoom(prev => Math.min(2.0, Math.max(0.4, prev + delta)));
      }
    };
    const el = document.querySelector('.canvas-wrapper');
    if (el) {
      el.addEventListener('wheel', handleWheel, { passive: false });
      return () => el.removeEventListener('wheel', handleWheel);
    }
  }, []);

  // Layer toggle helpers
  const toggleLayerVisibility = (layerName) => {
    const layers = config.layers || { ...defaultLayers };
    const layer = layers[layerName] ? { ...layers[layerName] } : { visible: true, opacity: 100 };
    layer.visible = layer.visible === false;
    
    handleChangeField('layers', {
      ...layers,
      [layerName]: layer
    });
  };

  const changeLayerOpacity = (layerName, opacityValue) => {
    const layers = config.layers || { ...defaultLayers };
    const layer = layers[layerName] ? { ...layers[layerName] } : { visible: true, opacity: 100 };
    layer.opacity = opacityValue;

    handleChangeField('layers', {
      ...layers,
      [layerName]: layer
    });
  };

  // Custom Local Preset functions
  const handleSaveCustomPreset = () => {
    if (!newPresetName.trim()) return;
    const newPreset = {
      id: `custom-${Date.now()}`,
      name: newPresetName.trim(),
      date: new Date().toLocaleDateString(lang === 'de' ? 'de-DE' : 'en-US', { 
        hour: '2-digit', 
        minute: '2-digit' 
      }),
      config: { ...config }
    };
    const updated = [...customPresets, newPreset];
    setCustomPresets(updated);
    safeStorage.setItem(LOCAL_STORAGE_PRESETS_KEY, JSON.stringify(updated));
    setNewPresetName("");
    confetti({ particleCount: 30, spread: 40 });
  };

  const handleDeleteCustomPreset = (id) => {
    const updated = customPresets.filter(p => p.id !== id);
    setCustomPresets(updated);
    safeStorage.setItem(LOCAL_STORAGE_PRESETS_KEY, JSON.stringify(updated));
  };

  // Translate format labels
  const getFormatLabel = (fmt) => {
    if (fmt === 'custom') return t('formatCustom');
    return t('format' + fmt.replace(':', ''));
  };

  return (
    <div className="app-container">
      
      {/* 1. TOP SCI-FI NAVIGATION HEADER BAR */}
      <header className="header-bar">
        
        {/* Logo and title */}
        <div className="header-brand">
          <div className="brand-icon" style={{ borderColor: config.primaryColor, color: config.primaryColor, filter: `drop-shadow(0 0 5px ${config.glowColor})` }}>
            <svg viewBox="0 0 24 24" style={{ width: '20px', height: '20px', fill: 'none', stroke: 'currentColor' }}>
              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <div className="brand-text">
            <h1 style={{ color: config.primaryColor, textShadow: `0 0 8px ${config.glowColor}` }}>{t('appTitle')}</h1>
            <p>{t('appSubtitle')}</p>
            {/* Author credit (Vi5E) — fixed attribution, do not remove. */}
            <p className="author-credit" style={{ fontSize: '10px', color: '#94a3b8', marginTop: '2px', display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
              <span>by</span>
              <a href="https://www.vi5e.net/" target="_blank" rel="noopener noreferrer" style={{ color: config.primaryColor, textDecoration: 'none', fontWeight: 'bold' }}>Vi5E</a>
              <a href="https://www.twitch.tv/vi5e/" target="_blank" rel="noopener noreferrer" style={{ color: '#a855f7', textDecoration: 'none' }}>Twitch</a>
              <a href="https://www.youtube.com/@Vi5E_" target="_blank" rel="noopener noreferrer" style={{ color: '#ef4444', textDecoration: 'none' }}>YouTube</a>
            </p>
          </div>
        </div>

        {/* Global actions & Language toggle */}
        <div className="header-actions">
          {/* Language selection toggle */}
          <div className="lang-toggle">
            <button 
              onClick={() => { if (lang !== 'de') toggleLanguage(); }}
              className={`lang-btn ${lang === 'de' ? 'active' : ''}`}
            >
              DE
            </button>
            <button 
              onClick={() => { if (lang !== 'en') toggleLanguage(); }}
              className={`lang-btn ${lang === 'en' ? 'active' : ''}`}
            >
              EN
            </button>
          </div>

          {/* Undo / Redo */}
          <button 
            onClick={undo} 
            disabled={!canUndo} 
            className="hud-btn" 
            title={t('undo')}
            style={{ opacity: canUndo ? 1 : 0.4, cursor: canUndo ? 'pointer' : 'not-allowed', padding: '6px 8px' }}
          >
            <span>{t('undo')}</span>
          </button>

          <button 
            onClick={redo} 
            disabled={!canRedo} 
            className="hud-btn" 
            title={t('redo')}
            style={{ opacity: canRedo ? 1 : 0.4, cursor: canRedo ? 'pointer' : 'not-allowed', padding: '6px 8px' }}
          >
            <span>{t('redo')}</span>
          </button>

          {/* Shuffle button */}
          <button 
            onClick={handleShuffle}
            className="hud-btn"
            style={{ 
              gap: '6px', 
              padding: '6px 12px', 
              fontSize: '11px', 
              fontWeight: 'bold', 
              fontFamily: "var(--font-tech)",
              borderColor: 'rgba(245, 158, 11, 0.4)', 
              color: '#fbbf24',
              background: 'linear-gradient(135deg, rgba(245, 158, 11, 0.1), rgba(217, 119, 6, 0.1))',
              boxShadow: '0 0 8px rgba(245, 158, 11, 0.15)'
            }}
            title={t('designShuffled')}
          >
            <Sparkles style={{ width: '14px', height: '14px' }} className="hud-pulse" />
            <span>{t('shuffle')}</span>
          </button>

          <button 
            onClick={() => jsonInputRef.current?.click()}
            className="hud-btn"
            style={{ gap: '6px', padding: '6px 12px', fontSize: '11px', fontWeight: 'bold', fontFamily: "var(--font-tech)" }}
          >
            <FolderOpen style={{ width: '14px', height: '14px' }} />
            <span>{t('jsonLoad')}</span>
          </button>
          <input 
            ref={jsonInputRef}
            type="file" 
            accept=".json"
            onChange={handleImportJSON}
            className="hidden"
          />

          <button 
            onClick={handleExportJSON}
            className="hud-btn"
            style={{ gap: '6px', padding: '6px 12px', fontSize: '11px', fontWeight: 'bold', fontFamily: "var(--font-tech)" }}
          >
            <FileJson style={{ width: '14px', height: '14px' }} />
            <span>{t('jsonExport')}</span>
          </button>

          <button 
            onClick={handleReset}
            className="hud-btn"
            style={{ 
              gap: '6px', 
              padding: '6px 12px', 
              fontSize: '11px', 
              fontWeight: 'bold', 
              fontFamily: "var(--font-tech)",
              borderColor: 'rgba(239, 68, 68, 0.25)', 
              color: '#f87171',
              backgroundColor: 'rgba(127, 29, 29, 0.15)'
            }}
          >
            <RotateCcw style={{ width: '14px', height: '14px' }} />
            <span>{t('reset')}</span>
          </button>

          {/* Help button for shortcuts modal */}
          <button 
            onClick={() => setShowShortcutsModal(true)}
            className="hud-btn"
            style={{ padding: '6px 8px', borderColor: 'rgba(56, 189, 248, 0.3)', color: '#38bdf8' }}
            title={t('shortcutShortcuts')}
          >
            <HelpCircle style={{ width: '15px', height: '15px' }} />
          </button>
        </div>

      </header>

      {/* 2. MAIN APP WORKSPACE */}
      <div className="workspace-body">
        
        {/* LEFT COLUMN: LIVE WYSIWYG CANVAS PREVIEW */}
        <main className="preview-area">
          
          {/* Cover Canvas Box Container */}
          <div className="canvas-wrapper" style={{ overflow: 'visible' }}>
            
            {/* Technical framing lines */}
            <div className="technical-marker-tl">
              <span>[ VIEWPORT_02 // ZOOM: {Math.round(canvasZoom * 100)}% ]</span>
            </div>
            <div className="technical-marker-br">
              <span>SECURE DATA LINK LINK_OK</span>
            </div>

            {/* Renders the actual interactive cover content */}
            <CoverCanvas
              config={config}
              onChangeField={handleChangeField}
              onOpenLogoSelector={() => setShowLogoSelector(true)}
              canvasRef={canvasRef}
              bgImage={bgImage}
              canvasZoom={canvasZoom}
              layers={config.layers || defaultLayers}
            />
          </div>

          {/* Zoom Toolbar & User Instructions */}
          <div style={{ display: 'flex', width: '100%', maxWidth: '90%', justifyContent: 'space-between', alignItems: 'center', margin: '20px auto 0 auto', gap: '20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'rgba(15, 23, 42, 0.6)', border: '1px solid #1e293b', borderRadius: '4px', padding: '4px 12px', fontFamily: 'var(--font-tech)', fontSize: '11px' }}>
              <span>ZOOM:</span>
              <button onClick={() => setCanvasZoom(prev => Math.max(0.4, prev - 0.1))} className="hud-btn" style={{ padding: '2px 8px', minWidth: '24px' }}>-</button>
              <button onClick={() => setCanvasZoom(1)} className="hud-btn" style={{ padding: '2px 8px', minWidth: '42px' }}>100%</button>
              <button onClick={() => setCanvasZoom(prev => Math.min(2.0, prev + 0.1))} className="hud-btn" style={{ padding: '2px 8px', minWidth: '24px' }}>+</button>
              <span style={{ color: '#64748b', fontSize: '9px', marginLeft: '6px' }}>(Ctrl + Scroll)</span>
            </div>

            <div className="tip-banner" style={{ margin: 0, flex: 1 }}>
              <Sparkles style={{ width: '16px', height: '16px', flexShrink: 0, color: '#fbbf24' }} className="hud-pulse" />
              <span>
                <strong>{t('tipTitle')}</strong> {t('tipText')}
              </span>
            </div>
          </div>

        </main>

        {/* RIGHT COLUMN: CONTROL PANEL SIDEBAR */}
        <aside className="sidebar">
          
          {/* Sidebar Tabs */}
          <div className="tabs-header">
            <button 
              onClick={() => setActiveTab('style')}
              className={`tab-btn ${activeTab === 'style' ? 'active' : ''}`}
              style={activeTab === 'style' ? { 
                borderBottomColor: config.primaryColor,
                color: config.primaryColor,
                textShadow: `0 0 8px ${config.glowColor}`,
                backgroundColor: `${config.primaryColor}15`
              } : {}}
            >
              <Layout style={{ width: '16px', height: '16px' }} />
              <span>{t('tabPresets')}</span>
            </button>
            <button 
              onClick={() => setActiveTab('bg')}
              className={`tab-btn ${activeTab === 'bg' ? 'active' : ''}`}
              style={activeTab === 'bg' ? { 
                borderBottomColor: config.primaryColor,
                color: config.primaryColor,
                textShadow: `0 0 8px ${config.glowColor}`,
                backgroundColor: `${config.primaryColor}15`
              } : {}}
            >
              <ImageIcon style={{ width: '16px', height: '16px' }} />
              <span>{t('tabBackground')}</span>
            </button>
            <button 
              onClick={() => setActiveTab('fx')}
              className={`tab-btn ${activeTab === 'fx' ? 'active' : ''}`}
              style={activeTab === 'fx' ? { 
                borderBottomColor: config.primaryColor,
                color: config.primaryColor,
                textShadow: `0 0 8px ${config.glowColor}`,
                backgroundColor: `${config.primaryColor}15`
              } : {}}
            >
              <Sliders style={{ width: '16px', height: '16px' }} />
              <span>{t('tabEffects')}</span>
            </button>
            <button 
              onClick={() => setActiveTab('layers')}
              className={`tab-btn ${activeTab === 'layers' ? 'active' : ''}`}
              style={activeTab === 'layers' ? { 
                borderBottomColor: config.primaryColor,
                color: config.primaryColor,
                textShadow: `0 0 8px ${config.glowColor}`,
                backgroundColor: `${config.primaryColor}15`
              } : {}}
            >
              <Layers style={{ width: '16px', height: '16px' }} />
              <span>{t('tabLayers')}</span>
            </button>
          </div>

          {/* Sidebar Tab Contents */}
          <div className="sidebar-content">

            {/* TAB 1: PRESETS, COLOR, FONTS & BADGES */}
            {activeTab === 'style' && (
              <>
                {/* Format selection */}
                <div>
                  <span className="section-title">{t('sectionFormat')}</span>
                  <div className="format-selector-grid">
                    {['16:9', '1:1', '9:16', '4:3', 'custom'].map(format => (
                      <button
                        key={format}
                        onClick={() => handleChangeField('coverFormat', format)}
                        className={`format-option ${config.coverFormat === format ? 'active' : ''}`}
                      >
                        <div className="format-ratio-box" style={{ 
                          width: format === '16:9' ? '24px' : format === '1:1' ? '16px' : format === '9:16' ? '12px' : format === '4:3' ? '20px' : '16px',
                          height: format === '16:9' ? '14px' : format === '1:1' ? '16px' : format === '9:16' ? '20px' : format === '4:3' ? '15px' : '16px',
                          fontSize: '8px',
                          borderColor: config.coverFormat === format ? config.primaryColor : 'currentColor'
                        }}>
                          {format === 'custom' ? '?' : format}
                        </div>
                        <span>{getFormatLabel(format)}</span>
                      </button>
                    ))}
                  </div>

                  {config.coverFormat === 'custom' && (
                    <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                      <div className="slider-group" style={{ flex: 1 }}>
                        <label className="form-label" style={{ fontSize: '9px' }}>{t('labelCustomWidth')}</label>
                        <input 
                          type="number"
                          min="400"
                          max="1600"
                          value={config.customWidth || 1200}
                          onChange={(e) => handleChangeField('customWidth', parseInt(e.target.value) || 1200)}
                          style={{ background: 'rgba(0,0,0,0.5)', border: '1px solid #1e293b', padding: '4px 8px', borderRadius: '4px', width: '100%', color: '#fff', fontSize: '11px' }}
                        />
                      </div>
                      <div className="slider-group" style={{ flex: 1 }}>
                        <label className="form-label" style={{ fontSize: '9px' }}>{t('labelCustomHeight')}</label>
                        <input 
                          type="number"
                          min="300"
                          max="1600"
                          value={config.customHeight || 675}
                          onChange={(e) => handleChangeField('customHeight', parseInt(e.target.value) || 675)}
                          style={{ background: 'rgba(0,0,0,0.5)', border: '1px solid #1e293b', padding: '4px 8px', borderRadius: '4px', width: '100%', color: '#fff', fontSize: '11px' }}
                        />
                      </div>
                    </div>
                  )}
                </div>

                <hr className="divider" />

                {/* Templates presets */}
                <div>
                  <span className="section-title">{t('sectionPresets')}</span>
                  <div className="preset-grid">
                    {defaultTemplates.map((template) => {
                      const isActive = config.id === template.id;
                      // Determine gradient preview direction
                      const grad = template.id === 'fleet-ops' ? 'linear-gradient(90deg, #00f0ff, #005577)'
                                 : template.id === 'black-ops' ? 'linear-gradient(90deg, #ef4444, #7f1d1d)'
                                 : template.id === 'exploration' ? 'linear-gradient(90deg, #10b981, #065f46)'
                                 : 'linear-gradient(90deg, #f59e0b, #b45309)';
                      
                      return (
                        <button
                          key={template.id}
                          onClick={() => handleSelectPreset(template.id)}
                          className={`preset-card ${isActive ? 'active' : ''}`}
                        >
                          <div className="preset-card-preview" style={{ background: grad }} />
                          <span className="preset-card-title" style={{ color: template.primaryColor }}>
                            {template.name}
                          </span>
                          <span className="preset-card-desc">
                            {template.id === 'fleet-ops' && t('presetFleetOps')}
                            {template.id === 'black-ops' && t('presetBlackOps')}
                            {template.id === 'exploration' && t('presetExploration')}
                            {template.id === 'outlaw' && t('presetOutlaw')}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <hr className="divider" />

                {/* Colors customizer */}
                <div>
                  <span className="section-title">{t('sectionColors')}</span>
                  <div className="form-group">
                    <div className="form-row-between">
                      <label className="form-label">{t('labelPrimaryColor')}</label>
                      <div className="color-picker-wrapper">
                        <span className="color-hex-label">{config.primaryColor}</span>
                        <input 
                          type="color" 
                          value={config.primaryColor}
                          onChange={(e) => {
                            handleChangeField('primaryColor', e.target.value);
                            handleChangeField('glowColor', `${e.target.value}77`);
                          }}
                          className="color-input"
                        />
                      </div>
                    </div>

                    <div className="form-row-between">
                      <label className="form-label">{t('labelAccentColor')}</label>
                      <div className="color-picker-wrapper">
                        <span className="color-hex-label">{config.accentColor}</span>
                        <input 
                          type="color" 
                          value={config.accentColor}
                          onChange={(e) => handleChangeField('accentColor', e.target.value)}
                          className="color-input"
                        />
                      </div>
                    </div>
                  </div>
                </div>

                <hr className="divider" />

                {/* Font typography controls */}
                <div>
                  <span className="section-title">{t('sectionTypography')}</span>
                  <div className="form-group" style={{ gap: '12px' }}>
                    <div className="form-group" style={{ gap: '6px' }}>
                      <label className="form-label" style={{ fontSize: '10px', color: '#64748b' }}>{t('labelTitleFont')}</label>
                      <div className="font-grid">
                        {TITLE_FONTS.map(font => (
                          <button
                            key={font}
                            onClick={() => handleChangeField('fontTitle', font)}
                            className={`font-btn ${config.fontTitle === font ? 'active' : ''}`}
                            style={{ fontFamily: font === 'Courier Prime' ? "'Courier Prime', monospace" : `'${font}', sans-serif` }}
                          >
                            {font === 'Courier Prime' ? 'Courier' : font}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="form-group" style={{ gap: '6px' }}>
                      <label className="form-label" style={{ fontSize: '10px', color: '#64748b' }}>{t('labelBodyFont')}</label>
                      <div className="font-grid-2col">
                        {BODY_FONTS.map(font => (
                          <button
                            key={font}
                            onClick={() => handleChangeField('fontBody', font)}
                            className={`font-btn ${config.fontBody === font ? 'active' : ''}`}
                            style={{ fontFamily: font === 'Courier Prime' ? "'Courier Prime', monospace" : `'${font}', sans-serif` }}
                          >
                            {font === 'Share Tech Mono' ? 'Tech Mono' : font === 'Courier Prime' ? 'Courier' : font}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Text Size Sliders */}
                    <div className="slider-group">
                      <div className="slider-header">
                        <span>{t('labelTitleSize')}</span>
                        <span className="slider-value" style={{ color: config.primaryColor }}>{config.titleSize || 42}px</span>
                      </div>
                      <input 
                        type="range"
                        min="24"
                        max="80"
                        value={config.titleSize || 42}
                        onChange={(e) => handleChangeField('titleSize', parseInt(e.target.value))}
                        style={{ '--theme-color': config.primaryColor }}
                      />
                    </div>

                    <div className="slider-group">
                      <div className="slider-header">
                        <span>{t('labelSubtitleSize')}</span>
                        <span className="slider-value" style={{ color: config.primaryColor }}>{config.subtitleSize || 13}px</span>
                      </div>
                      <input 
                        type="range"
                        min="8"
                        max="24"
                        value={config.subtitleSize || 13}
                        onChange={(e) => handleChangeField('subtitleSize', parseInt(e.target.value))}
                        style={{ '--theme-color': config.primaryColor }}
                      />
                    </div>

                    <div className="form-group" style={{ gap: '6px' }}>
                      <label className="form-label" style={{ fontSize: '10px', color: '#64748b' }}>{t('labelTitleEffect')}</label>
                      <div className="grid-select-row" style={{ gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px' }}>
                        {[
                          { id: 'glow', name: t('effectGlow') },
                          { id: 'outline', name: t('effectOutline') },
                          { id: 'glitch', name: t('effectGlitch') },
                          { id: 'scanlines', name: t('effectScanlines') },
                          { id: 'stencil', name: t('effectStencil') }
                        ].map((effect) => {
                          const isActive = (config.titleEffect || 'glow') === effect.id;
                          return (
                            <button
                              key={effect.id}
                              onClick={() => handleChangeField('titleEffect', effect.id)}
                              className={`grid-select-btn ${isActive ? 'active' : ''}`}
                              style={{ 
                                fontSize: '10px', 
                                padding: '6px 2px',
                                ...(isActive ? {
                                  borderColor: config.primaryColor,
                                  color: config.primaryColor,
                                  backgroundColor: `${config.primaryColor}20`
                                } : {})
                              }}
                            >
                              {effect.name}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </div>

                <hr className="divider" />

                {/* Badges and Insignia */}
                <div>
                  <span className="section-title">{t('sectionInsignia')}</span>
                  <div className="form-group" style={{ gap: '12px' }}>
                    <button 
                      onClick={() => setShowLogoSelector(true)}
                      className="button-link-style"
                      style={{
                        borderColor: `${config.primaryColor}40`,
                        color: config.primaryColor,
                        backgroundColor: `${config.primaryColor}10`
                      }}
                    >
                      <span style={{ fontWeight: 'bold' }}>{t('labelEmblemSelect')}</span>
                      <span className="badge-indicator">
                        {config.logoType === 'custom' ? 'Custom PNG/SVG' : (LOGO_SVGS[config.logoType]?.name || BUILTIN_PNG_LOGOS[config.logoType]?.name || 'UEE Navy')}
                      </span>
                    </button>

                    <div className="form-group" style={{ gap: '6px' }}>
                      <label className="form-label" style={{ fontSize: '10px', color: '#64748b' }}>{t('labelEmblemPlacement')}</label>
                      <div className="grid-select-row">
                        {['left', 'right', 'both', 'none'].map(placement => (
                          <button
                            key={placement}
                            onClick={() => handleChangeField('logoPlacement', placement)}
                            className={`grid-select-btn ${config.logoPlacement === placement ? 'active' : ''}`}
                            style={config.logoPlacement === placement ? { 
                              borderColor: config.primaryColor, 
                              color: config.primaryColor, 
                              backgroundColor: `${config.primaryColor}20` 
                            } : {}}
                          >
                            {placement === 'left' && t('placementLeft')}
                            {placement === 'right' && t('placementRight')}
                            {placement === 'both' && t('placementBoth')}
                            {placement === 'none' && t('placementOff')}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                <hr className="divider" />

                {/* Community badges overlay */}
                <div>
                  <span className="section-title">{t('sectionCommunity')}</span>
                  <div className="form-group">
                    <div className="switch-control">
                      <span className="form-label">{t('labelCommunityBadge')}</span>
                      <button 
                        onClick={() => handleChangeField('showCommunityBadge', !config.showCommunityBadge)}
                        className={`switch-btn ${config.showCommunityBadge ? 'active' : ''}`}
                        style={config.showCommunityBadge ? { backgroundColor: config.primaryColor } : {}}
                      >
                        <div className="switch-thumb" />
                      </button>
                    </div>

                    <div className="switch-control">
                      <span className="form-label">{t('labelScBadge')}</span>
                      <button 
                        onClick={() => handleChangeField('showScBadge', !config.showScBadge)}
                        className={`switch-btn ${config.showScBadge ? 'active' : ''}`}
                        style={config.showScBadge ? { backgroundColor: config.primaryColor } : {}}
                      >
                        <div className="switch-thumb" />
                      </button>
                    </div>

                    {/* Badge Size Slider */}
                    {(config.showCommunityBadge || config.showScBadge) && (
                      <div className="slider-group" style={{ marginTop: '8px' }}>
                        <div className="slider-header">
                          <span>{t('badgeSize') || 'Badge-Größe'}</span>
                          <span className="slider-value" style={{ color: config.primaryColor }}>{config.badgeSize || 75}px</span>
                        </div>
                        <input 
                          type="range"
                          min="30"
                          max="200"
                          value={config.badgeSize || 75}
                          onChange={(e) => handleChangeField('badgeSize', parseInt(e.target.value))}
                          style={{ '--theme-color': config.primaryColor }}
                        />
                      </div>
                    )}
                  </div>
                </div>

                <hr className="divider" />

                {/* Preset library - local saved styles */}
                <div>
                  <span className="section-title">{t('presetLibraryTitle')}</span>
                  <div className="form-group" style={{ gap: '8px' }}>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <input 
                        type="text" 
                        placeholder={t('presetLibraryName')}
                        value={newPresetName}
                        onChange={(e) => setNewPresetName(e.target.value)}
                        style={{ flex: 1, background: 'rgba(0,0,0,0.5)', border: '1px solid #1e293b', padding: '6px 10px', borderRadius: '4px', color: '#fff', fontSize: '11px', fontFamily: 'var(--font-tech)' }}
                      />
                      <button 
                        onClick={handleSaveCustomPreset}
                        className="hud-btn"
                        style={{ padding: '6px 12px', gap: '4px', borderColor: `${config.primaryColor}50`, color: config.primaryColor }}
                      >
                        <Plus style={{ width: '14px', height: '14px' }} />
                        <span>HINZUFÜGEN</span>
                      </button>
                    </div>

                    {customPresets.length > 0 ? (
                      <div className="preset-library-grid" style={{ marginTop: '8px' }}>
                        {customPresets.map((preset) => (
                          <div key={preset.id} className="preset-library-item">
                            <div className="preset-library-item-name">{preset.name}</div>
                            <div className="preset-library-item-date">{preset.date}</div>
                            <div style={{ display: 'flex', gap: '4px', marginTop: '6px' }}>
                              <button 
                                onClick={() => handleLoadCustomPreset(preset)}
                                className="hud-btn" 
                                style={{ flex: 1, padding: '2px 4px', fontSize: '9px', borderColor: 'rgba(56, 189, 248, 0.4)', color: '#38bdf8' }}
                              >
                                {t('presetLibraryLoad')}
                              </button>
                              <button 
                                onClick={() => handleDeleteCustomPreset(preset.id)}
                                className="hud-btn" 
                                style={{ padding: '2px 6px', borderColor: 'rgba(239, 68, 68, 0.4)', color: '#ef4444' }}
                              >
                                <Trash2 style={{ width: '10px', height: '10px' }} />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p style={{ fontSize: '10px', color: '#64748b', textAlign: 'center', margin: '4px 0' }}>{t('presetLibraryEmpty')}</p>
                    )}
                  </div>
                </div>
              </>
            )}

            {/* TAB 2: BACKGROUND IMAGE CONTROLS */}
            {activeTab === 'bg' && (
              <>
                {/* Background image upload panel */}
                <div>
                  <span className="section-title">{t('sectionBgUpload')}</span>
                  <div className="form-group">
                    <input 
                      ref={fileInputRef}
                      type="file" 
                      accept="image/*"
                      onChange={handleBgUpload}
                      className="hidden"
                    />
                    
                    <button 
                      onClick={() => fileInputRef.current?.click()}
                      className="upload-btn"
                    >
                      <Upload style={{ width: '16px', height: '16px' }} />
                      <span>{t('labelUpload')}</span>
                    </button>

                    {bgImage && (
                      <button 
                        onClick={handleBgRemove}
                        className="upload-remove-text"
                      >
                        {t('labelRemoveImage')}
                      </button>
                    )}
                  </div>
                </div>

                <hr className="divider" />

                {/* Auto-fit selection */}
                <div>
                  <span className="section-title">{t('sectionAutoFit')}</span>
                  <div className="grid-select-row" style={{ gridTemplateColumns: 'repeat(3, 1fr)', marginBottom: '12px' }}>
                    {['cover', 'contain', 'custom'].map((mode) => (
                      <button
                        key={mode}
                        onClick={() => handleChangeField('autoFit', mode)}
                        className={`grid-select-btn ${config.autoFit === mode ? 'active' : ''}`}
                      >
                        {mode === 'cover' && t('fitCover')}
                        {mode === 'contain' && t('fitContain')}
                        {mode === 'custom' && t('fitManual')}
                      </button>
                    ))}
                  </div>
                </div>

                <hr className="divider" />

                {/* Crop settings & scaling */}
                <div>
                  <span className="section-title">{t('sectionPosition')}</span>
                  <div className="form-group" style={{ gap: '16px' }}>
                    {/* Scale */}
                    <div className="slider-group">
                      <div className="slider-header">
                        <span>{t('labelZoom')}</span>
                        <span className="slider-value" style={{ color: config.primaryColor, opacity: config.autoFit === 'custom' ? 1 : 0.4 }}>{config.bgScale || 100}%</span>
                      </div>
                      <input 
                        type="range"
                        min="100"
                        max="250"
                        value={config.bgScale || 100}
                        onChange={(e) => handleChangeField('bgScale', parseInt(e.target.value))}
                        disabled={config.autoFit !== 'custom'}
                        style={{ 
                          '--theme-color': config.primaryColor,
                          opacity: config.autoFit === 'custom' ? 1 : 0.3,
                          cursor: config.autoFit === 'custom' ? 'pointer' : 'not-allowed'
                        }}
                      />
                    </div>

                    {/* Position X */}
                    <div className="slider-group">
                      <div className="slider-header">
                        <span>{t('labelHorizontal')}</span>
                        <span className="slider-value" style={{ color: config.primaryColor }}>{config.bgPosX || 50}%</span>
                      </div>
                      <input 
                        type="range"
                        min="0"
                        max="100"
                        value={config.bgPosX || 50}
                        onChange={(e) => handleChangeField('bgPosX', parseInt(e.target.value))}
                        style={{ '--theme-color': config.primaryColor }}
                      />
                    </div>

                    {/* Position Y */}
                    <div className="slider-group">
                      <div className="slider-header">
                        <span>{t('labelVertical')}</span>
                        <span className="slider-value" style={{ color: config.primaryColor }}>{config.bgPosY || 50}%</span>
                      </div>
                      <input 
                        type="range"
                        min="0"
                        max="100"
                        value={config.bgPosY || 50}
                        onChange={(e) => handleChangeField('bgPosY', parseInt(e.target.value))}
                        style={{ '--theme-color': config.primaryColor }}
                      />
                    </div>
                  </div>
                </div>

                <hr className="divider" />

                {/* Filters, brightness, contrast */}
                <div>
                  <span className="section-title">{t('sectionImageAdjust')}</span>
                  <div className="form-group" style={{ gap: '16px' }}>
                    {/* Brightness */}
                    <div className="slider-group">
                      <div className="slider-header">
                        <span>{t('labelBrightness')}</span>
                        <span className="slider-value" style={{ color: config.primaryColor }}>{config.backgroundBrightness}%</span>
                      </div>
                      <input 
                        type="range"
                        min="20"
                        max="180"
                        value={config.backgroundBrightness}
                        onChange={(e) => handleChangeField('backgroundBrightness', parseInt(e.target.value))}
                        style={{ '--theme-color': config.primaryColor }}
                      />
                    </div>

                    {/* Contrast */}
                    <div className="slider-group">
                      <div className="slider-header">
                        <span>{t('labelContrast')}</span>
                        <span className="slider-value" style={{ color: config.primaryColor }}>{config.backgroundContrast}%</span>
                      </div>
                      <input 
                        type="range"
                        min="50"
                        max="180"
                        value={config.backgroundContrast}
                        onChange={(e) => handleChangeField('backgroundContrast', parseInt(e.target.value))}
                        style={{ '--theme-color': config.primaryColor }}
                      />
                    </div>

                    {/* Saturation */}
                    <div className="slider-group">
                      <div className="slider-header">
                        <span>{t('labelSaturation') || 'Sättigung'}</span>
                        <span className="slider-value" style={{ color: config.primaryColor }}>{config.backgroundSaturate}%</span>
                      </div>
                      <input 
                        type="range"
                        min="0"
                        max="180"
                        value={config.backgroundSaturate}
                        onChange={(e) => handleChangeField('backgroundSaturate', parseInt(e.target.value))}
                        style={{ '--theme-color': config.primaryColor }}
                      />
                    </div>

                    {/* Blur */}
                    <div className="slider-group">
                      <div className="slider-header">
                        <span>{t('labelBlur')}</span>
                        <span className="slider-value" style={{ color: config.primaryColor }}>{config.backgroundBlur}px</span>
                      </div>
                      <input 
                        type="range"
                        min="0"
                        max="15"
                        value={config.backgroundBlur}
                        onChange={(e) => handleChangeField('backgroundBlur', parseInt(e.target.value))}
                        style={{ '--theme-color': config.primaryColor }}
                      />
                    </div>

                    <hr className="divider" style={{ margin: '12px 0' }} />

                    {/* Color Filter presets (LUTs) */}
                    <div className="form-group" style={{ gap: '6px' }}>
                      <label className="form-label" style={{ fontSize: '10px', color: '#64748b' }}>{t('labelColorFilter')}</label>
                      <div className="grid-select-row" style={{ gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px' }}>
                        {['none', 'monochrome', 'nightvision', 'cyberpunk', 'thermal', 'coldspace', 'sepia', 'retrowave', 'bleach', 'duotone', 'hdr'].map((filterName) => (
                          <button
                            key={filterName}
                            onClick={() => handleChangeField('colorFilter', filterName)}
                            className={`grid-select-btn ${config.colorFilter === filterName ? 'active' : ''}`}
                            style={{ 
                              fontSize: '9px', 
                              padding: '6px 2px',
                              ...(config.colorFilter === filterName ? {
                                borderColor: config.primaryColor,
                                color: config.primaryColor,
                                backgroundColor: `${config.primaryColor}20`
                              } : {})
                            }}
                          >
                            {filterName === 'none' && t('filterNone')}
                            {filterName === 'monochrome' && t('filterMono')}
                            {filterName === 'nightvision' && t('filterNightvision')}
                            {filterName === 'cyberpunk' && t('filterCyberpunk')}
                            {filterName === 'thermal' && t('filterThermal')}
                            {filterName === 'coldspace' && t('filterColdspace')}
                            {filterName === 'sepia' && t('filterSepia')}
                            {filterName === 'retrowave' && t('filterRetrowave')}
                            {filterName === 'bleach' && t('filterBleach')}
                            {filterName === 'duotone' && t('filterDuotone')}
                            {filterName === 'hdr' && t('filterHDR')}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Focus Lens Depth of Field */}
                    <div className="slider-group">
                      <div className="slider-header">
                        <span>{t('labelFocusLens')}</span>
                        <span className="slider-value" style={{ color: config.primaryColor }}>{config.focusLensBlur || 0}px</span>
                      </div>
                      <input 
                        type="range"
                        min="0"
                        max="20"
                        value={config.focusLensBlur || 0}
                        onChange={(e) => handleChangeField('focusLensBlur', parseInt(e.target.value))}
                        style={{ '--theme-color': config.primaryColor }}
                        title="Zentrum scharf, Ränder radial verschwommen"
                      />
                    </div>
                  </div>
                </div>
              </>
            )}

            {/* TAB 3: VISUAL EFFECTS / HUD SYSTEM */}
            {activeTab === 'fx' && (
              <>
                {/* Tech Grids */}
                <div>
                  <span className="section-title">{t('sectionGrid')}</span>
                  <div className="grid-select-row" style={{ gridTemplateColumns: 'repeat(4, 1fr)', gap: '4px' }}>
                    {['dots', 'squares', 'halftone', 'none'].map((overlay) => (
                      <button
                        key={overlay}
                        onClick={() => handleChangeField('gridOverlay', overlay)}
                        className={`grid-select-btn ${config.gridOverlay === overlay ? 'active' : ''}`}
                        style={{
                          fontSize: '9px',
                          padding: '6px 2px',
                          ...(config.gridOverlay === overlay ? { 
                            borderColor: config.primaryColor, 
                            color: config.primaryColor, 
                            backgroundColor: `${config.primaryColor}20` 
                          } : {})
                        }}
                      >
                        {overlay === 'dots' && t('gridDots')}
                        {overlay === 'squares' && t('gridSquares')}
                        {overlay === 'halftone' && t('gridHalftone')}
                        {overlay === 'none' && t('gridNone')}
                      </button>
                    ))}
                  </div>
                </div>

                <hr className="divider" />

                {/* HUD Elements */}
                <div>
                  <span className="section-title">{t('sectionHudElements')}</span>
                  <div className="switch-control">
                    <span className="form-label">{t('labelCropMarks')}</span>
                    <button 
                      onClick={() => handleChangeField('cropMarks', !config.cropMarks)}
                      className={`switch-btn ${config.cropMarks ? 'active' : ''}`}
                      style={config.cropMarks ? { backgroundColor: config.primaryColor } : {}}
                    >
                      <div className="switch-thumb" />
                    </button>
                  </div>
                </div>

                <hr className="divider" />

                {/* HUD filters / scanlines */}
                <div>
                  <span className="section-title">{t('sectionHudFilters')}</span>
                  <div className="form-group" style={{ gap: '16px' }}>
                    {/* Scanlines */}
                    <div className="slider-group">
                      <div className="slider-header">
                        <span>{t('labelScanlines')}</span>
                        <span className="slider-value" style={{ color: config.primaryColor }}>{config.scanlinesIntensity}%</span>
                      </div>
                      <input 
                        type="range"
                        min="0"
                        max="100"
                        value={config.scanlinesIntensity}
                        onChange={(e) => handleChangeField('scanlinesIntensity', parseInt(e.target.value))}
                        style={{ '--theme-color': config.primaryColor }}
                      />
                    </div>

                    {/* Noise */}
                    <div className="slider-group">
                      <div className="slider-header">
                        <span>{t('labelNoise')}</span>
                        <span className="slider-value" style={{ color: config.primaryColor }}>{config.noiseIntensity}%</span>
                      </div>
                      <input 
                        type="range"
                        min="0"
                        max="100"
                        value={config.noiseIntensity}
                        onChange={(e) => handleChangeField('noiseIntensity', parseInt(e.target.value))}
                        style={{ '--theme-color': config.primaryColor }}
                      />
                    </div>

                    {/* Vignette */}
                    <div className="slider-group">
                      <div className="slider-header">
                        <span>{t('labelVignette')}</span>
                        <span className="slider-value" style={{ color: config.primaryColor }}>{config.vignetteIntensity}%</span>
                      </div>
                      <input 
                        type="range"
                        min="0"
                        max="100"
                        value={config.vignetteIntensity}
                        onChange={(e) => handleChangeField('vignetteIntensity', parseInt(e.target.value))}
                        style={{ '--theme-color': config.primaryColor }}
                      />
                    </div>

                    {/* Glitch Intensity */}
                    <div className="slider-group">
                      <div className="slider-header">
                        <span>{t('labelGlitch')}</span>
                        <span className="slider-value" style={{ color: config.primaryColor }}>{config.glitchIntensity}%</span>
                      </div>
                      <input 
                        type="range"
                        min="0"
                        max="100"
                        value={config.glitchIntensity}
                        onChange={(e) => handleChangeField('glitchIntensity', parseInt(e.target.value))}
                        style={{ '--theme-color': config.primaryColor }}
                      />
                    </div>

                    {/* Chromatic aberration */}
                    <div className="slider-group">
                      <div className="slider-header">
                        <span>{t('labelChromatic')}</span>
                        <span className="slider-value" style={{ color: config.primaryColor }}>{config.chromaticAberration}%</span>
                      </div>
                      <input 
                        type="range"
                        min="0"
                        max="100"
                        value={config.chromaticAberration}
                        onChange={(e) => handleChangeField('chromaticAberration', parseInt(e.target.value))}
                        style={{ '--theme-color': config.primaryColor }}
                      />
                    </div>
                  </div>
                </div>

                <hr className="divider" />

                {/* Gradient overlay controls */}
                <div>
                  <span className="section-title">{t('sectionGradient')}</span>
                  <div className="form-group" style={{ gap: '12px' }}>
                    <div className="switch-control">
                      <span className="form-label">{t('labelGradientEnable')}</span>
                      <button 
                        onClick={() => handleChangeField('gradientEnabled', !config.gradientEnabled)}
                        className={`switch-btn ${config.gradientEnabled ? 'active' : ''}`}
                        style={config.gradientEnabled ? { backgroundColor: config.primaryColor } : {}}
                      >
                        <div className="switch-thumb" />
                      </button>
                    </div>

                    {config.gradientEnabled && (
                      <>
                        <div className="form-row-between">
                          <label className="form-label">{t('labelGradientColor1')}</label>
                          <div className="color-picker-wrapper">
                            <span className="color-hex-label">{config.gradientColor1 || '#000000'}</span>
                            <input 
                              type="color" 
                              value={config.gradientColor1 || '#000000'}
                              onChange={(e) => handleChangeField('gradientColor1', e.target.value)}
                              className="color-input"
                            />
                          </div>
                        </div>

                        <div className="form-row-between">
                          <label className="form-label">{t('labelGradientColor2')}</label>
                          <div className="color-picker-wrapper">
                            <span className="color-hex-label">{config.gradientColor2 || '#00f0ff'}</span>
                            <input 
                              type="color" 
                              value={config.gradientColor2 || '#00f0ff'}
                              onChange={(e) => handleChangeField('gradientColor2', e.target.value)}
                              className="color-input"
                            />
                          </div>
                        </div>

                        <div className="slider-group">
                          <div className="slider-header">
                            <span>{t('labelGradientAngle')}</span>
                            <span className="slider-value" style={{ color: config.primaryColor }}>{config.gradientAngle ?? 135}°</span>
                          </div>
                          <input 
                            type="range"
                            min="0"
                            max="360"
                            value={config.gradientAngle ?? 135}
                            onChange={(e) => handleChangeField('gradientAngle', parseInt(e.target.value))}
                            style={{ '--theme-color': config.primaryColor }}
                          />
                        </div>

                        <div className="slider-group">
                          <div className="slider-header">
                            <span>{t('labelGradientOpacity')}</span>
                            <span className="slider-value" style={{ color: config.primaryColor }}>{config.gradientOpacity ?? 30}%</span>
                          </div>
                          <input 
                            type="range"
                            min="0"
                            max="100"
                            value={config.gradientOpacity ?? 30}
                            onChange={(e) => handleChangeField('gradientOpacity', parseInt(e.target.value))}
                            style={{ '--theme-color': config.primaryColor }}
                          />
                        </div>

                        <div className="form-group" style={{ gap: '4px' }}>
                          <label className="form-label" style={{ fontSize: '9px' }}>{t('labelGradientBlend')}</label>
                          <select
                            value={config.gradientBlend || 'overlay'}
                            onChange={(e) => handleChangeField('gradientBlend', e.target.value)}
                            style={{ background: 'rgba(0,0,0,0.5)', border: '1px solid #1e293b', padding: '6px 8px', borderRadius: '4px', color: '#fff', fontSize: '11px', width: '100%', fontFamily: 'var(--font-tech)' }}
                          >
                            {['overlay', 'multiply', 'screen', 'color-dodge', 'color', 'difference'].map(mode => (
                              <option key={mode} value={mode}>{mode}</option>
                            ))}
                          </select>
                        </div>
                      </>
                    )}
                  </div>
                </div>

                <hr className="divider" />

                {/* QR Code integration */}
                <div>
                  <span className="section-title">{t('sectionQrCode')}</span>
                  <div className="form-group" style={{ gap: '12px' }}>
                    <div className="switch-control">
                      <span className="form-label">{t('labelQrEnable')}</span>
                      <button 
                        onClick={() => handleChangeField('qrEnabled', !config.qrEnabled)}
                        className={`switch-btn ${config.qrEnabled ? 'active' : ''}`}
                        style={config.qrEnabled ? { backgroundColor: config.primaryColor } : {}}
                      >
                        <div className="switch-thumb" />
                      </button>
                    </div>

                    {config.qrEnabled && (
                      <div className="slider-group">
                        <label className="form-label" style={{ fontSize: '9px' }}>{t('labelQrUrl')}</label>
                        <input 
                          type="text"
                          value={config.qrUrl || ''}
                          onChange={(e) => handleChangeField('qrUrl', e.target.value)}
                          style={{ background: 'rgba(0,0,0,0.5)', border: '1px solid #1e293b', padding: '6px 10px', borderRadius: '4px', color: '#fff', fontSize: '11px', width: '100%', fontFamily: 'var(--font-tech)' }}
                        />
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}

            {/* TAB 4: LAYER MANAGEMENT */}
            {activeTab === 'layers' && (
              <>
                <div>
                  <span className="section-title">{t('sectionLayers')}</span>
                  <div className="layer-panel">
                    {[
                      { id: 'background', label: t('layerBackground') },
                      { id: 'header', label: t('layerHeader') },
                      { id: 'title', label: t('layerTitle') },
                      { id: 'objective', label: t('layerObjective') },
                      { id: 'logos', label: t('layerLogos') },
                      { id: 'qr', label: t('layerQr') },
                      { id: 'gradient', label: t('layerGradient') },
                      { id: 'effects', label: t('layerEffects') }
                    ].map(layer => {
                      const layerState = (config.layers && config.layers[layer.id]) || { visible: true, opacity: 100 };
                      const isVisible = layerState.visible !== false;
                      const opacity = layerState.opacity ?? 100;
                      
                      return (
                        <div key={layer.id} className={`layer-item ${isVisible ? 'active' : ''}`}>
                          <button
                            onClick={() => toggleLayerVisibility(layer.id)}
                            className={`layer-visibility-btn ${!isVisible ? 'hidden-layer' : ''}`}
                          >
                            {isVisible ? <Eye style={{ width: '14px', height: '14px' }} /> : <EyeOff style={{ width: '14px', height: '14px' }} />}
                          </button>
                          
                          <span className="layer-name">{layer.label}</span>
                          
                          <input 
                            type="range"
                            min="0"
                            max="100"
                            value={opacity}
                            onChange={(e) => changeLayerOpacity(layer.id, parseInt(e.target.value))}
                            className="layer-opacity-slider"
                            disabled={!isVisible}
                            style={{ 
                              '--theme-color': config.primaryColor,
                              opacity: isVisible ? 1 : 0.3
                            }}
                            title={t('labelOpacity')}
                          />
                          <span style={{ fontSize: '9px', width: '24px', textAlign: 'right', color: isVisible ? '#cbd5e1' : '#475569' }}>{opacity}%</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </>
            )}

          </div>

          {/* SIDEBAR FOOTER: EXPORT PANEL */}
          <div className="sidebar-footer">
            
            {/* Format choice png/jpg */}
            <div className="export-format-selector">
              <span style={{ fontWeight: 'bold', color: '#94a3b8', fontFamily: "var(--font-tech)" }}>{t('labelExportFormat')}</span>
              <div className="format-btn-group">
                <button
                  onClick={() => setExportFormat('png')}
                  className={`format-btn ${exportFormat === 'png' ? 'active' : ''}`}
                  style={exportFormat === 'png' ? { backgroundColor: config.primaryColor, color: '#030712', fontWeight: 'bold' } : {}}
                >
                  PNG
                </button>
                <button
                  onClick={() => setExportFormat('jpeg')}
                  className={`format-btn ${exportFormat === 'jpeg' ? 'active' : ''}`}
                  style={exportFormat === 'jpeg' ? { backgroundColor: config.primaryColor, color: '#030712', fontWeight: 'bold' } : {}}
                >
                  JPG
                </button>
              </div>
            </div>

            {/* Render & Save Trigger */}
            <button
              onClick={handleExportImage}
              disabled={isExporting || isExportingGif}
              className="export-btn"
              style={{
                background: isExporting 
                  ? '#334155' 
                  : `linear-gradient(90deg, ${config.primaryColor}, ${config.accentColor || config.primaryColor})`,
                color: isExporting ? '#64748b' : '#030712',
                borderColor: isExporting ? '#475569' : config.primaryColor,
                cursor: isExporting ? 'not-allowed' : 'pointer',
                boxShadow: isExporting ? 'none' : `0 4px 15px ${config.glowColor || 'rgba(56, 189, 248, 0.25)'}`
              }}
            >
              {isExporting ? (
                <>
                  <div style={{ width: '16px', height: '16px', border: '2px solid rgba(0,0,0,0.1)', borderTopColor: '#000', borderRadius: '50%', animation: 'warning-pulse 1s infinite' }} />
                  <span style={{ fontSize: '12px' }}>{t('exportingImage')}</span>
                </>
              ) : (
                <>
                  <Download style={{ width: '18px', height: '18px' }} />
                  <span>{t('exportImage')}</span>
                </>
              )}
            </button>

            {/* Glitch GIF Export */}
            <button
              onClick={handleExportGIF}
              disabled={isExporting || isExportingGif}
              className="gif-export-btn"
              style={{ marginTop: '8px' }}
            >
              {isExportingGif ? (
                <>
                  <div style={{ width: '16px', height: '16px', border: '2px solid rgba(168,85,247,0.2)', borderTopColor: '#a855f7', borderRadius: '50%', animation: 'warning-pulse 1s infinite' }} />
                  <span>{t('exportingGif')}</span>
                </>
              ) : (
                <>
                  <Film style={{ width: '16px', height: '16px' }} />
                  <span>{t('exportGif')}</span>
                </>
              )}
            </button>

            <div className="export-shortcut-hint">
              {t('shortcutHint')} <kbd>Strg + S</kbd>
            </div>

          </div>

        </aside>

      </div>

      {/* 3. POPUP MODALS: HERALDRY/LOGO SELECTOR */}
      {showLogoSelector && (
        <LogoSelector
          currentLogo={config.logoType}
          customLogoUrl={config.customLogoUrl}
          onSelectLogo={handleSelectLogo}
          onUploadCustomLogo={handleUploadCustomLogo}
          themeColor={config.primaryColor}
          onClose={() => setShowLogoSelector(false)}
        />
      )}

      {/* 4. KEYBOARD SHORTCUTS MODAL */}
      {showShortcutsModal && (
        <KeyboardShortcuts
          themeColor={config.primaryColor}
          onClose={() => setShowShortcutsModal(false)}
          t={t}
        />
      )}

    </div>
  );
}
