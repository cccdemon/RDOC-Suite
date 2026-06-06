import { promises as fs } from "node:fs";
import { getEnv } from "../config/env.js";
import type { EngineConfig } from "./prefill.js";

// Serve the MissionCover engine bundle as an EDITOR, prefilled and with a
// "Save to Op" bar wired back to the service. We inject two scripts into the
// built single-file HTML:
//   1) a synchronous <head> script that seeds the engine's localStorage BEFORE
//      its (deferred) app scripts run, so it hydrates into the op's cover;
//   2) a pre-</body> script that adds the save/cancel bar.
// No engine source change needed.

let _engineHtml: string | null = null;

async function engineHtml(): Promise<string> {
  if (_engineHtml === null) {
    _engineHtml = await fs.readFile(getEnv().ENGINE_HTML, "utf8");
  }
  return _engineHtml;
}

// JSON for inline <script> — neutralise </script> and HTML-significant chars.
function safeJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/>/g, "\\u003e");
}

export type EditorBootstrap = {
  config: EngineConfig;
  bg: string | null;
  saveUrl: string; // service endpoint the save bar POSTs to
  token: string; // capability token, echoed on save
  returnUrl: string; // save callback (service appends ?ct=)
  cancelUrl: string; // where "Abbrechen" navigates (cover page)
  opTitle: string;
};

export async function buildEditorHtml(boot: EditorBootstrap): Promise<string> {
  const html = await engineHtml();

  // Seed via window globals (not localStorage) so large uploaded images survive
  // — the engine reads __MC_CONFIG__/__MC_BG__ on init.
  const seed = `<script>(function(){
    window.__MC_CONFIG__ = ${safeJson(boot.config)};
    window.__MC_BG__ = ${boot.bg ? safeJson(boot.bg) : "null"};
    try{ localStorage.setItem('star-citizen-cover-generator-lang','de'); }catch(e){}
  })();</script>`;

  const bar = `<script>(function(){
    var BOOT=${safeJson({ saveUrl: boot.saveUrl, token: boot.token, returnUrl: boot.returnUrl, cancelUrl: boot.cancelUrl, opTitle: boot.opTitle })};
    var BAR_H=56;
    function el(t,p){var e=document.createElement(t);Object.assign(e,p||{});return e;}
    window.addEventListener('load',function(){
      var bar=el('div');bar.style.cssText='position:fixed;left:0;right:0;bottom:0;height:'+BAR_H+'px;box-sizing:border-box;z-index:99999;display:flex;gap:12px;align-items:center;justify-content:flex-end;padding:0 16px;background:rgba(2,8,20,.95);border-top:1px solid #1e293b;font-family:system-ui,sans-serif';
      var label=el('span',{textContent:'Mission Cover — '+BOOT.opTitle});label.style.cssText='margin-right:auto;color:#94a3b8;font-size:13px';
      var cancel=el('button',{textContent:'Abbrechen'});cancel.style.cssText='padding:8px 14px;border:1px solid #334155;background:transparent;color:#cbd5e1;border-radius:6px;cursor:pointer';
      cancel.onclick=function(){window.location.href=BOOT.cancelUrl;};
      var save=el('button',{textContent:'In Operation speichern'});save.style.cssText='padding:8px 16px;border:1px solid #0ea5e9;background:#0284c7;color:#fff;border-radius:6px;cursor:pointer;font-weight:600';
      save.onclick=async function(){
        save.disabled=true;save.textContent='Speichere…';
        try{
          var st=window.__MC_STATE__||{};
          var config=JSON.stringify(st.config||{});
          var bg=st.bgImage||null;
          var r=await fetch(BOOT.saveUrl,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token:BOOT.token,config:config,bg:bg})});
          if(!r.ok){throw new Error('HTTP '+r.status);}
          var j=await r.json();
          // Saved → show confirmation + an explicit "back to Fleetmanager" button
          // (the link finalises the cover on the Fleetmanager side). Auto-follow
          // after a few seconds as a fallback.
          bar.innerHTML='';
          var ok=el('span',{textContent:'✓ Cover gespeichert'});ok.style.cssText='margin-right:auto;color:#34d399;font-size:13px;font-weight:600';
          var back=el('a',{textContent:'Zurück zum Fleetmanager',href:j.redirect});back.style.cssText='padding:8px 16px;border:1px solid #0ea5e9;background:#0284c7;color:#fff;border-radius:6px;text-decoration:none;font-weight:600';
          bar.appendChild(ok);bar.appendChild(back);
          setTimeout(function(){window.location.href=j.redirect;},6000);
        }catch(e){save.disabled=false;save.textContent='In Operation speichern';alert('Speichern fehlgeschlagen: '+e.message);}
      };
      bar.appendChild(label);bar.appendChild(cancel);bar.appendChild(save);
      document.body.appendChild(bar);
      // Reserve space so the bar never covers the editor: shrink the app shell.
      var shell=document.querySelector('.app-container');
      if(shell){shell.style.height='calc(100vh - '+BAR_H+'px)';}
      else{document.body.style.paddingBottom=BAR_H+'px';}
    });
  })();</script>`;

  return html
    .replace(/<head>/i, `<head>${seed}`)
    .replace(/<\/body>/i, `${bar}</body>`);
}
