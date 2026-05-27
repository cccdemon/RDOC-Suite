import { PrismaClient } from "../generated/client/index.js";

let _prisma: PrismaClient | undefined;

/**
 * Lazily instantiated singleton Prisma client.
 * In test environments call `disconnectPrisma()` between suites.
 */
export function getPrisma(): PrismaClient {
  if (!_prisma) {
    _prisma = new PrismaClient();
  }
  return _prisma;
}

export async function disconnectPrisma(): Promise<void> {
  if (_prisma) {
    await _prisma.$disconnect();
    _prisma = undefined;
  }
}

export { PrismaClient } from "../generated/client/index.js";
export type {
  GuildConfig as GuildConfigRow,
  CommanderSession as CommanderSessionRow,
} from "../generated/client/index.js";
