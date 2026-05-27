import ReactDOM from "react-dom/client";
import { App } from "./App";
import "./styles/tokens.css";
import "./styles/kit.css";

const root = document.getElementById("root");
if (!root) throw new Error("#root element missing");

// NOTE: StrictMode intentionally omitted. It double-mounts effects in dev,
// which our setup mishandles: each mount creates a new BridgeWs + LivekitAudio
// pair, both of which connect with the same identity → LiveKit kicks the older
// connection (DUPLICATE_IDENTITY, reason=2). A proper cancelable-effect refactor
// is a follow-up; for the MVP we keep the dev loop single-mounted.
ReactDOM.createRoot(root).render(<App />);
