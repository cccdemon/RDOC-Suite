import React, { useEffect } from 'react';
import { X } from 'lucide-react';

export default function KeyboardShortcuts({ onClose, themeColor, t }) {
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const shortcuts = [
    { keys: ['Ctrl', 'Z'], desc: t('shortcutUndo') },
    { keys: ['Ctrl', 'Y'], desc: t('shortcutRedo') },
    { keys: ['Ctrl', 'S'], desc: t('shortcutSave') },
    { keys: ['Ctrl', 'E'], desc: t('shortcutJson') },
    { keys: ['R'], desc: t('shortcutShuffle') },
    { keys: ['1-4'], desc: t('shortcutPresets') },
    { keys: ['?'], desc: t('shortcutShortcuts') },
    { keys: ['Esc'], desc: t('shortcutClose') },
  ];

  return (
    <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-card" style={{ '--theme-color': themeColor, maxWidth: '420px' }}>
        <div className="modal-header">
          <span className="modal-title" style={{ color: themeColor }}>
            {t('shortcutsTitle')}
          </span>
          <button onClick={onClose} className="modal-close-btn">
            <X style={{ width: '20px', height: '20px' }} />
          </button>
        </div>
        <div className="modal-body" style={{ padding: '20px 24px' }}>
          <div className="shortcut-grid">
            {shortcuts.map((s, i) => (
              <React.Fragment key={i}>
                <div className="shortcut-key">
                  {s.keys.map((k, j) => (
                    <React.Fragment key={j}>
                      <kbd>{k}</kbd>
                      {j < s.keys.length - 1 && <span style={{ color: '#475569' }}>+</span>}
                    </React.Fragment>
                  ))}
                </div>
                <div className="shortcut-desc">{s.desc}</div>
              </React.Fragment>
            ))}
          </div>
        </div>
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
            {t('shortcutClose2')}
          </button>
        </div>
      </div>
    </div>
  );
}
