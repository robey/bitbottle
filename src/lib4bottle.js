"use strict";

export {
  ArchiveWriter,
  scanArchive
} from "./lib4bottle/archive";

export {
  bottleTypeName,
  readBottle,
  writeBottle,
  TYPE_FILE,
  TYPE_HASHED,
  TYPE_ENCRYPTED,
  TYPE_COMPRESSED
} from "./lib4bottle/bottle_stream";

export {
  decodeFileHeader,
  encodeFileHeader,
  writeFileBottle,
  writeFolderBottle,
  fileHeaderFromStats
} from "./lib4bottle/file_bottle";

export {
  decodeHashHeader,
  readHashBottle,
  writeHashBottle,
  HASH_SHA512
} from "./lib4bottle/hash_bottle";

export {
  decodeEncryptionHeader,
  readEncryptedBottle,
  writeEncryptedBottle,
  ENCRYPTION_AES_256_CTR
} from "./lib4bottle/encrypted_bottle";

export {
  decodeCompressionHeader,
  readCompressedBottle,
  writeCompressedBottle,
  COMPRESSION_LZMA2,
  COMPRESSION_SNAPPY
} from "./lib4bottle/compressed_bottle";
