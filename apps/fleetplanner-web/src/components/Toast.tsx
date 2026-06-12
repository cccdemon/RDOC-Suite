import { useEffect, useState } from "react";

// Minimal global toast: bottom-centered card, auto-hide after 2.6s (design §74).
// showToast() can be called from anywhere; ToastHost renders the current message.
type Listener = (msg: string) => void;
let listener: Listener | null = null;

export function showToast(msg: string): void {
  listener?.(msg);
}

export function ToastHost() {
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    listener = (m: string) => {
      setMsg(m);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => setMsg(null), 2600);
    };
    return () => {
      listener = null;
      if (timer) clearTimeout(timer);
    };
  }, []);

  if (!msg) return null;
  return (
    <div className="toast" role="status" data-testid="toast">
      {msg}
    </div>
  );
}
