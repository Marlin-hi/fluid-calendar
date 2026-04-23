import { createHash, randomBytes } from "crypto";

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const email = process.argv[2];
  const name = process.argv[3];

  if (!email || !name) {
    console.error("Usage: npx tsx scripts/create-api-token.ts <email> <name>");
    process.exit(1);
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    console.error(`User not found: ${email}`);
    process.exit(1);
  }

  const raw = randomBytes(32).toString("hex");
  const token = `fct_${raw}`;
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const prefix = token.slice(0, 12);

  const apiToken = await prisma.apiToken.create({
    data: { tokenHash, prefix, name, userId: user.id },
  });

  console.log(
    JSON.stringify(
      {
        id: apiToken.id,
        prefix: apiToken.prefix,
        name: apiToken.name,
        token,
        warning:
          "Store this token now. It cannot be retrieved again.",
      },
      null,
      2
    )
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
