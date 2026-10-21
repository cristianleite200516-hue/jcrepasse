import { useEffect, useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { api } from "../lib/api";
import { socket } from "../lib/socket";
import { Reminder } from "../lib/types";
import { Logo } from "./Logo";
import { NotificationPermissionBanner } from "./NotificationPermissionBanner";
import { useLeadNotifications } from "../lib/useLeadNotifications";
import { useWhatsAppStatusAlert } from "../lib/useWhatsAppStatusAlert";
import { useHideMoney } from "../lib/useHideMoney";

function EyeIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1.5 12S5 5 12 5s10.5 7 10.5 7-3.5 7-10.5 7S1.5 12 1.5 12Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9.9 4.24A10.94 10.94 0 0 1 12 4c7 0 10.5 7 10.5 7a17.7 17.7 0 0 1-2.35 3.5M6.4 6.4C3.4 8.3 1.5 11.5 1.5 11.5S5 18.5 12 18.5c1.7 0 3.2-.35 4.5-.9M9.9 14.1a3 3 0 0 0 4.2-4.2" />
      <path d="M1.5 1.5l21 21" />
    </svg>
  );
}

function useDueRemindersCount() {
  const [count, setCount] = useState(0);

  async function load() {
    const res = await api.get("/reminders", { params: { status: "pending" } });
    const now = Date.now();
    const due = (res.data as Reminder[]).filter((r) => new Date(r.dueAt).getTime() <= now);
    setCount(due.length);
  }

  useEffect(() => {
    load();
    socket.on("reminder:created", load);
    socket.on("reminder:updated", load);
    socket.on("reminder:deleted", load);
    const interval = setInterval(load, 60_000);
    return () => {
      socket.off("reminder:created", load);
      socket.off("reminder:updated", load);
      socket.off("reminder:deleted", load);
      clearInterval(interval);
    };
  }, []);

  return count;
}

export function Layout() {
  const { user, logout } = useAuth();
  const { hidden, toggle } = useHideMoney();
  useLeadNotifications();
  useWhatsAppStatusAlert();
  const dueReminders = useDueRemindersCount();

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
      isActive ? "bg-emerald-500 text-white shadow-sm" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
    }`;

  return (
    <div className="min-h-screen flex flex-col bg-slate-50">
      <header className="bg-white border-b border-slate-200 px-4 py-3 flex items-center justify-between shadow-sm">
        <div className="flex min-w-0 items-center gap-6">
          <Logo />
          <nav className="flex min-w-0 flex-wrap gap-1">
            {user?.role === "ADMIN" && (
              <NavLink to="/rotina" className={linkClass}>
                Rotina
              </NavLink>
            )}
            {user?.role === "ADMIN" && (
              <NavLink to="/dashboard" className={linkClass}>
                Dashboard
              </NavLink>
            )}
            {user?.role === "ADMIN" && (
              <NavLink to="/rentabilidade" className={linkClass}>
                Rentabilidade
              </NavLink>
            )}
            {user?.role === "ADMIN" && (
              <NavLink to="/campanhas" className={linkClass}>
                Campanhas
              </NavLink>
            )}
            {user?.role === "ADMIN" && (
              <NavLink to="/duplicados" className={linkClass}>
                Duplicados
              </NavLink>
            )}
            <NavLink to="/" end className={linkClass}>
              Leads
            </NavLink>
            <NavLink to="/inbox" className={linkClass}>
              Conversas
            </NavLink>
            <NavLink to="/parados" className={linkClass}>
              Parados
            </NavLink>
            {user?.role === "ADMIN" && (
              <NavLink to="/limpeza" className={linkClass}>
                Limpeza
              </NavLink>
            )}
            <NavLink to="/estoque" className={linkClass}>
              Estoque
            </NavLink>
            <NavLink to="/agendamentos" className={linkClass}>
              Agendamentos
            </NavLink>
            <NavLink to="/lembretes" className={linkClass}>
              <span className="inline-flex items-center gap-1.5">
                Lembretes
                {dueReminders > 0 && (
                  <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
                    {dueReminders}
                  </span>
                )}
              </span>
            </NavLink>
            <NavLink to="/whatsapp" className={linkClass}>
              WhatsApp
            </NavLink>
            {user?.role === "ADMIN" && (
              <NavLink to="/settings" className={linkClass}>
                Configurações
              </NavLink>
            )}
          </nav>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <button
            onClick={toggle}
            title={hidden ? "Mostrar valores de faturamento/rentabilidade" : "Ocultar valores de faturamento/rentabilidade"}
            className="flex h-7 w-7 items-center justify-center rounded-full text-slate-600 hover:bg-slate-100 hover:text-slate-900"
          >
            {hidden ? <EyeOffIcon /> : <EyeIcon />}
          </button>
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-700 text-xs font-semibold text-white">
            {(user?.name || "?").charAt(0).toUpperCase()}
          </div>
          <span className="text-slate-800">{user?.name}</span>
          <button onClick={logout} className="text-slate-600 hover:text-slate-900 hover:underline">
            Sair
          </button>
        </div>
      </header>
      <NotificationPermissionBanner />
      <main className="flex-1 p-4">
        <Outlet />
      </main>
    </div>
  );
}
