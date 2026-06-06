import fs from 'fs';
import path from 'path';

const indexPath = path.resolve('dist/index.html');
if (fs.existsSync(indexPath)) {
  let html = fs.readFileSync(indexPath, 'utf8');

  // Keep the inlined bundle as type="module": inline module scripts are
  // deferred by default (they run AFTER the DOM, so #root exists when React
  // mounts) and, since vite-plugin-singlefile inlines everything, they make no
  // external request — no CORS issue even under file://. Downgrading them to a
  // plain <script defer> breaks mounting, because `defer` is ignored on INLINE
  // scripts in <head>: the bundle then runs before <body>/#root → React #299.

  // Remove modulepreload links (they reference no-longer-existing external
  // chunks after inlining and trigger CORS errors on file://).
  html = html.replace(/<link rel="modulepreload"[^>]*>/g, '');

  fs.writeFileSync(indexPath, html, 'utf8');
  console.log('Post-build: stripped modulepreload links; kept inline module scripts.');
} else {
  console.error('Post-build error: dist/index.html not found.');
}
