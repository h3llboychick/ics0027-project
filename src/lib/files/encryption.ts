import crypto from 'crypto';
import { FileEncryptionError } from './errors';

const FILE_ENCRYPTION_KEK_HEX = process.env.FILE_ENCRYPTION_KEK;
const AES_256_GCM_ALGORITHM = 'aes-256-gcm';
const AES_GCM_IV_LENGTH_BYTES = 12; // https://developer.mozilla.org/en-US/docs/Web/API/AesGcmParams recommend IV to be 96 bits (12 bytes) long
const DATA_ENCRYPTION_KEY_LENGTH_BYTES = 32;

function readKeyEncryptionKey(): Uint8Array<ArrayBuffer> {
    if (!FILE_ENCRYPTION_KEK_HEX || !/^[\da-f]{64}$/i.test(FILE_ENCRYPTION_KEK_HEX)) {
        throw new Error('FILE_ENCRYPTION_KEK must be a 32-byte hexadecimal key.');
    }
    return Buffer.from(FILE_ENCRYPTION_KEK_HEX, 'hex');
}

type AesGcmEncryptedData = {
  iv: Uint8Array<ArrayBuffer>;
  ciphertext: Uint8Array<ArrayBuffer>;
  authTag: Uint8Array<ArrayBuffer>;
};

type EncryptedFile = {
    encryptedContent: AesGcmEncryptedData,
    encryptedDataKey: AesGcmEncryptedData
}

export const aesGcmFileEncryptor = {
    encrypt(plaintext: Uint8Array<ArrayBuffer>): EncryptedFile {
        let kek: Uint8Array<ArrayBuffer> | undefined;
        let dek: Uint8Array<ArrayBuffer> | undefined;

        try {
            kek = readKeyEncryptionKey();
            dek = crypto.randomBytes(DATA_ENCRYPTION_KEY_LENGTH_BYTES);

            const fileContentIV = crypto.randomBytes(AES_GCM_IV_LENGTH_BYTES);
            const dekIV = crypto.randomBytes(AES_GCM_IV_LENGTH_BYTES);

            const fileContentCipher = crypto.createCipheriv(AES_256_GCM_ALGORITHM, dek, fileContentIV);
            const fileContentCiphertext = Buffer.concat([
                fileContentCipher.update(plaintext),
                fileContentCipher.final()
            ])
            const fileContentTag = fileContentCipher.getAuthTag()

            const dekCipher = crypto.createCipheriv(AES_256_GCM_ALGORITHM, kek, dekIV)
            const dekCiphertext = Buffer.concat([
                dekCipher.update(dek),
                dekCipher.final()
            ])
            const dekTag = dekCipher.getAuthTag()

            return {
                encryptedContent: {
                    iv: fileContentIV,
                    ciphertext: fileContentCiphertext,
                    authTag: fileContentTag
                },
                encryptedDataKey: {
                    iv: dekIV,
                    ciphertext: dekCiphertext,
                    authTag: dekTag
                }
            }
        } catch (err) {
            throw new FileEncryptionError('Encryption failed', { cause: err });
        } finally {
            dek?.fill(0);
            kek?.fill(0);
        }
    },
    decrypt(encryptedFile: EncryptedFile): Uint8Array<ArrayBuffer> {
        let kek: Uint8Array<ArrayBuffer> | undefined;
        let dek: Uint8Array<ArrayBuffer> | undefined;

        try {
            kek = readKeyEncryptionKey();
            const dekDecipher = crypto.createDecipheriv(AES_256_GCM_ALGORITHM, kek, encryptedFile.encryptedDataKey.iv)
            dekDecipher.setAuthTag(encryptedFile.encryptedDataKey.authTag)
            dek = Buffer.concat([
                dekDecipher.update(encryptedFile.encryptedDataKey.ciphertext),
                dekDecipher.final()
            ])

            const fileContentsDecipher = crypto.createDecipheriv(AES_256_GCM_ALGORITHM, dek, encryptedFile.encryptedContent.iv)
            fileContentsDecipher.setAuthTag(encryptedFile.encryptedContent.authTag)
            const fileContents = Buffer.concat([
                fileContentsDecipher.update(encryptedFile.encryptedContent.ciphertext),
                fileContentsDecipher.final()
            ])

            return fileContents;
        } catch (err) {
            throw new FileEncryptionError('Decryption failed', { cause: err });
        } finally {
            dek?.fill(0);
            kek?.fill(0);
        }
    }  
}
