// Inline SVG sprite — identical glyphs to the design bundle / SSR mission board
// (24×24, stroke=currentColor, 1.6–1.7px, round caps). Mount <IconSprite/> once.
export function IconSprite() {
  return (
    <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true">
      <defs>
        <symbol id="i-ship" viewBox="0 0 24 24"><path d="M12 3c1.6 1.4 2.6 3.8 2.8 7.2l3.7 2.6-.2 2.2-3.8-1.3c-.3 2.4-1.2 4-2.5 4s-2.2-1.6-2.5-4l-3.8 1.3-.2-2.2 3.7-2.6C9.4 6.8 10.4 4.4 12 3z" /></symbol>
        <symbol id="i-fighter" viewBox="0 0 24 24"><path d="M12 3l8 15-8-3.4L4 18z" /></symbol>
        <symbol id="i-fps" viewBox="0 0 24 24"><circle cx="12" cy="7" r="2.6" /><path d="M5.5 20c0-3.6 2.9-5.8 6.5-5.8s6.5 2.2 6.5 5.8" /></symbol>
        <symbol id="i-pilot" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3" /><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1" /></symbol>
        <symbol id="i-gunner" viewBox="0 0 24 24"><circle cx="12" cy="12" r="7" /><path d="M12 2v4M12 18v4M2 12h4M18 12h4" /></symbol>
        <symbol id="i-users" viewBox="0 0 24 24"><circle cx="9" cy="8" r="3" /><path d="M3.5 19c0-3 2.4-4.8 5.5-4.8s5.5 1.8 5.5 4.8M16 5.2a3 3 0 0 1 0 5.6M21 19c0-2.4-1.6-4-3.8-4.6" /></symbol>
        <symbol id="i-pin" viewBox="0 0 24 24"><path d="M12 21s7-5.6 7-11a7 7 0 1 0-14 0c0 5.4 7 11 7 11z" /><circle cx="12" cy="10" r="2.4" /></symbol>
        <symbol id="i-globe" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5" /><path d="M3.5 12h17M12 3.5c2.5 2.5 2.5 14 0 17M12 3.5c-2.5 2.5-2.5 14 0 17" /></symbol>
        <symbol id="i-clock" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5" /><path d="M12 7v5l3.5 2" /></symbol>
        <symbol id="i-mic" viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3" /></symbol>
        <symbol id="i-chat" viewBox="0 0 24 24"><path d="M4 5h16v11H9l-4 3v-3H4z" /></symbol>
        <symbol id="i-bolt" viewBox="0 0 24 24"><path d="M13 3L5 13h5l-1 8 9-11h-6z" /></symbol>
        <symbol id="i-check" viewBox="0 0 24 24"><path d="M5 12.5l4.2 4.2L19 7" /></symbol>
        <symbol id="i-alert" viewBox="0 0 24 24"><path d="M12 4l9 16H3z" /><path d="M12 10v4M12 17.4v.4" /></symbol>
        <symbol id="i-arrow" viewBox="0 0 24 24"><path d="M5 12h13M13 6l6 6-6 6" /></symbol>
        <symbol id="i-x" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" /></symbol>
        <symbol id="i-swap" viewBox="0 0 24 24"><path d="M5 9h13l-3.5-3.5M19 15H6l3.5 3.5" /></symbol>
        <symbol id="i-board" viewBox="0 0 24 24"><rect x="4" y="4" width="7" height="7" rx="1.5" /><rect x="13" y="4" width="7" height="7" rx="1.5" /><rect x="4" y="13" width="7" height="7" rx="1.5" /><rect x="13" y="13" width="7" height="7" rx="1.5" /></symbol>
        <symbol id="i-eye" viewBox="0 0 24 24"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" /><circle cx="12" cy="12" r="2.7" /></symbol>
        <symbol id="i-plus" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></symbol>
        <symbol id="i-vehicle" viewBox="0 0 24 24"><path d="M4 13l2.3-4.5h8.4L18 13" /><path d="M3 13h18v3.4H3z" /><circle cx="7.5" cy="17.4" r="2.1" /><circle cx="16.5" cy="17.4" r="2.1" /></symbol>
        <symbol id="i-lead" viewBox="0 0 24 24"><path d="M6 13l6-5 6 5M6 18l6-5 6 5" /></symbol>
        <symbol id="i-back" viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6" /></symbol>
        <symbol id="i-cal" viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="15.5" rx="2" /><path d="M3.5 9.5h17M8 3v4M16 3v4" /></symbol>
        <symbol id="i-server" viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="6.4" rx="1.6" /><rect x="4" y="13.6" width="16" height="6.4" rx="1.6" /><path d="M7.4 7.2h.01M7.4 16.8h.01" /></symbol>
        <symbol id="i-wrench" viewBox="0 0 24 24"><path d="M15.5 6.3a3.6 3.6 0 0 0-4.7 4.5L4 17.6 6.4 20l6.8-6.8a3.6 3.6 0 0 0 4.5-4.7l-2.3 2.3-2-.4-.4-2z" /></symbol>
        <symbol id="i-refresh" viewBox="0 0 24 24"><path d="M4 12a8 8 0 0 1 13.7-5.6M20 12a8 8 0 0 1-13.7 5.6" /><path d="M18 3.4V7h-3.6M6 20.6V17h3.6" /></symbol>
        <symbol id="i-shield" viewBox="0 0 24 24"><path d="M12 3l7 3v5c0 4.6-3 7.7-7 9-4-1.3-7-4.4-7-9V6z" /></symbol>
        <symbol id="i-ban" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.2" /><path d="M6.4 6.4l11.2 11.2" /></symbol>
        <symbol id="i-link" viewBox="0 0 24 24"><path d="M10 14a4 4 0 0 0 5.7 0l2.3-2.3a4 4 0 0 0-5.7-5.7L11 7.3M14 10a4 4 0 0 0-5.7 0L6 12.3a4 4 0 0 0 5.7 5.7L13 16.7" /></symbol>
        <symbol id="i-save" viewBox="0 0 24 24"><path d="M5 4h11l3 3v13H5z" /><path d="M8 4v5h7V4M8 20v-6h8v6" /></symbol>
        <symbol id="i-edit" viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16z" /><path d="M14 6l4 4" /></symbol>
        <symbol id="i-doc" viewBox="0 0 24 24"><path d="M6 3h8l4 4v14H6z" /><path d="M14 3v4h4M9 13h6M9 16h6" /></symbol>
        <symbol id="i-lock" viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></symbol>
        <symbol id="i-image" viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="14" rx="2" /><circle cx="8.5" cy="10" r="1.6" /><path d="M5 17l4.5-4 3 2.5L16 11l3.5 4" /></symbol>
        <symbol id="i-menu" viewBox="0 0 24 24"><path d="M4 7h16M4 12h16M4 17h16" /></symbol>
        <symbol id="i-copy" viewBox="0 0 24 24"><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h8" /></symbol>
        <symbol id="i-grip" viewBox="0 0 24 24"><circle cx="9" cy="6" r="1" /><circle cx="9" cy="12" r="1" /><circle cx="9" cy="18" r="1" /><circle cx="15" cy="6" r="1" /><circle cx="15" cy="12" r="1" /><circle cx="15" cy="18" r="1" /></symbol>
        <symbol id="i-stream" viewBox="0 0 24 24"><circle cx="12" cy="12" r="2" /><path d="M8.5 8.5a5 5 0 0 0 0 7M15.5 8.5a5 5 0 0 1 0 7M6 6a8.5 8.5 0 0 0 0 12M18 6a8.5 8.5 0 0 1 0 12" /></symbol>
      </defs>
    </svg>
  );
}

export function Ic({ name, size = 16, sw = 1.7 }: { name: string; size?: number; sw?: number }) {
  return (
    <svg width={size} height={size} fill="none" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <use href={`#i-${name}`} />
    </svg>
  );
}
