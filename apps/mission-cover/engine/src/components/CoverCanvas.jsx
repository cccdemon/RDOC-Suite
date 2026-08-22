import React, { useRef, useCallback, useState } from 'react';
import { LOGO_SVGS, BUILTIN_PNG_LOGOS } from '../data/defaultTemplates';
import QRCode from 'qrcode';

// Editable text wrapper - handles inline editing with blur-to-save
const EditableText = ({ text, onChange, className, style, placeholder = "Klicken zum Editieren", multiline = false }) => {
  return (
    <span
      contentEditable
      suppressContentEditableWarning
      className={`editable-text-field ${className || ''}`}
      style={{
        pointerEvents: 'auto',
        cursor: 'text',
        // A <span> collapses newlines, which turned the objective's ASSETS list
        // into one run-on paragraph. Multiline fields keep their breaks.
        ...(multiline ? { whiteSpace: 'pre-line' } : null),
        ...style
      }}
      onBlur={(e) => {
        const val = multiline ? e.target.innerText : e.target.innerText.trim();
        onChange(val || placeholder);
      }}
      onKeyDown={(e) => {
        if (!multiline && e.key === 'Enter') {
          e.preventDefault();
          e.target.blur();
        }
        if (multiline && e.key === 'Enter' && !e.shiftKey) {
          // Allow Shift+Enter or just Enter for multiline
        }
      }}
    >
      {text || placeholder}
    </span>
  );
};

// Draggable wrapper for text layers
const DraggableLayer = ({ children, x, y, onDrag, canvasRef, label, visible = true, opacity = 1 }) => {
  const handleDragStart = useCallback((e) => {
    if (e.target.contentEditable === 'true' && document.activeElement === e.target) return;
    e.preventDefault();
    
    const isTouch = e.type === 'touchstart';
    const clientX = isTouch ? e.touches[0].clientX : e.clientX;
    const clientY = isTouch ? e.touches[0].clientY : e.clientY;
    
    const rect = canvasRef.current.getBoundingClientRect();
    const scale = 1200 / rect.width;
    
    const startX = x;
    const startY = y;
    
    const el = e.currentTarget;
    el.classList.add('dragging');
    
    const handleDragMove = (moveEvent) => {
      const currentIsTouch = moveEvent.type === 'touchmove';
      const currentX = currentIsTouch ? moveEvent.touches[0].clientX : moveEvent.clientX;
      const currentY = currentIsTouch ? moveEvent.touches[0].clientY : moveEvent.clientY;
      
      const dx = (currentX - clientX) * scale;
      const dy = (currentY - clientY) * scale;
      
      let nextX = Math.round((startX + dx) / 10) * 10;
      let nextY = Math.round((startY + dy) / 10) * 10;
      
      nextX = Math.max(0, Math.min(1160, nextX));
      nextY = Math.max(0, Math.min(640, nextY));
      
      onDrag(nextX, nextY);
    };
    
    const handleDragEnd = () => {
      el.classList.remove('dragging');
      window.removeEventListener('mousemove', handleDragMove);
      window.removeEventListener('mouseup', handleDragEnd);
      window.removeEventListener('touchmove', handleDragMove);
      window.removeEventListener('touchend', handleDragEnd);
    };
    
    window.addEventListener('mousemove', handleDragMove);
    window.addEventListener('mouseup', handleDragEnd);
    window.addEventListener('touchmove', handleDragMove, { passive: true });
    window.addEventListener('touchend', handleDragEnd);
  }, [x, y, onDrag, canvasRef]);

  if (!visible) return null;

  return (
    <div
      className="draggable-text-layer"
      style={{
        left: `${(x / 1200) * 100}%`,
        top: `${(y / 675) * 100}%`,
        opacity,
        zIndex: 30
      }}
      onMouseDown={handleDragStart}
      onTouchStart={handleDragStart}
    >
      <div className="drag-handle">{label}</div>
      {children}
    </div>
  );
};


export default function CoverCanvas({
  config,
  onChangeField,
  onOpenLogoSelector,
  canvasRef,
  bgImage,
  canvasZoom = 1,
  layers = {}
}) {
  const {
    primaryColor,
    glowColor,
    backgroundColor,
    textColor,
    accentColor,
    fontTitle,
    fontBody,
    scanlinesIntensity,
    noiseIntensity,
    vignetteIntensity,
    glitchIntensity,
    chromaticAberration,
    gridOverlay,
    cropMarks,
    
    // Text fields
    dossierLabel,
    statusLabel,
    title,
    subtitle,
    tagline,
    objectiveTitle,
    objectiveText,
    location,
    dateTime,
    securityText,
    fileCode,
    logoType,
    logoPlacement,
    customLogoUrl,
    titleEffect = 'glow',

    // Additional badges toggles
    showCommunityBadge,
    showScBadge,
    logo1X,
    logo1Y,
    logo2X,
    logo2Y,

    // Badge size
    badgeSize = 75,

    // Auto-fit options
    autoFit = 'cover',

    // Additional filter properties
    colorFilter = 'none',
    focusLensBlur = 0,

    // Background Image adjustment variables
    backgroundBrightness,
    backgroundContrast,
    backgroundBlur,
    backgroundSaturate,
    bgScale = 100,
    bgPosX = 50,
    bgPosY = 50,

    // Text sizing
    titleSize = 42,
    subtitleSize = 13,

    // Draggable text positions
    titleBlockX = 40,
    titleBlockY = 340,
    headerBarX,
    headerBarY,
    objectiveBlockX,
    objectiveBlockY,

    // Gradient overlay
    gradientEnabled = false,
    gradientColor1 = '#000000',
    gradientColor2 = '#00f0ff',
    gradientAngle = 135,
    gradientOpacity = 30,
    gradientBlend = 'overlay',

    // QR Code
    qrEnabled = false,
    qrUrl = 'https://robertsspaceindustries.com',
    qrX = 1050,
    qrY = 530,

    // Duotone colors
    duotoneColor1 = '#00f0ff',
    duotoneColor2 = '#ff0066',

    // Cover format
    coverFormat = '16:9',
    customWidth = 1200,
    customHeight = 675
  } = config;

  const [qrDataUrl, setQrDataUrl] = useState(null);
  
  // Generate QR code when URL changes
  React.useEffect(() => {
    if (qrEnabled && qrUrl) {
      QRCode.toDataURL(qrUrl, {
        width: 120,
        margin: 1,
        color: { dark: '#000000', light: '#ffffff' }
      }).then(url => setQrDataUrl(url)).catch(() => setQrDataUrl(null));
    }
  }, [qrEnabled, qrUrl]);

  // Compute aspect ratio from format
  const getAspectRatio = () => {
    switch(coverFormat) {
      case '1:1': return '1/1';
      case '9:16': return '9/16';
      case '4:3': return '4/3';
      case 'custom': return `${customWidth}/${customHeight}`;
      default: return '16/9';
    }
  };

  const getCanvasWidth = () => {
    switch(coverFormat) {
      case '1:1': return 800;
      case '9:16': return 540;
      case '4:3': return 1000;
      case 'custom': return Math.min(customWidth, 1200);
      default: return 1200;
    }
  };

  // Handle wheel zoom events on the canvas
  React.useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;

    const handleWheel = (e) => {
      if (!bgImage) return;
      e.preventDefault();
      
      const zoomSpeed = 5;
      const delta = e.deltaY < 0 ? zoomSpeed : -zoomSpeed;
      const currentScale = bgScale || 100;
      const newScale = Math.min(250, Math.max(100, currentScale + delta));
      
      onChangeField('autoFit', 'custom');
      onChangeField('bgScale', newScale);
    };

    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      el.removeEventListener('wheel', handleWheel);
    };
  }, [bgImage, bgScale, autoFit, onChangeField, canvasRef]);

  // Handle drag and drop for community badges
  const handleBadgeDragStart = (e, logoId) => {
    e.preventDefault();
    const isTouch = e.type === 'touchstart';
    const clientX = isTouch ? e.touches[0].clientX : e.clientX;
    const clientY = isTouch ? e.touches[0].clientY : e.clientY;
    
    const rect = canvasRef.current.getBoundingClientRect();
    const scale = 1200 / rect.width;
    
    const startX = logoId === 1 ? (logo1X ?? 40) : (logo2X ?? 200);
    const startY = logoId === 1 ? (logo1Y ?? 90) : (logo2Y ?? 90);
    
    const handleDragMove = (moveEvent) => {
      const currentIsTouch = moveEvent.type === 'touchmove';
      const currentX = currentIsTouch ? moveEvent.touches[0].clientX : moveEvent.clientX;
      const currentY = currentIsTouch ? moveEvent.touches[0].clientY : moveEvent.clientY;
      
      const dx = (currentX - clientX) * scale;
      const dy = (currentY - clientY) * scale;
      
      let nextX = startX + dx;
      let nextY = startY + dy;
      
      // Snap to 20px grid
      nextX = Math.round(nextX / 20) * 20;
      nextY = Math.round(nextY / 20) * 20;
      
      // Boundaries (use dynamic badge size)
      const bSize = config.badgeSize || 75;
      nextX = Math.max(0, Math.min(1200 - bSize, nextX));
      nextY = Math.max(0, Math.min(675 - bSize, nextY));
      
      onChangeField(logoId === 1 ? 'logo1X' : 'logo2X', nextX);
      onChangeField(logoId === 1 ? 'logo1Y' : 'logo2Y', nextY);
    };
    
    const handleDragEnd = () => {
      window.removeEventListener('mousemove', handleDragMove);
      window.removeEventListener('mouseup', handleDragEnd);
      window.removeEventListener('touchmove', handleDragMove);
      window.removeEventListener('touchend', handleDragEnd);
    };
    
    window.addEventListener('mousemove', handleDragMove);
    window.addEventListener('mouseup', handleDragEnd);
    window.addEventListener('touchmove', handleDragMove, { passive: true });
    window.addEventListener('touchend', handleDragEnd);
  };

  // QR Code drag
  const handleQrDragStart = (e) => {
    e.preventDefault();
    const isTouch = e.type === 'touchstart';
    const clientX = isTouch ? e.touches[0].clientX : e.clientX;
    const clientY = isTouch ? e.touches[0].clientY : e.clientY;
    
    const rect = canvasRef.current.getBoundingClientRect();
    const scale = 1200 / rect.width;
    const startX = qrX ?? 1050;
    const startY = qrY ?? 530;
    
    const handleDragMove = (moveEvent) => {
      const cx = moveEvent.type === 'touchmove' ? moveEvent.touches[0].clientX : moveEvent.clientX;
      const cy = moveEvent.type === 'touchmove' ? moveEvent.touches[0].clientY : moveEvent.clientY;
      let nx = Math.round((startX + (cx - clientX) * scale) / 20) * 20;
      let ny = Math.round((startY + (cy - clientY) * scale) / 20) * 20;
      nx = Math.max(0, Math.min(1100, nx));
      ny = Math.max(0, Math.min(600, ny));
      onChangeField('qrX', nx);
      onChangeField('qrY', ny);
    };
    
    const handleDragEnd = () => {
      window.removeEventListener('mousemove', handleDragMove);
      window.removeEventListener('mouseup', handleDragEnd);
      window.removeEventListener('touchmove', handleDragMove);
      window.removeEventListener('touchend', handleDragEnd);
    };
    
    window.addEventListener('mousemove', handleDragMove);
    window.addEventListener('mouseup', handleDragEnd);
    window.addEventListener('touchmove', handleDragMove, { passive: true });
    window.addEventListener('touchend', handleDragEnd);
  };

  // Custom styling references with black outline drop-shadow for guaranteed readability
  const baseShadow = '1px 1px 1px #000, -1px -1px 1px #000, 1px -1px 1px #000, -1px 1px 1px #000, 0 2px 4px rgba(0, 0, 0, 0.95)';
  const themeGlowShadow = `1px 1px 1px #000, -1px -1px 1px #000, 1px -1px 1px #000, -1px 1px 1px #000, 0 2px 4px rgba(0,0,0,0.95), 0 0 8px ${glowColor}`;

  const getTitleStyle = () => {
    const base = {
      fontFamily: `'${fontTitle}', sans-serif`,
      color: primaryColor,
      letterSpacing: '0.05em',
      fontSize: `${titleSize}px`,
      fontWeight: '900',
      textTransform: 'uppercase',
      lineHeight: '1.1',
      marginTop: '4px',
      transition: 'all 0.2s ease'
    };

    if (titleEffect === 'outline') {
      return { ...base, color: 'transparent', WebkitTextStroke: `1.5px ${primaryColor}`, textShadow: `0 0 8px ${glowColor}` };
    } else if (titleEffect === 'glitch') {
      return { ...base, textShadow: `2px 0 0 #ef4444, -2px 0 0 #00f0ff, 0 0 10px ${glowColor}`, animation: 'text-glitch 1s infinite steps(2)' };
    } else if (titleEffect === 'scanlines') {
      return { ...base, background: `linear-gradient(rgba(0,0,0,0) 50%, rgba(255,255,255,0.15) 50%), ${primaryColor}`, backgroundSize: '100% 4px', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', textShadow: `0 0 6px ${glowColor}` };
    } else if (titleEffect === 'stencil') {
      return { ...base, WebkitMaskImage: 'repeating-linear-gradient(90deg, black 0px, black 30px, transparent 30px, transparent 33px)', maskImage: 'repeating-linear-gradient(90deg, black 0px, black 30px, transparent 30px, transparent 33px)', textShadow: `1px 1px 1px #000, -1px -1px 1px #000, 1px -1px 1px #000, -1px 1px 1px #000, 0 4px 6px rgba(0,0,0,0.95), 0 0 8px ${glowColor}` };
    } else {
      return { ...base, textShadow: `1px 1px 1px #000, -1px -1px 1px #000, 1px -1px 1px #000, -1px 1px 1px #000, 0 4px 6px rgba(0,0,0,0.95), 0 0 12px ${glowColor}` };
    }
  };

  const subTitleStyle = {
    fontFamily: `'${fontBody}', sans-serif`,
    color: accentColor,
    letterSpacing: '0.2em',
    textShadow: `1px 1px 1px #000, -1px -1px 1px #000, 1px -1px 1px #000, -1px 1px 1px #000, 0 2px 4px rgba(0,0,0,0.95), 0 0 5px ${glowColor}55`,
    fontSize: `${subtitleSize}px`,
    fontWeight: '600',
    textTransform: 'uppercase'
  };

  const bodyStyle = { fontFamily: `'${fontBody}', sans-serif`, textShadow: baseShadow };
  const genericTextStyle = { textShadow: baseShadow };
  const glowTextStyle = { textShadow: themeGlowShadow };

  // Build the color filter string
  let extraFilter = '';
  if (colorFilter === 'monochrome') extraFilter = 'grayscale(100%) contrast(120%)';
  else if (colorFilter === 'nightvision') extraFilter = 'grayscale(100%) brightness(1.2) sepia(1) saturate(5) hue-rotate(90deg)';
  else if (colorFilter === 'cyberpunk') extraFilter = 'grayscale(50%) sepia(0.5) hue-rotate(270deg) saturate(3)';
  else if (colorFilter === 'thermal') extraFilter = 'grayscale(80%) sepia(1) saturate(8) hue-rotate(340deg) contrast(1.3)';
  else if (colorFilter === 'coldspace') extraFilter = 'grayscale(30%) sepia(0.2) hue-rotate(180deg) saturate(1.5)';
  else if (colorFilter === 'sepia') extraFilter = 'sepia(80%) contrast(110%) brightness(95%)';
  else if (colorFilter === 'retrowave') extraFilter = 'contrast(130%) saturate(180%) hue-rotate(300deg) brightness(110%)';
  else if (colorFilter === 'bleach') extraFilter = 'contrast(150%) saturate(40%) brightness(110%)';
  else if (colorFilter === 'duotone') extraFilter = 'grayscale(100%) contrast(120%) brightness(110%)';
  else if (colorFilter === 'hdr') extraFilter = 'contrast(140%) saturate(150%) brightness(105%)';

  // Render SVG or PNG logo
  const renderLogo = (style = {}) => {
    if (logoType === 'custom' && customLogoUrl) {
      return <img src={customLogoUrl} alt="Custom Logo" style={{ width: '36px', height: '36px', objectFit: 'contain', cursor: 'pointer', ...style }} />;
    }
    if (logoType === 'community' || logoType === 'sc') {
      const logoUrl = logoType === 'community' ? BUILTIN_PNG_LOGOS.community.url : BUILTIN_PNG_LOGOS.sc.url;
      return <img src={logoUrl} alt="Badge" className="hud-badge-png" style={{ height: '32px', width: 'auto', objectFit: 'contain', cursor: 'pointer', ...style }} />;
    }
    const logo = LOGO_SVGS[logoType] || LOGO_SVGS.uee;
    return (
      <div 
        style={{ width: '36px', height: '36px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: primaryColor, cursor: 'pointer', ...style }}
        dangerouslySetInnerHTML={{ __html: `<svg viewBox="${logo.viewBox}" style="width: 100%; height: 100%; fill: none; stroke: currentColor; filter: drop-shadow(0 0 6px ${glowColor})">${logo.path}</svg>` }}
      />
    );
  };

  // Layer visibility helpers
  const isLayerVisible = (layerName) => {
    if (!layers || !layers[layerName]) return true;
    return layers[layerName].visible !== false;
  };
  const getLayerOpacity = (layerName) => {
    if (!layers || !layers[layerName]) return 1;
    return (layers[layerName].opacity ?? 100) / 100;
  };

  const canvasWidth = getCanvasWidth();

  return (
    <div style={{ position: 'relative', width: '100%', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div
        ref={canvasRef}
        id="mission-cover-canvas"
        style={{ 
          position: 'relative',
          width: '100%',
          aspectRatio: getAspectRatio(),
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
          overflow: 'hidden',
          border: '1px solid #1e293b',
          backgroundColor: '#040b14',
          maxWidth: `${canvasWidth}px`,
          fontFamily: "'Inter', sans-serif",
          '--theme-color': primaryColor,
          '--theme-glow': glowColor,
          transform: `scale(${canvasZoom})`,
          transformOrigin: 'center center',
          transition: 'transform 0.15s ease'
        }}
      >
        {/* Background Image Container */}
        {isLayerVisible('background') && (
          <div 
            style={{
              position: 'absolute', inset: 0, zIndex: 0,
              backgroundRepeat: 'no-repeat',
              backgroundImage: bgImage ? `url(${bgImage})` : 'none',
              backgroundPosition: `${bgPosX}% ${bgPosY}%`,
              backgroundSize: autoFit === 'cover' ? 'cover' : autoFit === 'contain' ? 'contain' : `${bgScale}%`,
              filter: `brightness(${backgroundBrightness}%) contrast(${backgroundContrast}%) blur(${backgroundBlur}px) saturate(${backgroundSaturate}%) ${extraFilter}`,
              transition: 'filter 0.15s ease',
              opacity: getLayerOpacity('background')
            }}
          >
            {!bgImage && (
              // Editor affordance: tells the user to load a background. The server
              // render hides it — an exported cover must not carry a hint that was
              // meant for the person editing it.
              <div data-editor-only="true" style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'rgba(56, 189, 248, 0.08)', fontFamily: "'Orbitron', sans-serif" }}>
                <svg viewBox="0 0 100 100" style={{ width: '192px', height: '192px', stroke: 'currentColor', fill: 'none', opacity: 0.2 }}>
                  <circle cx="50" cy="50" r="40" strokeWidth="1" strokeDasharray="4,8" />
                  <path d="M50,10 L50,90 M10,50 L90,50" strokeWidth="0.5" strokeDasharray="2,4" />
                  <circle cx="50" cy="50" r="10" strokeWidth="1.5" />
                </svg>
                <span style={{ fontSize: '11px', letterSpacing: '0.2em', textTransform: 'uppercase', marginTop: '16px' }}>Kein Hintergrundbild geladen</span>
              </div>
            )}
          </div>
        )}

        {/* Duotone color overlay (only for duotone filter) */}
        {colorFilter === 'duotone' && (
          <div style={{
            position: 'absolute', inset: 0, zIndex: 1, pointerEvents: 'none',
            background: `linear-gradient(135deg, ${duotoneColor1}88, ${duotoneColor2}88)`,
            mixBlendMode: 'color'
          }} />
        )}

        {/* Focus Lens Depth of Field Blur Overlay */}
        {bgImage && focusLensBlur > 0 && (
          <div style={{
            position: 'absolute', inset: 0, zIndex: 1, pointerEvents: 'none',
            backdropFilter: `blur(${focusLensBlur}px)`,
            WebkitBackdropFilter: `blur(${focusLensBlur}px)`,
            maskImage: 'radial-gradient(circle, transparent 25%, black 80%)',
            WebkitMaskImage: 'radial-gradient(circle, transparent 25%, black 80%)'
          }} />
        )}

        {/* Dynamic theme color grade overlay */}
        <div style={{ position: 'absolute', inset: 0, zIndex: 2, pointerEvents: 'none', mixBlendMode: 'color', background: `linear-gradient(135deg, ${primaryColor}15, transparent 60%)` }} />

        {/* Gradient Overlay */}
        {gradientEnabled && isLayerVisible('gradient') && (
          <div style={{
            position: 'absolute', inset: 0, zIndex: 3, pointerEvents: 'none',
            background: `linear-gradient(${gradientAngle}deg, ${gradientColor1}, ${gradientColor2})`,
            opacity: gradientOpacity / 100,
            mixBlendMode: gradientBlend,
          }} />
        )}

        {/* Ambient Dark Gradient vignette overlay */}
        <div style={{ position: 'absolute', inset: 0, zIndex: 4, pointerEvents: 'none', background: `radial-gradient(circle, transparent 20%, rgba(3, 7, 18, ${vignetteIntensity / 100}) 100%)` }} />

        {/* Scanlines Effect */}
        {isLayerVisible('effects') && (
          <>
            <div className="scanlines-overlay" style={{ opacity: (scanlinesIntensity / 100) * getLayerOpacity('effects'), pointerEvents: 'none' }} />
            <div className="noise-overlay" style={{ opacity: (noiseIntensity / 100) * getLayerOpacity('effects'), pointerEvents: 'none' }} />
          </>
        )}

        {/* Chromatic aberration & Glitch */}
        {isLayerVisible('effects') && (
          <div style={{
            position: 'absolute', inset: 0, zIndex: 5, pointerEvents: 'none',
            opacity: getLayerOpacity('effects'),
            boxShadow: glitchIntensity > 20 ? `inset 0 0 40px rgba(255, 0, 0, ${glitchIntensity / 250}), inset 0 0 10px rgba(0, 255, 255, ${glitchIntensity / 250})` : 'none',
            filter: chromaticAberration > 10 ? `contrast(1.05) drop-shadow(1px 0px 0px rgba(255,0,0,${chromaticAberration/150})) drop-shadow(-1px 0px 0px rgba(0,255,255,${chromaticAberration/150}))` : 'none'
          }} />
        )}

        {/* Tech Grid Overlays */}
        {gridOverlay === 'dots' && <div className="grid-overlay-dots" style={{ pointerEvents: 'none' }} />}
        {gridOverlay === 'squares' && <div className="grid-overlay-squares" style={{ pointerEvents: 'none' }} />}
        {gridOverlay === 'halftone' && <div className="grid-overlay-halftone" style={{ pointerEvents: 'none' }} />}

        {/* TECHNICAL CORNER CROP MARKS */}
        {cropMarks && (
          <>
            <div className="corner-bracket bracket-top-left" style={{ pointerEvents: 'none' }} />
            <div className="corner-bracket bracket-top-right" style={{ pointerEvents: 'none' }} />
            <div className="corner-bracket bracket-bottom-left" style={{ pointerEvents: 'none' }} />
            <div className="corner-bracket bracket-bottom-right" style={{ pointerEvents: 'none' }} />
          </>
        )}

        {/* Draggable Logo 1 (Community Badge) */}
        {showCommunityBadge && isLayerVisible('logos') && (
          <div
            style={{
              position: 'absolute',
              left: `${((logo1X ?? 40) / 1200) * 100}%`,
              // 90 put the badge across the "MISSION DOSSIER" line.
              top: `${((logo1Y ?? 150) / 675) * 100}%`,
              // Width from the 1200px reference, height from the width: taking
              // height from the 675px reference made the badge a 34x106 sliver
              // on a 9:16 canvas.
              width: `${(badgeSize / 1200) * 100}%`,
              aspectRatio: '1 / 1',
              zIndex: 35, cursor: 'move', userSelect: 'none', pointerEvents: 'auto',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              // The dashed frame and the dark backdrop mark the drag target in the
              // editor; the export strips them (see data-badge-frame in render.ts).
              border: '1px dashed rgba(255, 255, 255, 0.25)',
              backgroundColor: 'rgba(0, 0, 0, 0.35)',
              backdropFilter: 'blur(2px)', borderRadius: '4px', padding: '12px',
              boxShadow: '0 4px 10px rgba(0,0,0,0.5)',
              opacity: getLayerOpacity('logos')
            }}
            data-badge-frame="true"
            onMouseDown={(e) => handleBadgeDragStart(e, 1)}
            onTouchStart={(e) => handleBadgeDragStart(e, 1)}
            title="Community Badge - Ziehen zum Verschieben (20px Snap)"
          >
            <img src={BUILTIN_PNG_LOGOS.community.url} alt="Made by the Community" style={{ width: '100%', height: '100%', objectFit: 'contain', pointerEvents: 'none' }} />
          </div>
        )}

        {/* Draggable Logo 2 (Star Citizen Logo) */}
        {showScBadge && isLayerVisible('logos') && (
          <div
            style={{
              position: 'absolute',
              left: `${((logo2X ?? 140) / 1200) * 100}%`,
              top: `${((logo2Y ?? 150) / 675) * 100}%`,
              // Width from the 1200px reference, height from the width: taking
              // height from the 675px reference made the badge a 34x106 sliver
              // on a 9:16 canvas.
              width: `${(badgeSize / 1200) * 100}%`,
              aspectRatio: '1 / 1',
              zIndex: 35, cursor: 'move', userSelect: 'none', pointerEvents: 'auto',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              // The dashed frame and the dark backdrop mark the drag target in the
              // editor; the export strips them (see data-badge-frame in render.ts).
              border: '1px dashed rgba(255, 255, 255, 0.25)',
              backgroundColor: 'rgba(0, 0, 0, 0.35)',
              backdropFilter: 'blur(2px)', borderRadius: '4px', padding: '12px',
              boxShadow: '0 4px 10px rgba(0,0,0,0.5)',
              opacity: getLayerOpacity('logos')
            }}
            data-badge-frame="true"
            onMouseDown={(e) => handleBadgeDragStart(e, 2)}
            onTouchStart={(e) => handleBadgeDragStart(e, 2)}
            title="Star Citizen Logo - Ziehen zum Verschieben (20px Snap)"
          >
            <img src={BUILTIN_PNG_LOGOS.sc.url} alt="Star Citizen Logo" style={{ width: '100%', height: '100%', objectFit: 'contain', pointerEvents: 'none' }} />
          </div>
        )}

        {/* QR Code Overlay */}
        {qrEnabled && qrDataUrl && isLayerVisible('qr') && (
          <div
            className="qr-code-overlay"
            style={{
              left: `${((qrX ?? 1050) / 1200) * 100}%`,
              top: `${((qrY ?? 530) / 675) * 100}%`,
              zIndex: 36,
              opacity: getLayerOpacity('qr')
            }}
            onMouseDown={handleQrDragStart}
            onTouchStart={handleQrDragStart}
            title="QR-Code - Ziehen zum Verschieben"
          >
            <img src={qrDataUrl} alt="QR Code" style={{ width: '80px', height: '80px', display: 'block' }} />
          </div>
        )}

        {/* ================= HUD CONTENT INTERFACES ================= */}
        <div style={{ position: 'absolute', inset: 0, zIndex: 25, padding: '40px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', pointerEvents: 'none' }}>
          
          {/* HEADER BAR */}
          {isLayerVisible('header') && (
            <div className="canvas-header-bar pointer-events-auto" style={{ pointerEvents: 'auto', opacity: getLayerOpacity('header') }}>
              
              {/* Top Left: Logo & Dossier Label */}
              <div className="flex-row-center" style={{ gap: '12px', pointerEvents: 'auto' }}>
                {(logoPlacement === 'left' || logoPlacement === 'both') && (
                  <div onClick={onOpenLogoSelector} style={{ pointerEvents: 'auto', display: 'flex', alignItems: 'center' }}>
                    {renderLogo({ filter: `drop-shadow(0 0 6px ${glowColor})` })}
                  </div>
                )}
                <div className="flex-col-start" style={{ pointerEvents: 'auto' }}>
                  <EditableText
                    text={dossierLabel}
                    onChange={(val) => onChangeField('dossierLabel', val)}
                    className="editable-text-field"
                    style={{ fontFamily: "'Orbitron', sans-serif", fontSize: '10px', letterSpacing: '0.25em', fontWeight: '700', textTransform: 'uppercase', color: '#e2e8f0', ...glowTextStyle }}
                  />
                </div>
              </div>

              {/* Top Right: Status Badge & Location Metadata */}
              <div className="flex-col-end" style={{ gap: '4px', textAlign: 'right', pointerEvents: 'auto' }}>
                <div className="badge-outline pointer-events-auto" style={{ borderColor: `${primaryColor}44`, color: primaryColor, boxShadow: `0 0 8px ${glowColor}22`, fontFamily: "'Orbitron', sans-serif", fontSize: '9px', letterSpacing: '0.15em', fontWeight: 'bold', textTransform: 'uppercase', pointerEvents: 'auto' }}>
                  <span className="hud-pulse" style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: 'currentColor', display: 'inline-block' }}></span>
                  <EditableText text={statusLabel} onChange={(val) => onChangeField('statusLabel', val)} />
                </div>
                <div className="flex-col-end" style={{ gap: '2px', marginTop: '6px', pointerEvents: 'auto' }}>
                  <EditableText text={location} onChange={(val) => onChangeField('location', val)} style={{ fontFamily: `'${fontBody}', sans-serif`, fontSize: '9px', letterSpacing: '0.15em', textTransform: 'uppercase', color: '#cbd5e1', ...genericTextStyle }} />
                  <EditableText text={dateTime} onChange={(val) => onChangeField('dateTime', val)} style={{ fontFamily: `'${fontBody}', sans-serif`, fontSize: '9px', letterSpacing: '0.15em', textTransform: 'uppercase', color: '#cbd5e1', ...genericTextStyle }} />
                </div>
              </div>
            </div>
          )}

          {/* MAIN CENTER/BOTTOM CONTENT */}
          <div className="canvas-footer-row" style={{ pointerEvents: 'auto' }}>
            
            {/* Bottom Left Panel: Mission Title & Objectives */}
            <div className="flex-col-start" style={{ maxWidth: '58%', gap: '16px', pointerEvents: 'auto' }}>
              
              {/* Title Section */}
              {isLayerVisible('title') && (
                <div className="flex-col-start" style={{ gap: '2px', pointerEvents: 'auto', opacity: getLayerOpacity('title') }}>
                  <EditableText text={subtitle} onChange={(val) => onChangeField('subtitle', val)} style={subTitleStyle} />
                  <EditableText text={title} onChange={(val) => onChangeField('title', val)} className="glitch-text" style={getTitleStyle()} />
                  <div className="flex-row-center" style={{ gap: '8px', marginTop: '6px', fontFamily: `'${fontBody}', sans-serif`, fontSize: '11px', letterSpacing: '0.15em', fontWeight: 'bold', textTransform: 'uppercase', color: '#cbd5e1' }}>
                    <div style={{ width: '32px', height: '1px', backgroundColor: primaryColor }} />
                    <EditableText text={tagline} onChange={(val) => onChangeField('tagline', val)} style={genericTextStyle} />
                  </div>
                </div>
              )}

              {/* Mission Goal Box */}
              {isLayerVisible('objective') && (
                <div className="hud-objective-container pointer-events-auto" style={{ borderColor: `${primaryColor}22`, boxShadow: `inset 0 0 10px ${glowColor}0A, 0 4px 20px rgba(0,0,0,0.8)`, pointerEvents: 'auto', opacity: getLayerOpacity('objective') }}>
                  <div className="hud-reticle-box" style={{ borderColor: `${primaryColor}30`, color: primaryColor }}>
                    <svg viewBox="0 0 24 24" style={{ width: '20px', height: '20px', stroke: 'currentColor', fill: 'none' }}>
                      <circle cx="12" cy="12" r="8" strokeWidth="1" strokeDasharray="2,2" />
                      <circle cx="12" cy="12" r="3" fill="currentColor" className="hud-pulse" />
                      <line x1="12" y1="2" x2="12" y2="6" strokeWidth="1.5" />
                      <line x1="12" y1="18" x2="12" y2="22" strokeWidth="1.5" />
                      <line x1="2" y1="12" x2="6" y2="12" strokeWidth="1.5" />
                      <line x1="18" y1="12" x2="22" y2="12" strokeWidth="1.5" />
                    </svg>
                  </div>
                  <div className="flex-col-start" style={{ pointerEvents: 'auto' }}>
                    <EditableText text={objectiveTitle} onChange={(val) => onChangeField('objectiveTitle', val)} style={{ fontFamily: "'Orbitron', sans-serif", fontSize: '9px', letterSpacing: '0.15em', fontWeight: '900', textTransform: 'uppercase', color: accentColor, marginBottom: '2px', ...glowTextStyle }} />
                    <EditableText
                      text={objectiveText}
                      onChange={(val) => onChangeField('objectiveText', val)}
                      multiline={true}
                      style={{ fontSize: '11px', lineHeight: '1.4', color: '#f3f4f6', fontFamily: `'${fontBody}', sans-serif`, ...genericTextStyle }}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Bottom Right Panel: Security Classification Footer */}
            <div className="flex-col-end" style={{ maxWidth: '38%', gap: '8px', textAlign: 'right', pointerEvents: 'auto' }}>
              <div className="flex-row-center" style={{ gap: '12px', pointerEvents: 'auto' }}>
                <div className="flex-col-end" style={{ gap: '2px', pointerEvents: 'auto' }}>
                  <EditableText text={securityText} onChange={(val) => onChangeField('securityText', val)} style={{ fontFamily: "'Orbitron', sans-serif", fontSize: '9px', letterSpacing: '0.15em', fontWeight: 'bold', textTransform: 'uppercase', color: '#cbd5e1', ...genericTextStyle }} />
                  <EditableText text={fileCode} onChange={(val) => onChangeField('fileCode', val)} style={{ fontFamily: `'${fontBody}', sans-serif`, fontSize: '9px', letterSpacing: '0.15em', textTransform: 'uppercase', color: '#cbd5e1', ...genericTextStyle }} />
                </div>
                {(logoPlacement === 'right' || logoPlacement === 'both') && (
                  <div onClick={onOpenLogoSelector} style={{ pointerEvents: 'auto', display: 'flex', alignItems: 'center' }}>
                    {renderLogo({ filter: `drop-shadow(0 0 6px ${glowColor})` })}
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', gap: '3px', alignItems: 'center' }}>
                <span style={{ width: '6px', height: '4px', backgroundColor: primaryColor, opacity: 0.8 }}></span>
                <span style={{ width: '12px', height: '4px', backgroundColor: primaryColor, opacity: 0.6 }}></span>
                <span style={{ width: '24px', height: '4px', backgroundColor: primaryColor, opacity: 0.3 }}></span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
