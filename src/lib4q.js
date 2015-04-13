"use strict";

const archive = require("./lib4q/archive");
const bottle_stream = require("./lib4q/bottle_stream");
const compressed_bottle = require("./lib4q/compressed_bottle");
const encrypted_bottle = require("./lib4q/encrypted_bottle");
const file_bottle = require("./lib4q/file_bottle");
const hash_bottle = require("./lib4q/hash_bottle");

exports.ArchiveReader = archive.ArchiveReader;
exports.ArchiveWriter = archive.ArchiveWriter;

exports.BottleWriter = bottle_stream.BottleWriter;
exports.readBottleFromStream = bottle_stream.readBottleFromStream;

exports.CompressedBottleWriter = compressed_bottle.CompressedBottleWriter;

exports.writeEncryptedBottle = encrypted_bottle.writeEncryptedBottle;

exports.FileBottleWriter = file_bottle.FileBottleWriter;
exports.fileHeaderFromStats = file_bottle.fileHeaderFromStats;
exports.FolderBottleWriter = file_bottle.FolderBottleWriter;

exports.validateHashBottle = hash_bottle.validateHashBottle;
exports.HashBottleWriter = hash_bottle.HashBottleWriter;

exports.TYPE_FILE = bottle_stream.TYPE_FILE;
exports.TYPE_HASHED = bottle_stream.TYPE_HASHED;
exports.TYPE_ENCRYPTED = bottle_stream.TYPE_ENCRYPTED;
exports.TYPE_COMPRESSED = bottle_stream.TYPE_COMPRESSED;

exports.HASH_SHA512 = hash_bottle.HASH_SHA512;

exports.COMPRESSION_LZMA2 = compressed_bottle.COMPRESSION_LZMA2;
exports.COMPRESSION_SNAPPY = compressed_bottle.COMPRESSION_SNAPPY;

exports.ENCRYPTION_AES_256 = encrypted_bottle.ENCRYPTION_AES_256;
