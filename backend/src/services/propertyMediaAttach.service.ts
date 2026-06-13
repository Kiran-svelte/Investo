import prisma from '../config/prisma';
import logger from '../config/logger';
import { storageService } from './storage.service';
import {
  indexPropertyKnowledge,
  loadPropertyKnowledgeIndexPayload,
} from './propertyKnowledge.service';

export type PropertyMediaRole = 'screenshot' | 'brochure';

const IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const BROCHURE_MIMES = new Set(['application/pdf']);

export class PropertyMediaAttachError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.statusCode = statusCode;
  }
}

export function inferDefaultMediaRole(mimeType: string): PropertyMediaRole {
  if (BROCHURE_MIMES.has(mimeType)) {
    return 'brochure';
  }
  return 'screenshot';
}

export function assertMediaRoleForMime(mediaRole: PropertyMediaRole, mimeType: string): void {
  if (mediaRole === 'screenshot' && !IMAGE_MIMES.has(mimeType)) {
    throw new PropertyMediaAttachError('Screenshots must be JPEG, PNG, or WebP images.', 400);
  }
  if (mediaRole === 'brochure' && !BROCHURE_MIMES.has(mimeType)) {
    throw new PropertyMediaAttachError('Brochures must be PDF files.', 400);
  }
}

export function isPropertyMediaMime(mimeType: string): boolean {
  return IMAGE_MIMES.has(mimeType) || BROCHURE_MIMES.has(mimeType);
}

function parseImagesField(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
  }
  return [];
}

/**
 * Uploads a screenshot or brochure and attaches it to one property in a project.
 * Re-indexes AI knowledge so WhatsApp can use the new media for that unit.
 */
export async function attachMediaToProperty(input: {
  companyId: string;
  projectId: string;
  propertyId: string;
  buffer: Buffer;
  fileName: string;
  mimeType: string;
  mediaRole: PropertyMediaRole;
}) {
  const project = await prisma.propertyProject.findFirst({
    where: { id: input.projectId, companyId: input.companyId },
  });
  if (!project) {
    throw new PropertyMediaAttachError('Project not found', 404);
  }

  const property = await prisma.property.findFirst({
    where: {
      id: input.propertyId,
      companyId: input.companyId,
      projectId: input.projectId,
    },
  });
  if (!property) {
    throw new PropertyMediaAttachError(
      'Property not found in this project. Pick a listing that belongs to the same project board.',
      404,
    );
  }

  assertMediaRoleForMime(input.mediaRole, input.mimeType);

  const uploaded = await storageService.uploadPropertyMediaBuffer({
    companyId: input.companyId,
    propertyId: property.id,
    fileName: input.fileName,
    mimeType: input.mimeType,
    assetType: input.mediaRole === 'brochure' ? 'brochure' : 'image',
    buffer: input.buffer,
  });

  const existingImages = parseImagesField(property.images);
  const updateData =
    input.mediaRole === 'brochure'
      ? { brochureUrl: uploaded.publicUrl }
      : { images: [...existingImages, uploaded.publicUrl] };

  const updated = await prisma.property.update({
    where: { id: property.id },
    data: updateData,
  });

  const indexPayload = await loadPropertyKnowledgeIndexPayload(input.companyId, property.id);
  const knowledge = await indexPropertyKnowledge({
    companyId: input.companyId,
    property: updated,
    draftData: indexPayload.draftData,
    mediaExtractions: indexPayload.mediaExtractions,
  });

  logger.info('Property media attached from project board', {
    companyId: input.companyId,
    projectId: input.projectId,
    propertyId: property.id,
    mediaRole: input.mediaRole,
    knowledgeIndexed: knowledge.ok,
    chunkCount: knowledge.chunkCount,
  });

  return {
    property: updated,
    public_url: uploaded.publicUrl,
    media_role: input.mediaRole,
    knowledge_indexed: knowledge.ok,
    knowledge_chunk_count: knowledge.chunkCount,
  };
}
