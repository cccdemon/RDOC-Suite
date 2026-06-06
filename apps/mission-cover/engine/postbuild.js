import fs from 'fs';
import path from 'path';

const indexPath = path.resolve('dist/index.html');
if (fs.existsSync(indexPath)) {
  let html = fs.readFileSync(indexPath, 'utf8');

  // Replace type="module" with standard script tags + defer to bypass CORS on file:// and wait for DOM parsing
  html = html.replace(/<script type="module" crossorigin>/g, '<script defer>');
  html = html.replace(/<script type="module">/g, '<script defer>');

  // Remove modulepreload links which trigger CORS errors on file://
  html = html.replace(/<link rel="modulepreload"[^>]*>/g, '');

  fs.writeFileSync(indexPath, html, 'utf8');
  console.log('Post-build: Successfully converted dist/index.html with defer script for file:// compatibility.');
} else {
  console.error('Post-build error: dist/index.html not found.');
}
