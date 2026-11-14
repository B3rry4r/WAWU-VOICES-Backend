import { randomUUID } from "node:crypto";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { makeClient } from "../audio-ref/spaces";

export const VERIFICATION_STORE = Symbol("VERIFICATION_STORE");

/** Every verification document lives under this prefix, and under no other. */
export const VERIFICATION_PREFIX = "verification/";
/** How long an admin's signed link lives (V-46: 5 minutes). */
export const DOC_LINK_SECONDS = 300;

/**
 * The private bucket for identity documents. Never the public CDN: objects are written with a private ACL and are read
 * only through a short-lived signed link minted for an admin. Tests swap this for an in-memory store.
 */
export interface VerificationStore {
  /** Stores the bytes under verification/<uuid> (private) and returns the key. */
  put(body: Buffer, mime: string): Promise<string>;
  /** Removes one object. Removing a key that is not there is fine. */
  delete(key: string): Promise<void>;
  /** A signed GET that expires in DOC_LINK_SECONDS. */
  signedGet(
    key: string,
    mime: string,
  ): Promise<{ url: string; expiresAt: Date }>;
}

export class SpacesVerificationStore implements VerificationStore {
  private readonly s3: S3Client;
  constructor(
    private readonly bucket: string,
    env: NodeJS.ProcessEnv = process.env,
  ) {
    this.s3 = makeClient(env);
  }

  static fromEnv(
    env: NodeJS.ProcessEnv = process.env,
  ): SpacesVerificationStore | null {
    const need = [
      "SPACES_ENDPOINT",
      "SPACES_BUCKET",
      "SPACES_KEY",
      "SPACES_SECRET",
    ];
    if (need.some((k) => !env[k])) return null;
    return new SpacesVerificationStore(env.SPACES_BUCKET as string, env);
  }

  async put(body: Buffer, mime: string): Promise<string> {
    const key = `${VERIFICATION_PREFIX}${randomUUID()}`;
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: mime,
        ACL: "private",
        CacheControl: "private, no-store",
        ContentDisposition: "inline",
      }),
    );
    return key;
  }

  async delete(key: string): Promise<void> {
    if (!key.startsWith(VERIFICATION_PREFIX))
      throw new Error("verification store refuses a key outside verification/");
    await this.s3.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
    );
  }

  async signedGet(
    key: string,
    mime: string,
  ): Promise<{ url: string; expiresAt: Date }> {
    if (!key.startsWith(VERIFICATION_PREFIX))
      throw new Error("verification store refuses a key outside verification/");
    const url = await getSignedUrl(
      this.s3,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ResponseContentDisposition: "inline",
        ResponseContentType: mime,
        ResponseCacheControl: "private, no-store",
      }),
      { expiresIn: DOC_LINK_SECONDS },
    );
    return { url, expiresAt: new Date(Date.now() + DOC_LINK_SECONDS * 1000) };
  }
}
