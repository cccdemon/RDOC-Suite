// API-only doc content. The fleetplanner backend serves the static info/legal
// page CONTENT as data (JSON: { title, html }) via /api/v1/content/:slug; the
// fleetplanner-web SPA renders it in its DocPage. No page rendering happens here
// — this is trusted first-party HTML content returned as a string.
import { html, rawHtml, type SafeHtml } from "../web/render.js";
import { whyUnsignedBody, whatIsBody, howToBody, datenschutzBody } from "../web/pages.js";
import { setLocale, t } from "../i18n/index.js";
import { basePath, getEnv } from "../config/env.js";

export interface DocContent {
  title: string;
  html: string;
}

type Builder = (lang: "de" | "en") => { title: string; body: SafeHtml };

const impressum: Builder = () => ({
  title: "Impressum",
  body: html`<div class="page-header">
      <h1 class="page-title">IMPRESSUM</h1>
      <div class="page-subtitle">Angaben gemäß § 5 DDG (Digitale-Dienste-Gesetz).</div>
    </div>

    <div class="section">
      <div class="card" style="padding:1.25rem;max-width:52rem">
        <div class="card-title">Verantwortlich für den Inhalt</div>
        <p style="margin-top:.5rem;line-height:1.8">
          JustCallMeDeimos - Torsten Ennenbach<br />
          c/o Online-Impressum.de #4910<br />
          Europaring 90<br />
          53757 Sankt Augustin<br />
          Deutschland<br />
          E-Mail: <a href="mailto:tower@raumdock.org">tower@raumdock.org</a>
        </p>
      </div>
      <div class="card" style="padding:1.25rem;max-width:52rem;margin-top:1rem">
        <div class="card-title">Hinweise</div>
        <p class="text-dim text-sm mt-1">
          Diese Seite enthält Links zu externen Webseiten Dritter, auf deren Inhalte wir keinen
          Einfluss haben und für die wir keine Haftung übernehmen. Raumdock ist eine private,
          nicht-kommerzielle Online-Gemeinschaft ohne Gewinnabsicht – wir sind Spieler, die
          zufällig dasselbe Spiel spielen.
        </p>
      </div>
    </div>

    <div class="section">
      <div class="section-title">English translation (non-binding)</div>
      <div class="card" style="padding:1.25rem;max-width:52rem">
        <div class="card-title">Responsible for the content</div>
        <p style="margin-top:.5rem;line-height:1.8">
          JustCallMeDeimos - Torsten Ennenbach<br />
          c/o Online-Impressum.de #4910<br />
          Europaring 90<br />
          53757 Sankt Augustin<br />
          Germany<br />
          Email: <a href="mailto:tower@raumdock.org">tower@raumdock.org</a>
        </p>
        <p class="text-dim text-sm" style="margin-top:.75rem">
          This site contains links to external third-party websites over whose content we have no
          influence and for which we accept no liability. Raumdock is a private, non-commercial
          online community with no profit motive – we are players who happen to play the same game.
          The German version above is the legally binding one.
        </p>
      </div>
    </div>`,
});

const license: Builder = (lang) => ({
  title: lang === "en" ? "License" : "Lizenz",
  body: html`<div class="page-header"><h1 class="page-title">${lang === "en" ? "LICENSE" : "LIZENZ"}</h1></div>
    <div class="section">
      <div class="card" style="padding:1.25rem;max-width:48rem">
        <pre style="font-family:var(--mono);font-size:.82rem;white-space:pre-wrap;color:var(--text);margin:0">
RDOC-Suite License and Notices

Code license:
PolyForm Noncommercial License 1.0.0
https://polyformproject.org/licenses/noncommercial/1.0.0

Required Notice: RDOC-Suite Copyright (c) 2026 xheadwigx and justcallmedeimos.
Required Notice: Authors: xheadwigx (https://github.com/cccdemon) and justcallmedeimos (https://twitch.tv/justcallmedeimos).
Required Notice: RDOC-Suite source: https://github.com/cccdemon/RDOC-Suite
Required Notice: RDOC-Suite is licensed for noncommercial use under the PolyForm Noncommercial License 1.0.0. Commercial use requires prior written permission from the authors.
Required Notice: The RDOC-Suite credit banner, stamp, logo, and visible attribution notices must not be removed, hidden, or materially altered in public deployments or redistributed versions without prior written permission from the authors.</pre>
        <p class="text-dim text-sm" style="margin-top:1rem">
          ${lang === "en" ? "Source" : "Quelle"}:
          <a href="https://github.com/cccdemon/RDOC-Suite" target="_blank" rel="noopener">github.com/cccdemon/RDOC-Suite</a>
        </p>
      </div>
    </div>`,
});

// i18n-driven pages reuse the existing body-builders; setLocale mutates the
// request ALS store so t() resolves to the requested language.
const whyUnsigned: Builder = (lang) => {
  setLocale(lang === "en" ? "en" : "de");
  return { title: t("nav.unsignedBinary"), body: whyUnsignedBody() };
};

const howTo: Builder = () => ({
  title: "How to",
  body: howToBody(basePath(), getEnv().SUPERADMIN_CONTACT),
});

const whatis: Builder = (lang) => ({
  title: lang === "en" ? "What is the Fleetmanager?" : "Was ist der Fleetmanager?",
  body: whatIsBody(basePath(), lang !== "en"),
});

const datenschutz: Builder = () => ({ title: "Privacy", body: datenschutzBody(basePath()) });

const BUILDERS: Record<string, Builder> = {
  impressum,
  license,
  "why-unsigned": whyUnsigned,
  "how-to": howTo,
  whatis,
  datenschutz,
};

export function getDocContent(slug: string, lang: "de" | "en" = "de"): DocContent | null {
  const build = BUILDERS[slug];
  if (!build) return null;
  const { title, body } = build(lang);
  return { title, html: rawHtml(body) };
}
