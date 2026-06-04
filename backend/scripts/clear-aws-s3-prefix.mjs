#!/usr/bin/env node
/**
 * Delete all objects under the Investo S3 prefix.
 * Usage: node scripts/clear-aws-s3-prefix.mjs --confirm
 */
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { DeleteObjectsCommand, ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '.env.render-sync') });

const confirm = process.argv.includes('--confirm');
const bucket = process.env.AWS_S3_BUCKET || 'biginvesto-668764275363-eu-north-1-an';
const prefix = (process.env.AWS_S3_PREFIX || 'investo').replace(/\/?$/, '/') ;
const region = process.env.AWS_REGION || 'eu-north-1';

if (!confirm) {
  console.error('Refusing to run without --confirm');
  process.exit(1);
}

if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
  console.error('AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY required');
  process.exit(1);
}

const client = new S3Client({
  region,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

async function listAllKeys() {
  const keys = [];
  let token;
  do {
    const res = await client.send(new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix,
      ContinuationToken: token,
    }));
    for (const item of res.Contents || []) {
      if (item.Key) keys.push(item.Key);
    }
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);
  return keys;
}

async function main() {
  const keys = await listAllKeys();
  console.log(`Found ${keys.length} objects under s3://${bucket}/${prefix}`);
  if (keys.length === 0) return;

  for (let i = 0; i < keys.length; i += 1000) {
    const batch = keys.slice(i, i + 1000);
    await client.send(new DeleteObjectsCommand({
      Bucket: bucket,
      Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
    }));
  }
  console.log('S3 prefix cleared.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
