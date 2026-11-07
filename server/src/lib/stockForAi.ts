import { prisma } from "./prisma";

// Mesma definição de "carro da loja" da tela Estoque: lead ganho/fechado que ainda não foi vendido.
// O filtro de status é obrigatório: resaleStatus tem valor padrão em todos os leads, inclusive
// nos de quem ainda está só oferecendo o carro.
const OWNED_STATUSES = ["GANHO", "FECHADO"];

export interface StockCar {
  name: string | null;
  source: string;
  vehicleBrand: string | null;
  vehicleModel: string | null;
  vehicleYear: string | null;
  vehicleColor: string | null;
  vehicleInfo: string | null;
  salePrice: number | null;
  resaleStatus: string;
}

function clean(text: string | null | undefined) {
  return (text ?? "").replace(/\s+/g, " ").trim();
}

function describeCar(car: StockCar) {
  // O nome só descreve o carro quando foi cadastrado direto no estoque; num lead, é o nome da
  // pessoa que vendeu, que nunca pode ir para outro cliente.
  const stockName = car.source === "estoque" ? clean(car.name).replace(/^Estoque — /, "") : "";
  if (stockName) {
    const extras = [car.vehicleYear, car.vehicleColor]
      .map(clean)
      // Compara só o início para não repetir a cor quando muda o gênero (branco/Branca).
      .filter((value) => value && !stockName.toLowerCase().includes(value.toLowerCase().slice(0, 4)));
    return [stockName, ...extras].join(", ");
  }
  const structured = [car.vehicleBrand, car.vehicleModel, car.vehicleYear, car.vehicleColor]
    .map(clean)
    .filter(Boolean)
    .join(" ");
  return structured || clean(car.vehicleInfo);
}

function fmtPrice(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
}

export function formatStockForAi(cars: StockCar[]) {
  const lines = cars
    .filter((car) => car.resaleStatus !== "VENDIDO")
    .map((car) => {
      const description = describeCar(car);
      if (!description) return null;
      // Em negociação, o valor salvo pode já ser o combinado com outro comprador.
      if (car.resaleStatus === "NEGOCIANDO") {
        return `- ${description} — em negociação com outro cliente; valor a confirmar com a equipe`;
      }
      return `- ${description} — ${car.salePrice != null ? fmtPrice(car.salePrice) : "valor a confirmar com a equipe"}`;
    })
    .filter(Boolean);

  if (lines.length === 0) {
    return `CARROS DISPONÍVEIS NO ESTOQUE AGORA: nenhum.
Não ofereça nenhum carro. Se o cliente quiser comprar, diga que vai verificar com a equipe.`;
  }

  return `CARROS DISPONÍVEIS NO ESTOQUE AGORA (lista atualizada automaticamente; carros vendidos já saíram):
${lines.join("\n")}
Só ofereça carros desta lista, mesmo que um carro apareça em mensagens antigas da conversa ou em outro texto: se não
está aqui, ele não está disponível. Se o cliente perguntar por outro carro, diga que vai verificar com a equipe.
Nunca invente um valor: quando estiver "valor a confirmar", diga que a equipe confirma o preço.`;
}

export async function getStockForAi() {
  const cars = await prisma.lead.findMany({
    where: { status: { in: OWNED_STATUSES as never }, resaleStatus: { not: "VENDIDO" } },
    select: {
      name: true,
      source: true,
      vehicleBrand: true,
      vehicleModel: true,
      vehicleYear: true,
      vehicleColor: true,
      vehicleInfo: true,
      salePrice: true,
      resaleStatus: true,
    },
    orderBy: { createdAt: "desc" },
  });
  return formatStockForAi(cars as StockCar[]);
}
