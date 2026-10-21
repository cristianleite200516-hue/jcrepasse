import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { api } from "./api";
import { socket } from "./socket";
import { playNotificationBeep } from "./sound";
import { Message } from "./types";

// Toca um som e, se permitido, mostra uma notificação do navegador sempre que um
// LEAD manda mensagem — funciona em qualquer tela do CRM (o hook fica no Layout).
export function useLeadNotifications() {
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    function onMessage(payload: { leadId: string; message: Message }) {
      if (payload.message.sender !== "LEAD") return;

      playNotificationBeep();

      if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
      // Não notifica se o usuário já está vendo a conversa desse lead.
      if (location.pathname === `/leads/${payload.leadId}`) return;

      api
        .get(`/leads/${payload.leadId}`)
        .then((res) => {
          const lead = res.data;
          const title = `${lead.name || lead.phone}`;
          const notification = new Notification(title, {
            body: payload.message.content,
            tag: `lead-${payload.leadId}`,
          });
          notification.onclick = () => {
            window.focus();
            navigate(`/leads/${payload.leadId}`);
            notification.close();
          };
        })
        .catch(() => {});
    }

    socket.on("message:new", onMessage);
    return () => {
      socket.off("message:new", onMessage);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);
}
