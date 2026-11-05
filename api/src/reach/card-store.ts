import {
  GetObjectCommand,
  NoSuchKey,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

export const CARD_STORE = Symbol("CARD_STORE");

export interface CardStore {
  put(key: string, body: Buffer, mime: string): Promise<void>;
  /** null when the object is not there. */
  get(key: string): Promise<Buffer | null>;
}

/**
 * Share cards live in the VOICES Spaces bucket (V-3) under share/. Config from env, never committed:
 * SPACES_ENDPOINT, SPACES_REGION, SPACES_BUCKET, SPACES_KEY, SPACES_SECRET. Cards hold text and brand only, so they are
 * served by this API (GET /share/{code}/card) with a long cache header, and the bucket stays private.
 */
export class SpacesCardStore implements CardStore {
  private client?: S3Client;

  private cfg() {
    const bucket = process.env.SPACES_BUCKET;
    if (!bucket || !process.env.SPACES_KEY || !process.env.SPACES_SECRET)
      throw new Error("share card storage is not configured (SPACES_*)");
    this.client ??= new S3Client({
      endpoint: process.env.SPACES_ENDPOINT,
      region: process.env.SPACES_REGION ?? "us-east-1",
      forcePathStyle: false,
      credentials: {
        accessKeyId: process.env.SPACES_KEY,
        secretAccessKey: process.env.SPACES_SECRET,
      },
    });
    return { client: this.client, bucket };
  }

  async put(key: string, body: Buffer, mime: string): Promise<void> {
    const { client, bucket } = this.cfg();
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentType: mime,
        CacheControl: "public, max-age=31536000, immutable",
      }),
    );
  }

  async get(key: string): Promise<Buffer | null> {
    const { client, bucket } = this.cfg();
    try {
      const out = await client.send(
        new GetObjectCommand({ Bucket: bucket, Key: key }),
      );
      return out.Body
        ? Buffer.from(await out.Body.transformToByteArray())
        : null;
    } catch (e) {
      if (
        e instanceof NoSuchKey ||
        (e as { name?: string }).name === "NoSuchKey"
      )
        return null;
      throw e;
    }
  }
}
