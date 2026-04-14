/// <reference types="jest" />
jest.setTimeout(30000);
function loadBootstrapModule() {
    jest.resetModules();
    const mockPrisma = {
        $executeRawUnsafe: jest.fn().mockResolvedValue(undefined),
        $queryRawUnsafe: jest.fn().mockResolvedValue([{ users_table: 'users' }]),
        user: {
            count: jest.fn().mockResolvedValue(1),
        },
    };
    jest.doMock('../../config/prisma', () => ({
        __esModule: true,
        default: mockPrisma,
    }));
    jest.doMock('../../config/logger', () => ({
        __esModule: true,
        default: {
            info: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
            debug: jest.fn(),
        },
    }));
    jest.doMock('../../config/seed', () => ({
        __esModule: true,
        seedDatabase: jest.fn().mockResolvedValue(undefined),
    }));
    let bootstrapDatabase;
    jest.isolateModules(() => {
        bootstrapDatabase = require('../../config/bootstrapDatabase').bootstrapDatabase;
    });
    return { bootstrapDatabase, mockPrisma };
}
describe('bootstrapDatabase compatibility patches', () => {
    afterEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
    });
    test('applies patches even when auto-migrate and auto-seed are disabled', async () => {
        const { bootstrapDatabase, mockPrisma } = loadBootstrapModule();
        await bootstrapDatabase({ autoMigrate: false, autoSeed: false });
        expect(mockPrisma.$executeRawUnsafe).toHaveBeenCalled();
        expect(mockPrisma.$queryRawUnsafe).not.toHaveBeenCalled();
        expect(mockPrisma.user.count).not.toHaveBeenCalled();
    });
});
//# sourceMappingURL=bootstrapDatabase.compatibility.test.js.map