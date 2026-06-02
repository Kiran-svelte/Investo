"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizePropertyImportMappingProfile = normalizePropertyImportMappingProfile;
exports.normalizePropertyImportReviewMetadata = normalizePropertyImportReviewMetadata;
exports.normalizePropertyImportDraftData = normalizePropertyImportDraftData;
exports.isPropertyImportReviewPending = isPropertyImportReviewPending;
exports.isPropertyImportReviewApproved = isPropertyImportReviewApproved;
exports.hasPropertyImportMappingMetadata = hasPropertyImportMappingMetadata;
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function asString(value) {
    if (typeof value !== 'string') {
        return null;
    }
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
}
function asBoolean(value, fallback = false) {
    if (typeof value === 'boolean') {
        return value;
    }
    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (normalized === 'true') {
            return true;
        }
        if (normalized === 'false') {
            return false;
        }
    }
    return fallback;
}
function normalizeConfidence(value) {
    if (typeof value === 'number' && Number.isFinite(value)) {
        const normalized = value > 1 ? value / 100 : value;
        return Math.min(1, Math.max(0, normalized));
    }
    if (typeof value === 'string' && value.trim()) {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) {
            const normalized = parsed > 1 ? parsed / 100 : parsed;
            return Math.min(1, Math.max(0, normalized));
        }
    }
    return null;
}
function normalizeFieldMappings(value) {
    if (!Array.isArray(value)) {
        return [];
    }
    return value
        .map((item) => {
        if (!isRecord(item)) {
            return null;
        }
        const sourceField = asString(item.source_field) || asString(item.sourceField);
        const targetField = asString(item.target_field) || asString(item.targetField);
        if (!sourceField || !targetField) {
            return null;
        }
        return {
            source_field: sourceField,
            target_field: targetField,
            confidence: normalizeConfidence(item.confidence),
            required: asBoolean(item.required, false),
            label: asString(item.label),
            notes: asString(item.notes),
        };
    })
        .filter((item) => Boolean(item));
}
function normalizeReviewSettings(value, fallback) {
    const source = isRecord(value) ? value : {};
    const fallbackSettings = fallback || {
        confidence_threshold: 0.75,
        require_human_review: true,
        low_confidence_threshold: 0.55,
    };
    return {
        confidence_threshold: normalizeConfidence(source.confidence_threshold)
            ?? normalizeConfidence(source.confidenceThreshold)
            ?? fallbackSettings.confidence_threshold,
        require_human_review: asBoolean(source.require_human_review ?? source.requireHumanReview, fallbackSettings.require_human_review),
        low_confidence_threshold: normalizeConfidence(source.low_confidence_threshold)
            ?? normalizeConfidence(source.lowConfidenceThreshold)
            ?? fallbackSettings.low_confidence_threshold,
    };
}
function normalizeReviewHints(value) {
    if (!Array.isArray(value)) {
        return [];
    }
    return value
        .map((item) => {
        if (!isRecord(item)) {
            return null;
        }
        const field = asString(item.field) || asString(item.field_name) || asString(item.target_field);
        const confidence = normalizeConfidence(item.confidence);
        if (!field || confidence === null) {
            return null;
        }
        return {
            field,
            confidence,
            source_field: asString(item.source_field) || asString(item.sourceField),
            note: asString(item.note) || asString(item.reason),
        };
    })
        .filter((item) => Boolean(item));
}
function collectDerivedHints(mapping) {
    if (!mapping) {
        return [];
    }
    return mapping.field_mappings
        .filter((fieldMapping) => fieldMapping.confidence !== null)
        .filter((fieldMapping) => fieldMapping.confidence < mapping.review_settings.confidence_threshold)
        .map((fieldMapping) => ({
        field: fieldMapping.target_field,
        confidence: fieldMapping.confidence,
        source_field: fieldMapping.source_field,
        note: fieldMapping.notes,
    }));
}
function normalizePropertyImportMappingProfile(value) {
    if (!isRecord(value)) {
        return null;
    }
    const fieldMappings = normalizeFieldMappings(value.field_mappings ?? value.fieldMappings);
    const sourceType = asString(value.source_type) || asString(value.sourceType) || 'manual';
    const profileName = asString(value.profile_name) || asString(value.profileName);
    const reviewSettings = normalizeReviewSettings(value.review_settings ?? value.reviewSettings);
    const sourceRecord = isRecord(value.source_record ?? value.sourceRecord)
        ? (value.source_record ?? value.sourceRecord)
        : null;
    if (!sourceType && fieldMappings.length === 0 && !sourceRecord) {
        return null;
    }
    return {
        source_type: sourceType || 'manual',
        profile_name: profileName,
        field_mappings: fieldMappings,
        review_settings: reviewSettings,
        source_record: sourceRecord,
    };
}
function normalizePropertyImportReviewMetadata(value, mapping) {
    const source = isRecord(value) ? value : {};
    const explicitHints = normalizeReviewHints(source.confidence_hints ?? source.confidenceHints);
    const derivedHints = collectDerivedHints(mapping);
    const confidenceHints = [...explicitHints, ...derivedHints].filter((hint, index, items) => (items.findIndex((item) => item.field === hint.field && item.source_field === hint.source_field) === index));
    const explicitStatus = asString(source.status);
    const status = explicitStatus === 'approved' || explicitStatus === 'needs_review' || explicitStatus === 'not_required'
        ? explicitStatus
        : confidenceHints.length > 0
            ? 'needs_review'
            : 'not_required';
    const reviewNotes = asString(source.review_notes) || asString(source.reviewNotes);
    const reviewedByUserId = asString(source.reviewed_by_user_id) || asString(source.reviewedByUserId);
    const reviewedAt = asString(source.reviewed_at) || asString(source.reviewedAt);
    const approvedAt = asString(source.approved_at) || asString(source.approvedAt);
    if (!mapping && confidenceHints.length === 0 && !reviewNotes && !reviewedAt && !approvedAt && !explicitStatus) {
        return null;
    }
    return {
        status,
        confidence_hints: confidenceHints,
        review_notes: reviewNotes,
        reviewed_by_user_id: reviewedByUserId,
        reviewed_at: reviewedAt,
        approved_at: approvedAt,
    };
}
function normalizePropertyImportDraftData(nextDraftData, existingDraftData) {
    const mergedDraftData = {
        ...(existingDraftData && isRecord(existingDraftData) ? existingDraftData : {}),
        ...(isRecord(nextDraftData) ? nextDraftData : {}),
    };
    const mapping = normalizePropertyImportMappingProfile(mergedDraftData.import_mapping ?? mergedDraftData.importMapping);
    const review = normalizePropertyImportReviewMetadata(mergedDraftData.import_review ?? mergedDraftData.importReview, mapping);
    if (mapping) {
        mergedDraftData.import_mapping = mapping;
    }
    else {
        delete mergedDraftData.import_mapping;
        delete mergedDraftData.importMapping;
    }
    if (review) {
        mergedDraftData.import_review = review;
    }
    else {
        delete mergedDraftData.import_review;
        delete mergedDraftData.importReview;
    }
    return mergedDraftData;
}
function isPropertyImportReviewPending(draftData) {
    const mapping = normalizePropertyImportMappingProfile(draftData?.import_mapping ?? draftData?.importMapping);
    const review = normalizePropertyImportReviewMetadata(draftData?.import_review ?? draftData?.importReview, mapping);
    return review?.status === 'needs_review';
}
function isPropertyImportReviewApproved(draftData) {
    const mapping = normalizePropertyImportMappingProfile(draftData?.import_mapping ?? draftData?.importMapping);
    const review = normalizePropertyImportReviewMetadata(draftData?.import_review ?? draftData?.importReview, mapping);
    return review?.status === 'approved';
}
function hasPropertyImportMappingMetadata(draftData) {
    return Boolean(normalizePropertyImportMappingProfile(draftData?.import_mapping ?? draftData?.importMapping));
}
