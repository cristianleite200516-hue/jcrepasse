import { BRAND } from "../lib/brand";

export function Logo({ withTagline = true }: { withTagline?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-500 shadow-sm">
        <span className="text-sm font-extrabold tracking-tight text-white">{BRAND.initials}</span>
      </div>
      <div className="leading-tight">
        <div className="text-[15px] font-bold tracking-tight text-slate-900">{BRAND.name}</div>
        {withTagline && BRAND.tagline && (
          <div className="text-[10px] font-medium uppercase tracking-wide text-slate-600">
            {BRAND.tagline}
          </div>
        )}
      </div>
    </div>
  );
}
