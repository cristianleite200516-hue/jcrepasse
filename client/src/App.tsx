import { Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./lib/auth";
import { HideMoneyProvider } from "./lib/useHideMoney";
import { Layout } from "./components/Layout";
import { Login } from "./pages/Login";
import { Dashboard } from "./pages/Dashboard";
import { Analytics } from "./pages/Analytics";
import { Profitability } from "./pages/Profitability";
import { Inbox } from "./pages/Inbox";
import { Estoque } from "./pages/Estoque";
import { Appointments } from "./pages/Appointments";
import { Reminders } from "./pages/Reminders";
import { LeadDetail } from "./pages/LeadDetail";
import { WhatsAppConnect } from "./pages/WhatsAppConnect";
import { SettingsPage } from "./pages/SettingsPage";
import { SignDocument } from "./pages/SignDocument";
import { Campaigns } from "./pages/Campaigns";
import { Duplicates } from "./pages/Duplicates";
import { Rotina } from "./pages/Rotina";
import { Parados } from "./pages/Parados";
import { Limpeza } from "./pages/Limpeza";

function PrivateRoutes() {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/rotina" element={<Rotina />} />
        {user.role === "ADMIN" && <Route path="/dashboard" element={<Analytics />} />}
        {user.role === "ADMIN" && <Route path="/rentabilidade" element={<Profitability />} />}
        {user.role === "ADMIN" && <Route path="/campanhas" element={<Campaigns />} />}
        {user.role === "ADMIN" && <Route path="/duplicados" element={<Duplicates />} />}
        {user.role === "ADMIN" && <Route path="/limpeza" element={<Limpeza />} />}
        <Route path="/parados" element={<Parados />} />
        <Route path="/inbox" element={<Inbox />} />
        <Route path="/estoque" element={<Estoque />} />
        <Route path="/agendamentos" element={<Appointments />} />
        <Route path="/lembretes" element={<Reminders />} />
        <Route path="/leads/:id" element={<LeadDetail />} />
        <Route path="/whatsapp" element={<WhatsAppConnect />} />
        {user.role === "ADMIN" && <Route path="/settings" element={<SettingsPage />} />}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

function AppRoutes() {
  const { user } = useAuth();
  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/" replace /> : <Login />} />
      <Route path="/assinar/:token" element={<SignDocument />} />
      <Route path="/*" element={<PrivateRoutes />} />
    </Routes>
  );
}

export default function App() {
  return (
    <HideMoneyProvider>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </HideMoneyProvider>
  );
}
