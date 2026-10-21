import { useEffect, useState } from "react";

const DISMISS_KEY = "notif-banner-dismissed";

export function NotificationPermissionBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (typeof Notification === "undefined") return;
    const dismissed = localStorage.getItem(DISMISS_KEY);
    setVisible(Notification.permission === "default" && !dismissed);
  }, []);

  function dismiss() {
    localStorage.setItem(DISMISS_KEY, "1");
    setVisible(false);
  }

  async function enable() {
    const result = await Notification.requestPermission();
    if (result !== "default") dismiss();
  }

  if (!visible) return null;

  return (
    <div className="flex items-center justify-between gap-3 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-200">
      <span>Ativar notificações do navegador para saber na hora quando um lead responder?</span>
      <div className="flex shrink-0 gap-3">
        <button onClick={enable} className="font-medium underline">
          Ativar
        </button>
        <button onClick={dismiss} className="text-emerald-600 hover:text-emerald-800">
          Agora não
        </button>
      </div>
    </div>
  );
}
