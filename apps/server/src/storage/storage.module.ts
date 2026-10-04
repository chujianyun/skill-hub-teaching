import { Module } from '@nestjs/common';
import { LocalPrivateFileStorage, PrivateFileStorage } from './private-file-storage';
@Module({ providers: [{ provide: PrivateFileStorage, useClass: LocalPrivateFileStorage }], exports: [PrivateFileStorage] })
export class StorageModule {}
