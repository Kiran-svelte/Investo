import express, { Router, Request, Response, NextFunction } from 'express';
import config from '../config';
import prisma from '../config/prisma';

class PropertyImportUploadError extends Error {
  statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.statusCode = statusCode;
  }
}

function normalizeContentType(value: string | undefined): string {
  if (!value) {
    return '';
  }

  return value.split(';')[0].trim().toLowerCase();
}

function buildContentDisposition(fileName: string | null | undefined): string {
  const raw = (fileName || 'upload').replace(/[\r\n]/g, ' ').trim() || 'upload';
  const fallback = raw
    .replace(/[\\"]/g, '_')
    .replace(/[^\x20-\x7E]+/g, '_')
    .slice(0, 180) || 'upload';

  const encoded = encodeURIComponent(raw);
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

function toDatabaseBytes(buffer: Buffer): Uint8Array<ArrayBuffer> {
  const arrayBuffer = new ArrayBuffer(buffer.byteLength);
  const out = new Uint8Array(arrayBuffer);
  out.set(buffer);
  return out;
}

const router = Router();

router.put(
  '/:uploadToken',
  express.raw({
    type: '*/*',
    limit: config.storage.propertyUploadMaxBytes,
  }),
  async (req: Request, res: Response) => {
    try {
      const uploadToken = String(req.params.uploadToken || '').trim();
      const contentType = normalizeContentType(req.header('content-type'));

      if (!uploadToken) {
        throw new PropertyImportUploadError('Upload token is required', 400);
      }

      if (!contentType) {
        throw new PropertyImportUploadError('Content-Type header is required', 400);
      }

      if (!Buffer.isBuffer(req.body)) {
        throw new PropertyImportUploadError('Invalid upload body', 400);
      }

      const bytes = req.body as Buffer;
      if (bytes.length <= 0) {
        throw new PropertyImportUploadError('Upload body is empty', 400);
      }

      await prisma.$transaction(async (tx) => {
        const media = await tx.propertyImportMedia.findUnique({
          where: { uploadToken },
          select: {
            id: true,
            companyId: true,
            status: true,
            mimeType: true,
            storageKey: true,
          },
        });

        if (!media) {
          throw new PropertyImportUploadError('Upload token not found', 404);
        }

        if (media.status !== 'upload_requested') {
          throw new PropertyImportUploadError('Upload has already been completed', 409);
        }

        if (!media.storageKey.startsWith('db/property-import-media/')) {
          throw new PropertyImportUploadError('Direct upload is not available for this token', 409);
        }

        const expectedContentType = normalizeContentType(media.mimeType);
        if (expectedContentType !== contentType) {
          throw new PropertyImportUploadError('Content-Type does not match registered mime type', 400);
        }

        await tx.propertyImportMediaBlob.create({
          data: {
            mediaId: media.id,
            companyId: media.companyId,
            mimeType: media.mimeType,
            fileSize: bytes.length,
            bytes: toDatabaseBytes(bytes),
          },
        });

        await tx.propertyImportMedia.update({
          where: { id: media.id },
          data: {
            status: 'uploaded',
            uploadedAt: new Date(),
            failureReason: null,
          },
        });
      });

      res.status(200).json({ ok: true });
    } catch (err: any) {
      if (err instanceof PropertyImportUploadError) {
        res.status(err.statusCode).json({ error: err.message });
        return;
      }

      if (err?.code === 'P2002') {
        res.status(409).json({ error: 'Upload has already been completed' });
        return;
      }

      res.status(500).json({ error: 'Failed to upload file' });
    }
  },
);

router.get('/:uploadToken', async (req: Request, res: Response) => {
  try {
    const uploadToken = String(req.params.uploadToken || '').trim();

    if (!uploadToken) {
      throw new PropertyImportUploadError('Upload token is required', 400);
    }

    const media = await prisma.propertyImportMedia.findUnique({
      where: { uploadToken },
      select: {
        id: true,
        fileName: true,
        mimeType: true,
        storageKey: true,
      },
    });

    if (!media) {
      throw new PropertyImportUploadError('Upload token not found', 404);
    }

    if (!media.storageKey.startsWith('db/property-import-media/')) {
      throw new PropertyImportUploadError('File not found', 404);
    }

    const blob = await prisma.propertyImportMediaBlob.findUnique({
      where: { mediaId: media.id },
      select: {
        bytes: true,
        mimeType: true,
        fileSize: true,
      },
    });

    if (!blob?.bytes) {
      throw new PropertyImportUploadError('File not found', 404);
    }

    const body = Buffer.isBuffer(blob.bytes) ? blob.bytes : Buffer.from(blob.bytes);

    res.setHeader('Content-Type', blob.mimeType || media.mimeType);
    res.setHeader('Content-Length', String(blob.fileSize || body.length));
    res.setHeader('Content-Disposition', buildContentDisposition(media.fileName));
    res.status(200).send(body);
  } catch (err: any) {
    if (err instanceof PropertyImportUploadError) {
      res.status(err.statusCode).json({ error: err.message });
      return;
    }

    res.status(500).json({ error: 'Failed to fetch file' });
  }
});

// Handle body-parser errors (e.g., file too large) within this router.
router.use((err: any, _req: Request, res: Response, next: NextFunction) => {
  if (err?.type === 'entity.too.large') {
    res.status(413).json({ error: 'File exceeds maximum allowed size' });
    return;
  }

  next(err);
});

export default router;


