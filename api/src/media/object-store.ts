import { randomUUID } from "node:crypto";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectAclCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  GET_TTL_SECONDS,
  PUT_TTL_SECONDS,
  makeClient,
  playbackUrl,
} from "../audio-ref/spaces";

export const MEDIA_STORE = Symbol("MEDIA_STORE");
export const TRANSCRIBER = Symbol("TRANSCRIBER");

/** Photos are written under file/<kind>/ and read through the public CDN link; nothing else is ever public. */
export const PUBLIC_KEY_PREFIX = "file/";
/** The kinds read through SPACES_CDN_BASE. RESULT_PHOTO (V-8, team only), exports, cards and videos stay private. */
export const PUBLIC_FILE_KINDS: readonly string[] = [
  "AVATAR",
  "OVERRIDE_IMAGE",
  "AD_CREATIVE",
];

export function isPublicPhoto(f: { kind: string; key: string }): boolean {
  return (
    PUBLIC_FILE_KINDS.includes(f.kind) && f.key.startsWith(PUBLIC_KEY_PREFIX)
  );
}

/**
 * Makes a confirmed photo public. Never throws: a provider error is logged once and the caller carries on; the next
 * confirm or complete for the same file tries again. Returns whether the object is now public.
 */
export async function publishPhoto(
  store: ObjectStore,
  f: { id: string; kind: string; key: string },
  log: { warn(m: string): void },
): Promise<boolean> {
  if (!isPublicPhoto(f)) return false;
  try {
    await store.makePublic(f.key);
    return true;
  } catch (e) {
    log.warn(
      `makePublic ${f.id} failed, will retry on the next attach: ${String(e)}`,
    );
    return false;
  }
}

export interface SignedPut {
  key: string;
  url: string;
  headers: Record<string, string>;
  expiresAt: Date;
}

/** The VOICES Spaces bucket (V-3). Tests swap it for an in-memory store; production uses SpacesStore. */
export interface ObjectStore {
  /** A presigned PUT for one object; Content-Type and Content-Length are signed. */
  presignPut(
    prefix: string,
    contentType: string,
    sizeBytes: number,
  ): Promise<SignedPut>;
  /** Size in bytes, or null when the object is not there. */
  head(key: string): Promise<number | null>;
  get(key: string): Promise<Buffer>;
  /** Stores the normalised clip under voice/<uuid>.m4a and returns the key. */
  putPlay(body: Buffer): Promise<string>;
  /** Stores a made video under video/<uuid>.mp4 (private) and returns the key. */
  putVideo(body: Buffer): Promise<string>;
  delete(key: string): Promise<void>;
  /**
   * Sets one object to public-read so the CDN link serves it. Only keys under file/ (a photo); anything else throws,
   * so a voice clip or an export can never be opened through this. Safe to repeat.
   */
  makePublic(key: string): Promise<void>;
  /** Short-lived signed GET, inline disposition. */
  signedGet(key: string): Promise<{ url: string; expiresAt: Date }>;
}

/** DigitalOcean Spaces through the S3 API. Built only when SPACES_* are all set. */
export class SpacesStore implements ObjectStore {
  private readonly s3: S3Client;
  constructor(
    private readonly bucket: string,
    env: NodeJS.ProcessEnv = process.env,
  ) {
    this.s3 = makeClient(env);
  }

  static fromEnv(env: NodeJS.ProcessEnv = process.env): SpacesStore | null {
    const need = [
      "SPACES_ENDPOINT",
      "SPACES_BUCKET",
      "SPACES_KEY",
      "SPACES_SECRET",
    ];
    if (need.some((k) => !env[k])) return null;
    return new SpacesStore(env.SPACES_BUCKET as string, env);
  }

  async presignPut(
    prefix: string,
    contentType: string,
    sizeBytes: number,
  ): Promise<SignedPut> {
    const key = `${prefix}/${randomUUID()}`;
    const url = await getSignedUrl(
      this.s3,
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ContentType: contentType,
        ContentLength: sizeBytes,
      }),
      { expiresIn: PUT_TTL_SECONDS },
    );
    return {
      key,
      url,
      headers: { "Content-Type": contentType },
      expiresAt: new Date(Date.now() + PUT_TTL_SECONDS * 1000),
    };
  }

  async head(key: string): Promise<number | null> {
    try {
      const h = await this.s3.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return h.ContentLength ?? 0;
    } catch (e) {
      const c = e as { name?: string; $metadata?: { httpStatusCode?: number } };
      if (c.name === "NotFound" || c.$metadata?.httpStatusCode === 404)
        return null;
      throw e;
    }
  }

  async get(key: string): Promise<Buffer> {
    const o = await this.s3.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    return Buffer.from(
      await (
        o.Body as { transformToByteArray(): Promise<Uint8Array> }
      ).transformToByteArray(),
    );
  }

  async putPlay(body: Buffer): Promise<string> {
    const key = `voice/${randomUUID()}.m4a`;
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: "audio/mp4",
        CacheControl: "private, max-age=900",
        ContentDisposition: "inline",
      }),
    );
    return key;
  }

  async putVideo(body: Buffer): Promise<string> {
    const key = `video/${randomUUID()}.mp4`;
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: "video/mp4",
        CacheControl: "private, no-store",
        ContentDisposition: "inline",
      }),
    );
    return key;
  }

  async delete(key: string): Promise<void> {
    await this.s3.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
    );
  }

  async makePublic(key: string): Promise<void> {
    if (!key.startsWith(PUBLIC_KEY_PREFIX))
      throw new Error("makePublic refuses a key outside file/");
    await this.s3.send(
      new PutObjectAclCommand({
        Bucket: this.bucket,
        Key: key,
        ACL: "public-read",
      }),
    );
  }

  async signedGet(key: string): Promise<{ url: string; expiresAt: Date }> {
    return {
      url: await playbackUrl(this.s3, this.bucket, key),
      expiresAt: new Date(Date.now() + GET_TTL_SECONDS * 1000),
    };
  }
}
