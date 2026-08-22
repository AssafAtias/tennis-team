import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import type { ObjectStore } from '../app.js'
import type { Config } from '../config.js'

class S3ObjectStore implements ObjectStore {
  private readonly client: S3Client

  constructor(
    private readonly bucket: string,
    private readonly endpoint: string,
    accessKeyId: string,
    secretAccessKey: string,
  ) {
    this.client = new S3Client({
      region: 'auto',
      endpoint,
      credentials: { accessKeyId, secretAccessKey },
      forcePathStyle: true,
    })
  }

  async presignPut(key: string, contentType: string, maxBytes: number): Promise<string> {
    const cmd = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: contentType,
      ContentLength: maxBytes,
    })
    return getSignedUrl(this.client, cmd, { expiresIn: 300 })
  }

  async get(key: string): Promise<Buffer> {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }))
    return Buffer.from(await res.Body!.transformToByteArray())
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }),
    )
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }))
  }

  publicUrl(key: string): string {
    return `${this.endpoint}/${this.bucket}/${key}`
  }
}

export function createObjectStore(config: Config): ObjectStore {
  const { endpoint, bucket, accessKeyId, secretAccessKey } = config.storage
  if (endpoint && bucket && accessKeyId && secretAccessKey) {
    return new S3ObjectStore(bucket, endpoint, accessKeyId, secretAccessKey)
  }
  if (config.nodeEnv === 'production') {
    throw new Error('Object storage is not configured; profile photo upload would fail in production')
  }
  return new UnconfiguredStore()
}

/** Local development without a bucket: fails loudly at the point of use, not at boot. */
class UnconfiguredStore implements ObjectStore {
  private fail(): never {
    throw new Error('Object storage is not configured. Set STORAGE_* variables to enable photo upload.')
  }
  async presignPut(): Promise<string> {
    this.fail()
  }
  async get(): Promise<Buffer> {
    this.fail()
  }
  async put(): Promise<void> {
    this.fail()
  }
  async delete(): Promise<void> {
    this.fail()
  }
  publicUrl(): string {
    this.fail()
  }
}
