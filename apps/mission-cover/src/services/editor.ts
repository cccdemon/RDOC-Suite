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
  token: string; // capability token (carries opId + returnUrl), echoed on save
  returnUrl: string; // fleetplanner page to cancel back to
  opTitle: string;
};

export async function buildEditorHtml(boot: EditorBootstrap): Promise<string> {
  const html = await engineHtml();

  const seed = `<script>(function(){try{
    localStorage.setItem('star-citizen-cover-generator-config', ${safeJson(JSON.stringify(boot.config))});
    localStorage.setItem('star-citizen-cover-generator-lang','de');
    ${boot.bg ? `localStorage.setItem('star-citizen-cover-generator-bg', ${safeJson(boot.bg)});` : `localStorage.removeItem('star-citizen-cover-generator-bg');`}
  }catch(e){}})();</script>`;

  const bar = `<script>(function(){
    var BOOT=${safeJson({ saveUrl: boot.saveUrl, token: boot.token, returnUrl: boot.returnUrl, opTitle: boot.opTitle })};
    function el(t,p){var e=document.createElement(t);Object.assign(e,p||{});return e;}
    window.addEventListener('load',function(){
      var bar=el('div');bar.style.cssText='position:fixed;left:0;right:0;bottom:0;z-index:99999;display:flex;gap:12px;align-items:center;justify-content:flex-end;padding:10px 16px;background:rgba(2,8,20,.92);border-top:1px solid #1e293b;font-family:system-ui,sans-serif';
      var label=el('span',{textContent:'Mission Cover — '+BOOT.opTitle});label.style.cssText='margin-right:auto;color:#94a3b8;font-size:13px';
      var cancel=el('button',{textContent:'Abbrechen'});cancel.style.cssText='padding:8px 14px;border:1px solid #334155;background:transparent;color:#cbd5e1;border-radius:6px;cursor:pointer';
      cancel.onclick=function(){window.location.href=BOOT.returnUrl;};
      var save=el('button',{textContent:'In Operation speichern'});save.style.cssText='padding:8px 16px;border:1px solid #0ea5e9;background:#0284c7;color:#fff;border-radius:6px;cursor:pointer;font-weight:600';
      save.onclick=async function(){
        save.disabled=true;save.textContent='Speichere…';
        try{
          var config=localStorage.getItem('star-citizen-cover-generator-config');
          var bg=localStorage.getItem('star-citizen-cover-generator-bg');
          var r=await fetch(BOOT.saveUrl,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token:BOOT.token,config:config,bg:bg})});
          if(!r.ok){throw new Error('HTTP '+r.status);}
          var j=await r.json();window.location.href=j.redirect;
        }catch(e){save.disabled=false;save.textContent='In Operation speichern';alert('Speichern fehlgeschlagen: '+e.message);}
      };
      bar.appendChild(label);bar.appendChild(cancel);bar.appendChild(save);
      document.body.appendChild(bar);
      document.body.style.paddingBottom='64px';
    });
  })();</script>`;

  return html
    .replace(/<head>/i, `<head>${seed}`)
    .replace(/<\/body>/i, `${bar}</body>`);
}
