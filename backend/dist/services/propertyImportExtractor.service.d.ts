export interface PropertyImportExtractionHint {
    field: string;
    confidence: number;
    source_field?: string | null;
    note?: string | null;
}
export interface PropertyImportExtractionResult {
    structuredData: Record<string, unknown>;
    confidenceHints: PropertyImportExtractionHint[];
    reviewRequired: boolean;
    metadata: Record<string, unknown>;
}
export interface PropertyImportExtractorInput {
    companyId: string;
    draftId: string;
    mediaId: string;
    media: {
        assetType: 'image' | 'brochure' | 'video';
        mimeType: string;
        fileName: string;
        fileSize: number;
        storageKey: string;
        publicUrl: string;
    };
    draftData: Record<string, unknown>;
}
export interface PropertyImportExtractorDeps {
    fetch?: typeof fetch;
    pdfParse?: (buffer: Buffer) => Promise<{
        text?: string;
    }>;
    storage?: {
        getObjectBuffer: (key: string) => Promise<Buffer>;
    };
}
export declare class PropertyImportExtractorService {
    private readonly deps;
    constructor(deps?: PropertyImportExtractorDeps);
    extractMedia(input: PropertyImportExtractorInput): Promise<PropertyImportExtractionResult | null>;
    private loadSourceText;
    private tryOpenAIExtraction;
    private parseExtractionPayload;
    private mergeExtractionResults;
    private buildHeuristicResult;
    private normalizeStructuredData;
    private normalizeConfidenceHints;
    private extractJsonPayload;
    private extractPropertyFieldsFromText;
    private extractLabelValue;
    private extractAmenities;
    private extractDescription;
    private extractCoordinates;
    private parseIndianCurrency;
    private mergeRecordValues;
    private limitText;
    private fileNameToTitle;
    private asNullableString;
    private asNullableNumber;
    private asNullableInt;
    private asNormalizedConfidence;
    private asPropertyType;
    private asPropertyStatus;
    private asStringArray;
}
export declare const propertyImportExtractorService: PropertyImportExtractorService;
//# sourceMappingURL=propertyImportExtractor.service.d.ts.map