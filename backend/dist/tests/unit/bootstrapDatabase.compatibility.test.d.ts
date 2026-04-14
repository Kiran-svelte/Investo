type MockPrisma = {
    $executeRawUnsafe: jest.Mock;
    $queryRawUnsafe: jest.Mock;
    user: {
        count: jest.Mock;
    };
};
declare function loadBootstrapModule(): {
    bootstrapDatabase: (options: {
        autoMigrate: boolean;
        autoSeed: boolean;
    }) => Promise<void>;
    mockPrisma: MockPrisma;
};
//# sourceMappingURL=bootstrapDatabase.compatibility.test.d.ts.map