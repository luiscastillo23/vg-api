import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'node:crypto';

@Injectable()
export class StorageAdapter {
  private readonly s3: S3Client;
  private readonly bucket: string;
  private readonly publicHost: string;

  constructor(private readonly config: ConfigService) {
    this.s3 = new S3Client({
      region: config.getOrThrow('AWS_REGION'),
      credentials: {
        accessKeyId: config.getOrThrow('AWS_ACCESS_KEY_ID'),
        secretAccessKey: config.getOrThrow('AWS_SECRET_ACCESS_KEY'),
      },
    });
    this.bucket = config.getOrThrow('S3_BUCKET');
    this.publicHost = config.getOrThrow('S3_PUBLIC_HOST');
  }

  async putObject(buffer: Buffer, mimeType: string): Promise<string> {
    const key = `uploads/${randomUUID()}`;
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: buffer,
        ContentType: mimeType,
        ACL: 'public-read',
      }),
    );
    return `${this.publicHost}/${key}`;
  }

  async sign(
    filename: string,
    contentType: string,
  ): Promise<{ url: string; publicUrl: string; key: string }> {
    const key = `uploads/${randomUUID()}-${filename}`;
    const url = await getSignedUrl(
      this.s3,
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ContentType: contentType,
      }),
      { expiresIn: 60 * 5 },
    );
    return { url, publicUrl: `${this.publicHost}/${key}`, key };
  }
}
