import { useEffect, useRef } from "react";
import { socket } from "./socket";
import { playNotificationBeep } from "./sound";

type Status = "DISCONNECTED" | "QR" | "CONNECTING" | "READY";

// Antes, só dava pra saber que o WhatsApp caiu tentando mandar uma mensagem e vendo falhar.
// Isso aqui avisa na hora (som + notificação do navegador, se permitida) sempre que o status
// vira DISCONNECTED ou QR vindo de um estado conectado — funciona em qualquer tela do CRM.
export function useWhatsAppStatusAlert() {
  const lastStatus = useRef<Status | null>(null);

  useEffect(() => {
    function onStatus(payload: { status: Status }) {
      const prev = lastStatus.current;
      lastStatus.current = payload.status;

      const wasHealthy = prev === "READY" || prev === "CONNECTING";
      const isBroken = payload.status === "DISCONNECTED" || payload.status === "QR";
      if (!wasHealthy || !isBroken) return;

      playNotificationBeep();

      if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
      const notification = new Notification("WhatsApp desconectado", {
        body:
          payload.status === "QR"
            ? "O WhatsApp precisa que você escaneie um novo QR code pra voltar a atender."
            : "A conexão com o WhatsApp caiu. Os leads não estão sendo respondidos agora.",
        tag: "whatsapp-status",
      });
      notification.onclick = () => {
        window.focus();
        window.location.href = "/whatsapp";
        notification.close();
      };
    }

    socket.on("whatsapp:status", onStatus);
    return () => {
      socket.off("whatsapp:status", onStatus);
    };
  }, []);
}
