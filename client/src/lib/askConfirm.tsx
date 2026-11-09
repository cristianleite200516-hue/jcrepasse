import { createRoot } from "react-dom/client";

// Substitui o window.confirm(): em alguns navegadores embutidos ele é bloqueado e responde
// "não" sozinho (ex: trocar papel de usuário, apagar lembrete), e a ação nunca acontecia.
// Abre uma janelinha dentro da própria página e devolve true/false.
export function askConfirm(message: string): Promise<boolean> {
  return new Promise((resolve) => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);

    const close = (answer: boolean) => {
      window.removeEventListener("keydown", onKey);
      root.unmount();
      host.remove();
      resolve(answer);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close(false);
    };
    window.addEventListener("keydown", onKey);

    root.render(
      <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-slate-900/40 p-4" onClick={() => close(false)}>
        <div role="dialog" aria-modal="true" className="w-full max-w-sm rounded-lg bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
          <p className="whitespace-pre-line text-sm text-slate-800">{message}</p>
          <div className="mt-4 flex justify-end gap-2">
            <button onClick={() => close(false)} className="rounded-md px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100">
              Cancelar
            </button>
            <button autoFocus onClick={() => close(true)} className="rounded-md bg-emerald-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-600">
              Confirmar
            </button>
          </div>
        </div>
      </div>,
    );
  });
}
