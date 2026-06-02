"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.propertyImportExtractorService = exports.PropertyImportExtractorService = void 0;
const config_1 = __importDefault(require("../config"));
const logger_1 = __importDefault(require("../config/logger"));
const storage_service_1 = require("./storage.service");
const pdfParse = require('pdf-parse');
const PROPERTY_TYPES = ['villa', 'apartment', 'plot', 'commercial'];
const PROPERTY_STATUSES = ['available', 'sold', 'upcoming'];
class PropertyImportExtractorService {
    constructor(deps = {}) {
        this.deps = deps;
    }
    async extractMedia(input) {
        const sourceText = await this.loadSourceText(input);
        const heuristicResult = this.buildHeuristicResult(input, sourceText);
        if (!sourceText) {
            return heuristicResult;
        }
        const modelResult = await this.tryOpenAIExtraction(input, sourceText, heuristicResult);
        return modelResult || heuristicResult;
    }
    async loadSourceText(input) {
        if (input.media.mimeType !== 'application/pdf' && !input.media.fileName.toLowerCase().endsWith('.pdf')) {
            return '';
        }
        try {
            let pdfBuffer;
            if (this.deps.storage) {
                pdfBuffer = await this.deps.storage.getObjectBuffer(input.media.storageKey);
            }
            else {
                const fetchImpl = this.deps.fetch || fetch;
                const response = await fetchImpl(input.media.publicUrl);
                if (!response.ok) {
                    throw new Error(`Failed to download media: ${response.status}`);
                }
                pdfBuffer = Buffer.from(await response.arrayBuffer());
            }
            const pdfParser = this.deps.pdfParse || pdfParse;
            const parsed = await pdfParser(pdfBuffer);
            return typeof parsed?.text === 'string' ? parsed.text : '';
        }
        catch (error) {
            logger_1.default.warn('Property import brochure text extraction failed', {
                draftId: input.draftId,
                mediaId: input.mediaId,
                error: error?.message || String(error),
            });
            return '';
        }
    }
    async tryOpenAIExtraction(input, sourceText, heuristicResult) {
        if (!config_1.default.ai.openaiApiKey) {
            return null;
        }
        try {
            const response = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${config_1.default.ai.openaiApiKey}`,
                },
                body: JSON.stringify({
                    model: config_1.default.ai.openaiModel,
                    response_format: { type: 'json_object' },
                    temperature: 0.2,
                    max_tokens: 1600,
                    messages: [
                        {
                            role: 'system',
                            content: [
                                'You extract structured real-estate brochure data for a property import workflow.',
                                'Return valid JSON only.',
                                'Human approval is always required before publish, so reviewRequired must always be true.',
                                'Use the brochure text to fill as many property fields as possible.',
                                'Prefer explicit values from the brochure over guesses.',
                                'If a field is unknown, use null.',
                            ].join(' '),
                        },
                        {
                            role: 'user',
                            content: [
                                `File name: ${input.media.fileName}`,
                                `Mime type: ${input.media.mimeType}`,
                                '',
                                'Known draft data that should be preserved if already set:',
                                JSON.stringify(input.draftData || {}, null, 2),
                                '',
                                'Extracted brochure text:',
                                this.limitText(sourceText, 18000),
                            ].join('\n'),
                        },
                    ],
                }),
            });
            if (!response.ok) {
                throw new Error(`OpenAI extraction failed: ${response.status}`);
            }
            const payload = await response.json();
            const content = payload.choices?.[0]?.message?.content || '';
            const parsed = this.parseExtractionPayload(content);
            if (!parsed) {
                return null;
            }
            return this.mergeExtractionResults(heuristicResult, parsed, input, sourceText);
        }
        catch (error) {
            logger_1.default.warn('OpenAI property import extraction failed', {
                draftId: input.draftId,
                mediaId: input.mediaId,
                error: error?.message || String(error),
            });
            return null;
        }
    }
    parseExtractionPayload(rawText) {
        const payloadText = this.extractJsonPayload(rawText);
        if (!payloadText) {
            return null;
        }
        try {
            return JSON.parse(payloadText);
        }
        catch {
            return null;
        }
    }
    mergeExtractionResults(heuristicResult, parsed, input, sourceText) {
        const structuredData = this.normalizeStructuredData({
            ...heuristicResult.structuredData,
            ...(parsed.structuredData && typeof parsed.structuredData === 'object' && !Array.isArray(parsed.structuredData)
                ? parsed.structuredData
                : {}),
        }, input.media.fileName);
        const confidenceHints = this.normalizeConfidenceHints(Array.isArray(parsed.confidenceHints) ? parsed.confidenceHints : heuristicResult.confidenceHints, structuredData);
        return {
            structuredData,
            confidenceHints,
            reviewRequired: true,
            metadata: {
                ...heuristicResult.metadata,
                ...(parsed.metadata && typeof parsed.metadata === 'object' && !Array.isArray(parsed.metadata) ? parsed.metadata : {}),
                sourceType: 'openai',
                fileName: input.media.fileName,
                mimeType: input.media.mimeType,
                textLength: sourceText.length,
            },
        };
    }
    buildHeuristicResult(input, sourceText) {
        const structuredData = this.normalizeStructuredData(this.extractPropertyFieldsFromText(sourceText, input.media.fileName), input.media.fileName);
        const confidenceHints = this.normalizeConfidenceHints(undefined, structuredData);
        return {
            structuredData,
            confidenceHints,
            reviewRequired: true,
            metadata: {
                sourceType: sourceText ? 'heuristic' : 'filename',
                fileName: input.media.fileName,
                mimeType: input.media.mimeType,
                textLength: sourceText.length,
            },
        };
    }
    normalizeStructuredData(value, fileName) {
        const fallback = this.extractPropertyFieldsFromText('', fileName);
        const merged = this.mergeRecordValues(fallback, value);
        return {
            name: this.asNullableString(merged.name) || this.fileNameToTitle(fileName),
            builder: this.asNullableString(merged.builder),
            location_city: this.asNullableString(merged.location_city ?? merged.locationCity),
            location_area: this.asNullableString(merged.location_area ?? merged.locationArea),
            location_pincode: this.asNullableString(merged.location_pincode ?? merged.locationPincode),
            price_min: this.asNullableNumber(merged.price_min ?? merged.priceMin),
            price_max: this.asNullableNumber(merged.price_max ?? merged.priceMax),
            bedrooms: this.asNullableInt(merged.bedrooms),
            property_type: this.asPropertyType(merged.property_type ?? merged.propertyType),
            amenities: this.asStringArray(merged.amenities),
            description: this.asNullableString(merged.description),
            rera_number: this.asNullableString(merged.rera_number ?? merged.reraNumber),
            status: this.asPropertyStatus(merged.status),
            latitude: this.asNullableNumber(merged.latitude),
            longitude: this.asNullableNumber(merged.longitude),
        };
    }
    normalizeConfidenceHints(value, structuredData) {
        if (!Array.isArray(value)) {
            return Object.entries(structuredData)
                .filter(([, item]) => item !== null && item !== undefined && item !== '')
                .map(([field, item]) => ({
                field,
                confidence: typeof item === 'string' ? 0.82 : 0.76,
                source_field: field,
                note: 'Extracted from brochure text',
            }));
        }
        return value
            .map((item) => {
            if (typeof item !== 'object' || item === null || Array.isArray(item)) {
                return null;
            }
            const record = item;
            const field = this.asNullableString(record.field) || this.asNullableString(record.field_name) || this.asNullableString(record.target_field);
            const confidence = this.asNormalizedConfidence(record.confidence);
            if (!field || confidence === null) {
                return null;
            }
            return {
                field,
                confidence,
                source_field: this.asNullableString(record.source_field) || this.asNullableString(record.sourceField),
                note: this.asNullableString(record.note) || this.asNullableString(record.reason),
            };
        })
            .filter(Boolean);
    }
    extractJsonPayload(rawText) {
        const fenced = rawText.match(/```json\s*([\s\S]*?)```/i);
        if (fenced?.[1]) {
            return fenced[1].trim();
        }
        const block = rawText.match(/\{[\s\S]*\}/);
        if (block?.[0]) {
            return block[0].trim();
        }
        return null;
    }
    extractPropertyFieldsFromText(sourceText, fileName) {
        const normalizedText = sourceText.replace(/\s+/g, ' ').trim();
        const lines = sourceText
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean);
        const firstLine = lines.find((line) => /[A-Za-z]/.test(line)) || this.fileNameToTitle(fileName);
        const priceMatches = [...normalizedText.matchAll(/₹\s*([0-9.,]+)\s*(cr|crore|crs|l|lac|lakh|lakhs)?/gi)];
        const priceValues = priceMatches
            .map((match) => this.parseIndianCurrency(match[1], match[2]))
            .filter((value) => value !== null);
        const bedroomsMatch = normalizedText.match(/(\d+)\s*BHK/i);
        const propertyType = this.asPropertyType(normalizedText.match(/\b(villa|apartment|plot|commercial)\b/i)?.[1] || null);
        const reraMatch = normalizedText.match(/\bRERA\b[:\s-]*([A-Z0-9\/.-]+)/i);
        const locationCity = this.extractLabelValue(lines, ['city', 'location', 'project location']) || null;
        const locationArea = this.extractLabelValue(lines, ['area', 'locality', 'neighbourhood', 'neighborhood']) || null;
        const pincodeMatch = normalizedText.match(/\b\d{6}\b/);
        const amenities = this.extractAmenities(lines);
        const description = this.extractDescription(lines, normalizedText);
        const coordinates = this.extractCoordinates(normalizedText);
        return {
            name: firstLine || 'Untitled property',
            builder: this.extractLabelValue(lines, ['builder', 'developer', 'by']),
            location_city: locationCity,
            location_area: locationArea,
            location_pincode: pincodeMatch?.[0] || null,
            price_min: priceValues[0] || null,
            price_max: priceValues.length > 1 ? priceValues[priceValues.length - 1] : priceValues[0] || null,
            bedrooms: bedroomsMatch ? Number(bedroomsMatch[1]) : null,
            property_type: propertyType,
            amenities,
            description,
            rera_number: reraMatch?.[1] || null,
            status: 'available',
            latitude: coordinates.latitude,
            longitude: coordinates.longitude,
        };
    }
    extractLabelValue(lines, labels) {
        for (const line of lines) {
            const lower = line.toLowerCase();
            if (labels.some((label) => lower.includes(label))) {
                const value = line.split(/[:\-]/).pop()?.trim();
                if (value && value.length > 1) {
                    return value;
                }
            }
        }
        return null;
    }
    extractAmenities(lines) {
        const amenitiesLine = lines.find((line) => /amenit/i.test(line));
        if (!amenitiesLine) {
            return [];
        }
        const value = amenitiesLine.split(/[:\-]/).pop()?.trim() || '';
        const candidates = value.includes(',') ? value.split(',') : value.split(/\s{2,}|\|/);
        return candidates
            .map((item) => item.trim())
            .filter(Boolean)
            .slice(0, 12);
    }
    extractDescription(lines, text) {
        const joined = lines.join(' ');
        const shortText = joined.length > 500 ? `${joined.slice(0, 500)}...` : joined;
        return shortText || this.limitText(text, 500) || null;
    }
    extractCoordinates(text) {
        const latitudeMatch = text.match(/\b(?:lat|latitude)\b[:\s-]*(-?\d{1,2}\.\d{4,})/i);
        const longitudeMatch = text.match(/\b(?:lng|lon|longitude)\b[:\s-]*(-?\d{1,3}\.\d{4,})/i);
        return {
            latitude: latitudeMatch ? Number(latitudeMatch[1]) : null,
            longitude: longitudeMatch ? Number(longitudeMatch[1]) : null,
        };
    }
    parseIndianCurrency(value, unit) {
        const normalized = Number(value.replace(/,/g, ''));
        if (!Number.isFinite(normalized)) {
            return null;
        }
        const suffix = (unit || '').toLowerCase();
        if (suffix.startsWith('cr')) {
            return Math.round(normalized * 10000000);
        }
        if (suffix.startsWith('l')) {
            return Math.round(normalized * 100000);
        }
        return Math.round(normalized);
    }
    mergeRecordValues(base, override) {
        return Object.entries({ ...base, ...override }).reduce((accumulator, [key, value]) => {
            if (value === undefined || value === null || value === '') {
                accumulator[key] = base[key];
                return accumulator;
            }
            accumulator[key] = value;
            return accumulator;
        }, {});
    }
    limitText(text, maxLength) {
        if (text.length <= maxLength) {
            return text;
        }
        return text.slice(0, maxLength);
    }
    fileNameToTitle(fileName) {
        const normalized = fileName
            .replace(/\.[^.]+$/, '')
            .replace(/[-_]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        if (!normalized) {
            return 'Untitled property';
        }
        return normalized
            .split(' ')
            .map((word) => word ? `${word[0].toUpperCase()}${word.slice(1)}` : word)
            .join(' ');
    }
    asNullableString(value) {
        if (typeof value !== 'string') {
            return null;
        }
        const trimmed = value.trim();
        return trimmed ? trimmed : null;
    }
    asNullableNumber(value) {
        if (typeof value === 'number' && Number.isFinite(value)) {
            return value;
        }
        if (typeof value === 'string' && value.trim()) {
            const parsed = Number(value);
            return Number.isFinite(parsed) ? parsed : null;
        }
        return null;
    }
    asNullableInt(value) {
        const numeric = this.asNullableNumber(value);
        if (numeric === null) {
            return null;
        }
        const rounded = Math.floor(numeric);
        return rounded >= 0 ? rounded : null;
    }
    asNormalizedConfidence(value) {
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
    asPropertyType(value) {
        const candidate = this.asNullableString(value);
        if (!candidate) {
            return null;
        }
        return PROPERTY_TYPES.includes(candidate) ? candidate : null;
    }
    asPropertyStatus(value) {
        const candidate = this.asNullableString(value);
        if (!candidate) {
            return 'available';
        }
        return PROPERTY_STATUSES.includes(candidate) ? candidate : 'available';
    }
    asStringArray(value) {
        if (!Array.isArray(value)) {
            return [];
        }
        return value
            .map((item) => this.asNullableString(item))
            .filter((item) => Boolean(item));
    }
}
exports.PropertyImportExtractorService = PropertyImportExtractorService;
exports.propertyImportExtractorService = new PropertyImportExtractorService({
    storage: storage_service_1.storageService,
});
