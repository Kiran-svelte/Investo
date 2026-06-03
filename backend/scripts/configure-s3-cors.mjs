/**
 * Apply S3 CORS so browser PUT uploads work from the Vercel frontend.
 * Loads credentials from .env.render-sync (gitignored).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { PutBucketCorsCommand, S3Client } from '@aws-sdk/client-s3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(backendRoot, '.env.render-sync') });

const bucket = process.env.AWS_S3_BUCKET || 'biginvesto-668764275363-eu-north-1-an';
const region = process.env.AWS_REGION || 'eu-north-1';
const origins = (process.env.S3_CORS_ORIGINS || 'https://frontend-navy-eight-37.vercel.app,http://localhost:3000,http://localhost:5173')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

const client = new S3Client({
  region,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

await client.send(
  new PutBucketCorsCommand({
    Bucket: bucket,
    CORSConfiguration: {
      CORSRules: [
        {
          AllowedHeaders: ['*'],
          AllowedMethods: ['GET', 'PUT', 'HEAD'],
          AllowedOrigins: origins,
          ExposeHeaders: ['ETag'],
          MaxAgeSeconds: 3600,
        },
      ],
    },
  }),
);

console.log('S3_CORS_OK', { bucket, origins });
