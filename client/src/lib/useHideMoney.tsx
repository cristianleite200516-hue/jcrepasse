import { createContext, ReactNode, useContext, useEffect, useState } from "react";

const STORAGE_KEY = "vmca_hide_money";

interface HideMoneyContextValue {
  hidden: boolean;
  toggle: () => void;
}

const HideMoneyContext = createContext<HideMoneyContextValue | null>(null);

// Modo privacidade pra rentabilidade/faturamento — útil na hora de mostrar a tela pra
// alguém sem expor números. Persiste no navegador (localStorage) e fica sincronizado
// entre todas as telas (Dashboard, Rentabilidade, ficha do lead) via Context.
export function HideMoneyProvider({ children }: { children: ReactNode }) {
  const [hidden, setHidden] = useState(() => localStorage.getItem(STORAGE_KEY) === "1");

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, hidden ? "1" : "0");
  }, [hidden]);

  return (
    <HideMoneyContext.Provider value={{ hidden, toggle: () => setHidden((v) => !v) }}>
      {children}
    </HideMoneyContext.Provider>
  );
}

export function useHideMoney() {
  const ctx = useContext(HideMoneyContext);
  if (!ctx) throw new Error("useHideMoney precisa estar dentro de HideMoneyProvider");
  return ctx;
}

export function maskCurrency(hidden: boolean, formatted: string) {
  return hidden ? "R$ ••••••" : formatted;
}
