// Marca e região da loja. Os padrões são do JC REPASSE; outra loja define as variáveis VITE_* no Vercel
// (VITE_BRAND_NAME, VITE_BRAND_TAGLINE, VITE_BRAND_INITIALS, VITE_HOME_DDD) sem mexer no código.
const env = import.meta.env as Record<string, string | undefined>;

export const BRAND = {
  name: env.VITE_BRAND_NAME || "JC REPASSE",
  tagline: env.VITE_BRAND_TAGLINE ?? "",
  initials: env.VITE_BRAND_INITIALS || "JC",
  // DDD da região da loja: os leads dele aparecem primeiro no funil e nas Conversas.
  homeDdd: env.VITE_HOME_DDD || "41",
};

if (typeof document !== "undefined") {
  document.title = BRAND.tagline ? `${BRAND.name} — ${BRAND.tagline}` : BRAND.name;
}
