import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'node:crypto';

// DigitalOcean Spaces speaks the S3 API. Config from env, never committed:
//   SPACES_ENDPOINT (https://<region>.digitaloceanspaces.com), SPACES_REGION, SPACES_BUCKET,
//   SPACES_KEY, SPACES_SECRET, SPACES_CDN_BASE (optional, the Spaces CDN endpoint)
export function makeClient(env = process.env): S3Client {
  return new S3Client({
    endpoint: env.SPACES_ENDPOINT, region: env.SPACES_REGION ?? 'us-east-1', forcePathStyle: false,
    credentials: { accessKeyId: env.SPACES_KEY ?? '', secretAccessKey: env.SPACES_SECRET ?? '' },
  });
}

export const PUT_TTL_SECONDS = 300;   // the phone has 5 minutes to start the upload
export const GET_TTL_SECONDS = 900;   // a playback URL lives 15 minutes; the app asks again when it lapses

/** Phone uploads the raw recording here (browser format), the server then normalises it to the stored format. */
export async function presignRawUpload(s3: S3Client, bucket: string, contentType: string, sizeBytes: number) {
  const key = `raw/${randomUUID()}`;
  // ContentLength is signed, so the PUT must send exactly this many bytes. Content-Type is signed too.
  const url = await getSignedUrl(s3, new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType, ContentLength: sizeBytes }), { expiresIn: PUT_TTL_SECONDS });
  return { key, url, headers: { 'Content-Type': contentType } };
}

export async function rawSize(s3: S3Client, bucket: string, key: string): Promise<number> {
  const h = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
  return h.ContentLength ?? 0;
}

export async function putNormalised(s3: S3Client, bucket: string, body: Buffer): Promise<string> {
  const key = `voice/${randomUUID()}.m4a`;
  // private object: no public ACL, plays only through a signed URL
  await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: 'audio/mp4', CacheControl: 'private, max-age=900', ContentDisposition: 'inline' }));
  return key;
}

export async function deleteKey(s3: S3Client, bucket: string, key: string) {
  await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}

/** Short-lived signed GET for the <audio> element. The object is private; v4.0 "never downloadable" is met as far as a
 *  browser can: no download control, inline disposition, short expiry, the URL is minted only for a visible post. */
export async function playbackUrl(s3: S3Client, bucket: string, key: string): Promise<string> {
  return getSignedUrl(s3, new GetObjectCommand({ Bucket: bucket, Key: key, ResponseContentDisposition: 'inline', ResponseContentType: 'audio/mp4' }), { expiresIn: GET_TTL_SECONDS });
}
