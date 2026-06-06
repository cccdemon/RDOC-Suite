import React, { useRef } from 'react';
import { LOGO_SVGS, BUILTIN_PNG_LOGOS } from '../data/defaultTemplates';
import { Upload, X, Check } from 'lucide-react';

export default function LogoSelector({
  currentLogo,
  customLogoUrl,
  onSelectLogo,
  onUploadCustomLogo,
  themeColor,
  onClose
}) {
  const fileInputRef = useRef(null);

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        onUploadCustomLogo(event.target.result);
        onSelectLogo('custom');
      };
      reader.readAsDataURL(file);
    }
  };

  const removeCustomLogo = (e) => {
    e.stopPropagation();
    onUploadCustomLogo(null);
    if (currentLogo === 'custom') {
      onSelectLogo('uee');
    }
  };

  return (
    <div className="modal-overlay">
      <div 
        className="modal-card"
        style={{ '--theme-color': themeColor }}
      >
        {/* Header */}
        <div className="modal-header">
          <span className="modal-title">
            HERALDRY & INSIGNIA SELECTOR
          </span>
          <button 
            onClick={onClose}
            className="modal-close-btn"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="modal-body">
          {/* Custom Logo Upload */}
          <div>
            <span className="section-title">
              CUSTOM LOGO (PNG/SVG)
            </span>
            
            <div 
              onClick={() => fileInputRef.current?.click()}
              className={`logo-uploader-card ${currentLogo === 'custom' ? 'active' : ''}`}
              style={currentLogo === 'custom' ? { borderColor: themeColor, backgroundColor: `${themeColor}10`, color: '#ffffff' } : {}}
            >
              <input 
                ref={fileInputRef}
                type="file" 
                accept="image/png, image/jpeg, image/svg+xml"
                onChange={handleFileChange}
                className="hidden"
              />

              {customLogoUrl ? (
                <div className="logo-preview-box">
                  <img 
                    src={customLogoUrl} 
                    alt="Custom upload preview" 
                    className="logo-preview-img"
                    style={{ filter: `drop-shadow(0 0 6px ${themeColor})` }}
                  />
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '12px', color: '#10b981', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <Check style={{ width: '12px', height: '12px' }} /> Custom Logo Aktiv
                    </span>
                    <button 
                      onClick={removeCustomLogo}
                      style={{
                        padding: '2px 8px',
                        fontSize: '10px',
                        backgroundColor: 'rgba(127, 29, 29, 0.8)',
                        border: '1px solid rgba(239, 68, 68, 0.5)',
                        color: '#fca5a5',
                        borderRadius: '3px',
                        cursor: 'pointer'
                      }}
                    >
                      ENTFERNEN
                    </button>
                  </div>
                </div>
              ) : (
                <div className="logo-uploader-prompt">
                  <Upload style={{ width: '32px', height: '32px', color: themeColor }} />
                  <h3>Eigenes Abzeichen hochladen</h3>
                  <p>Unterstützt transparente PNG, SVG oder JPEG</p>
                </div>
              )}
            </div>
          </div>

          {/* Preset Logos */}
          <div>
            <span className="section-title">
              FRAKTIONEN & HERSTELLER PRESETS
            </span>
            
            <div className="logo-grid">
              {Object.entries(LOGO_SVGS).map(([key, logo]) => {
                const isActive = currentLogo === key;
                return (
                  <button
                    key={key}
                    onClick={() => onSelectLogo(key)}
                    className={`logo-grid-card ${isActive ? 'active' : ''}`}
                    style={isActive ? { borderColor: themeColor, backgroundColor: `${themeColor}20`, color: '#ffffff' } : {}}
                  >
                    <div 
                      className="logo-grid-card-svg"
                      style={{ color: isActive ? themeColor : 'rgba(255,255,255,0.7)' }}
                      dangerouslySetInnerHTML={{ __html: `
                        <svg viewBox="${logo.viewBox}" style="width: 40px; height: 40px; fill: none; stroke: currentColor;">
                          ${logo.path}
                        </svg>
                      `}}
                    />
                    <span className="logo-grid-card-title">
                      {logo.name}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Community Badges */}
          <div>
            <span className="section-title">
              COMMUNITY & GAME BADGES
            </span>
            
            <div className="logo-grid">
              {Object.entries(BUILTIN_PNG_LOGOS).map(([key, logo]) => {
                const isActive = currentLogo === key;
                return (
                  <button
                    key={key}
                    onClick={() => onSelectLogo(key)}
                    className={`logo-grid-card ${isActive ? 'active' : ''}`}
                    style={isActive ? { borderColor: themeColor, backgroundColor: `${themeColor}20`, color: '#ffffff' } : {}}
                  >
                    <img 
                      src={logo.url} 
                      alt={logo.name} 
                      className="logo-grid-card-svg hud-badge-png" 
                      style={{ 
                        maxHeight: '36px', 
                        maxWidth: '36px', 
                        objectFit: 'contain',
                        marginBottom: '8px'
                      }} 
                    />
                    <span className="logo-grid-card-title">
                      {logo.name}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

        </div>

        {/* Footer */}
        <div className="modal-footer">
          <button 
            onClick={onClose}
            className="font-btn"
            style={{ 
              padding: '8px 16px',
              borderColor: `${themeColor}40`,
              color: themeColor,
              backgroundColor: `${themeColor}10`
            }}
          >
            SCHLIESSEN
          </button>
        </div>
      </div>
    </div>
  );
}
