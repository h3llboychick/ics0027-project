import { prisma } from '../prisma';
import { readFileOperationConfig, validateFileEncryptionKey } from './config';
import { OperationRepository } from './operations/repository';
import { OperationCoordinator } from './operations/coordinator';
import { diskStorage } from './storage/disk-storage';

export const fileOperationConfig = readFileOperationConfig();
// Build-time imports must remain possible without production credentials.
// instrumentation.ts and the worker entry validate keys before serving work.
export function validateFileRuntime() { validateFileEncryptionKey(); }
export const operationRepository = new OperationRepository(prisma, fileOperationConfig);
export const operationCoordinator = new OperationCoordinator(operationRepository, diskStorage);
