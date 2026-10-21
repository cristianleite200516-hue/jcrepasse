import "dotenv/config";
import bcrypt from "bcryptjs";
import { prisma } from "../lib/prisma";

async function main() {
  const name = process.env.SEED_ADMIN_NAME || "Admin";
  const email = process.env.SEED_ADMIN_EMAIL || "admin@crm.local";
  const password = process.env.SEED_ADMIN_PASSWORD || "admin123";

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log(`Usuário admin já existe: ${email}`);
  } else {
    const passwordHash = await bcrypt.hash(password, 10);
    await prisma.user.create({ data: { name, email, passwordHash, role: "ADMIN" } });
    console.log(`Admin criado: ${email} / senha: ${password}`);
  }

  const settings = await prisma.settings.findUnique({ where: { id: "singleton" } });
  if (!settings) {
    await prisma.settings.create({
      data: {
        id: "singleton",
        aiSystemPrompt: "",
        businessInfo:
          "Somos uma loja que compra veículos à vista de pessoas que precisam vender com urgência. " +
          "Avaliamos o carro e fazemos uma proposta rápida, com pagamento em até 24h após a vistoria.",
      },
    });
    console.log("Configurações padrão criadas.");
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
