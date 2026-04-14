import { PrismaClient } from '@prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';
declare const prisma: PrismaClient<{
    adapter: PrismaNeon;
    log: ({
        level: "warn";
        emit: "event";
    } | {
        level: "error";
        emit: "event";
    })[];
}, "error" | "warn", import("@prisma/client/runtime/client").DefaultArgs>;
export default prisma;
//# sourceMappingURL=prisma.d.ts.map