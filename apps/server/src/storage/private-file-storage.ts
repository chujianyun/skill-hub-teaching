import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';

/**
 * 私有文件存储：文件不经静态路由公开，只能由业务代码按 key 读取后经鉴权接口流出（如 Skill 包）。
 * v1 为本地磁盘实现，日后可换 OSS 而不改调用方。
 */
export abstract class PrivateFileStorage {
  /** 以随机文件名保存，返回存储 key。 */
  abstract save(data: Buffer, ext: string): Promise<string>;

  abstract read(key: string): Promise<Buffer>;

  /** 文件不存在时静默忽略。 */
  abstract delete(key: string): Promise<void>;
}

/** 私有上传目录，与公开的 UPLOAD_DIR 完全分开；环境变量 PRIVATE_UPLOAD_DIR 可覆盖（compose 中挂独立数据卷）。 */
export const privateDir = () => resolve(process.env.PRIVATE_UPLOAD_DIR ?? 'uploads-private');

@Injectable()
export class LocalPrivateFileStorage extends PrivateFileStorage {
  async save(data: Buffer, ext: string): Promise<string> {
    const key = `${randomUUID()}.${ext}`;
    await mkdir(privateDir(), { recursive: true });
    await writeFile(join(privateDir(), key), data);
    return key;
  }

  // basename 防止路径穿越
  read(key: string): Promise<Buffer> {
    return readFile(join(privateDir(), basename(key)));
  }

  async delete(key: string): Promise<void> {
    await rm(join(privateDir(), basename(key)), { force: true });
  }
}
