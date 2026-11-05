import { randomUUID } from "node:crypto";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
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
  delete(key: string): Promise<void>;
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

  async delete(key: string): Promise<void> {
    await this.s3.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
    );
  }

  async signedGet(key: string): Promise<{ url: string; expiresAt: Date }> {
    return {
      url: await playbackUrl(this.s3, this.bucket, key),
      expiresAt: new Date(Date.now() + GET_TTL_SECONDS * 1000),
    };
  }
}
