type PropertyImportRecord = Record<string, unknown>;
export type PropertyImportReviewStatus = 'not_required' | 'needs_review' | 'approved';
export interface PropertyImportFieldMapping {
    source_field: string;
    target_field: string;
    confidence: number | null;
    required: boolean;
    label: string | null;
    notes: string | null;
}
export interface PropertyImportReviewHint {
    field: string;
    confidence: number;
    source_field: string | null;
    note: string | null;
}
export interface PropertyImportReviewSettings {
    confidence_threshold: number;
    require_human_review: boolean;
    low_confidence_threshold: number;
}
export interface PropertyImportMappingProfile {
    source_type: string;
    profile_name: string | null;
    field_mappings: PropertyImportFieldMapping[];
    review_settings: PropertyImportReviewSettings;
    source_record: PropertyImportRecord | null;
}
export interface PropertyImportReviewMetadata {
    status: PropertyImportReviewStatus;
    confidence_hints: PropertyImportReviewHint[];
    review_notes: string | null;
    reviewed_by_user_id: string | null;
    reviewed_at: string | null;
    approved_at: string | null;
}
export interface PropertyImportNormalizedDraftData extends PropertyImportRecord {
    import_mapping?: PropertyImportMappingProfile | null;
    import_review?: PropertyImportReviewMetadata | null;
}
export declare function normalizePropertyImportMappingProfile(value: unknown): PropertyImportMappingProfile | null;
export declare function normalizePropertyImportReviewMetadata(value: unknown, mapping: PropertyImportMappingProfile | null): PropertyImportReviewMetadata | null;
export declare function normalizePropertyImportDraftData(nextDraftData: PropertyImportRecord, existingDraftData?: PropertyImportRecord | null): PropertyImportNormalizedDraftData;
export declare function isPropertyImportReviewPending(draftData: PropertyImportRecord | null | undefined): boolean;
export declare function isPropertyImportReviewApproved(draftData: PropertyImportRecord | null | undefined): boolean;
export declare function hasPropertyImportMappingMetadata(draftData: PropertyImportRecord | null | undefined): boolean;
export {};
//# sourceMappingURL=propertyImport.metadata.d.ts.map