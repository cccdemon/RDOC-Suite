// Standalone caveman error page service.
// Zero dependencies — pure Node.js http module.
// Caddy passes the upstream status code via X-Status-Code header.
// Listens on PORT env var (default 9091).

import { createServer } from "node:http";

const PORT = Number(process.env.PORT ?? 9091);

const FLAVORS = {
  502: "Caveman knock on door. Nobody home. Service not running. Try again later, maybe bigger caveman restart it.",
  503: "Service do important cave-painting. Come back later. Or not. Caveman not judge.",
  504: "Caveman wait long time for answer. Other caveman fall asleep. Timeout.",
  500: "Caveman try do thing. Thing too complicated. Error happen. Bigger caveman must come.",
};

const GRUNTS = {
  502: "🦴",
  503: "🪨",
  504: "⏳",
  500: "🦣",
};

function page(statusCode) {
  const code = Number(statusCode) || 500;
  const flavor = FLAVORS[code] ?? FLAVORS[500];
  const grunt = GRUNTS[code] ?? GRUNTS[500];
  const title = code === 502 ? "Service Gone Hunt Mammoth"
    : code === 503 ? "Cave Temporarily Closed"
    : code === 504 ? "Other Caveman Sleep"
    : "Ugh — Something Break";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>${code} — ${title}</title>
  <style>
    /* RDOC Brandkit v2.2 palette, written out as literals on purpose: this page
       is what the visitor sees when the rest of the stack is down, so it must
       not depend on a stylesheet or a font from another container. Copper is
       the one accent, no glow (BrandGuide §8 "Kein Effekt"). */
    *{box-sizing:border-box;margin:0;padding:0}
    body{background:#121416;color:#f2f2f0;font-family:'IBM Plex Mono',ui-monospace,SFMono-Regular,Consolas,monospace;min-height:100vh;display:grid;place-items:center;padding:2rem}
    main{max-width:38rem;border:1px solid #2b3135;background:#1a1e21;padding:2.5rem 2rem;text-align:center}
    .code{font-size:5.5rem;color:#c48a4a;letter-spacing:0;line-height:1;margin-bottom:.25rem}
    .grunt{font-size:3rem;margin-bottom:1rem}
    h1{color:#f2f2f0;font-size:1.1rem;letter-spacing:.07em;text-transform:uppercase;margin-bottom:1.5rem}
    .bubble{position:relative;background:#121416;border:1px solid #2b3135;border-radius:2px;padding:1.25rem 1.5rem;text-align:left;margin-bottom:1.75rem}
    .bubble::before{content:"UGH.";display:block;color:#4fb5b5;font-size:.7rem;letter-spacing:.07em;margin-bottom:.5rem}
    .bubble p{color:#76828d;line-height:1.75;font-size:.9rem}
    .bubble strong{color:#f2f2f0;font-weight:normal}
    .sub{font-size:.72rem;color:#76828d;margin-bottom:2rem;letter-spacing:.07em}
    .btn{display:inline-block;border:1px solid #c48a4a;padding:.65rem 1.4rem;text-decoration:none;color:#c48a4a;font-size:.8rem;letter-spacing:.07em;text-transform:uppercase;transition:color .15s,border-color .15s}
    .btn:hover{border-color:#e0a868;color:#e0a868}
    a:focus-visible,.btn:focus-visible{outline:2px solid #e0a868;outline-offset:2px}
  </style>
</head>
<body>
  <main>
    <div class="code">${code}</div>
    <div class="grunt">${grunt}</div>
    <h1>${title}</h1>
    <div class="bubble">
      <p>${flavor}</p>
    </div>
    <p class="sub">RDOC FLEETPLANNER &mdash; ERROR PAGE SERVICE</p>
    <a href="/" class="btn">&#8592; Caveman go back to cave</a>
  </main>
</body>
</html>`;
}

const server = createServer((req, res) => {
  // Caddy passes the upstream status code via header
  const statusCode = req.headers["x-status-code"] ?? "500";
  const html = page(statusCode);
  res.writeHead(Number(statusCode) || 500, {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Length": Buffer.byteLength(html),
    "Cache-Control": "no-store",
  });
  res.end(html);
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`[error-page] caveman ready on port ${PORT}`);
});
