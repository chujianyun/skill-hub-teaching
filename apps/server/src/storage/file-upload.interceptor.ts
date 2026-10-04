import { CallHandler, ExecutionContext, Injectable, NestInterceptor, PayloadTooLargeException, Type } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';

/** 解析 multipart 单文件字段 file（内存存储）；超过 maxBytes 时返回 413 与给定的中文提示。 */
export function fileUploadInterceptor(maxBytes: number, tooLargeMessage: string): Type<NestInterceptor> {
  const MulterInterceptor = FileInterceptor('file', { limits: { fileSize: maxBytes, files: 1 } });

  @Injectable()
  class FileUploadInterceptor implements NestInterceptor {
    private readonly multer = new MulterInterceptor();

    async intercept(context: ExecutionContext, next: CallHandler) {
      try {
        return await this.multer.intercept(context, next);
      } catch (err) {
        if (err instanceof PayloadTooLargeException) {
          // 读完并丢弃剩余请求体，否则提前返回 413 时客户端仍在上传，连接会被重置（ECONNRESET）
          context.switchToHttp().getRequest<Request>().resume();
          throw new PayloadTooLargeException(tooLargeMessage);
        }
        throw err;
      }
    }
  }
  return FileUploadInterceptor;
}
