import { BadRequestException } from '@nestjs/common';
import { SKILL_MAX_BYTES, SKILL_MAX_MB } from '@skill-hub/shared';
import { fileUploadInterceptor } from '../storage/file-upload.interceptor';

// 上传的是压缩包，限制按解压后计算（skill-package.ts）；这里只给压缩包本身留出余量，挡住明显超大的请求
export const SkillUploadInterceptor = fileUploadInterceptor(SKILL_MAX_BYTES + 5 * 1024 * 1024, `Skill 包不能超过 ${SKILL_MAX_MB}MB`);

/** multipart 字段 file 为 zip；缺失时 400（网页端与客户端上传共用）。 */
export const requireFile = (file: Express.Multer.File | undefined): Buffer => {
  if (!file) throw new BadRequestException('请选择要上传的 Skill 文件夹');
  return file.buffer;
};
