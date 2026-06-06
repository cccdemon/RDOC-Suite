import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

// Global error handler for local file diagnostic logs
window.onerror = function (message, source, lineno, colno, error) {
  alert(
    "STAR CITIZEN MISSION COVER GENERATOR - FEHLERDIAGNOSE:\n\n" +
    "Fehler: " + message + "\n" +
    "Datei: " + source + "\n" +
    "Zeile: " + lineno + " Spalte: " + colno + "\n\n" +
    "Stacktrace:\n" + (error ? error.stack : "Kein Stacktrace verfügbar")
  );
  return false;
};

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
