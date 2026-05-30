import { prisma } from "../db.js";

export async function getSetting(key: string): Promise<string> {
  const setting = await prisma.appSetting.findUnique({ where: { key } });
  return setting?.value ?? "";
}

export async function setSetting(key: string, value: string) {
  return prisma.appSetting.upsert({
    where: { key },
    create: { key, value },
    update: { value },
  });
}
