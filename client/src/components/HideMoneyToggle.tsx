export function HideMoneyToggle({ hidden, onToggle }: { hidden: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      title={hidden ? "Mostrar valores" : "Ocultar valores"}
      className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-600 hover:bg-slate-100"
    >
      {hidden ? "🙈" : "👁️"}
    </button>
  );
}

export function Money({ hidden, children }: { hidden: boolean; children: string }) {
  return <>{hidden ? "••••••" : children}</>;
}
