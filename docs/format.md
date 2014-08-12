
Everything is nested bottles.

A bottle is some metadata (header) and one or more data blocks. Each data block can be another bottle.

## Goals

- Streamable: Files may be saved one at a time as the archive is read, and an archive can be written without buffering the whole thing in memory. Metadata should be small so it *can* be buffered, and data should be streamable always.
- It should be possible to cat several archives together and treat them as a larger archive. (That means the magic number has to be a special header, and EOF can be implicit.)
- There should be an optional index so you don't have to scan the file to see what's in it.

## Bottle types

- File (0)

    Metadata:
    1. filename [string 0]
    2. mime type [string 1]
    3. size (bytes) [zint 0]
    4. posix mode (777) [zint 1]
    5. created (nanoseconds) [zint 2]
    6. modified (nanoseconds) [zint 3]
    7. accessed (nanoseconds) [zint 4]
    8. owner username [string 2]
    9. groups (list of strings) [string 3]
    10. is folder? (data: sequence of files) [bool 0]

2. Hashed data

    Metadata:
    - hash name (as in SSH)
    - hash value

3. Signed data

    Two data blocks: the signature, then the data.

4. Encrypted data

    Metadata:
    - cipher name (as in SSH) or "gnupg" for a gnupg armored blob

5. Compressed data

    Metadata:
    - compression type (limited list, maintained by 4q project)

6. Alternate versions

    Each data block is the same content, but with different encoding (maybe each encrypted with a different key, for example).

7. Partial bottle

    Metadata:
    - which part # is this?
    - how many parts total?
    - raid format (string)

    Two data blocks: the metadata for the total reconstituted bottle, and the partial block. That is, each part has the metadata attached redundantly as a prefix data block.

## Encoding of metadata

Each metadata item header is two bytes: type (2 bits), header id (4 bits), length (10 bits)

- bool (type 11): true if present (length=0), false if the field is missing
- int (type 10): LSB order, 8 bits per byte
- [list of] strings (type 00): series of utf8 data, separated by \u0000

## Bottle header

8 bytes total.

1. magic (4 bytes): F0 9F 8D BC (f09f8dbc big-endian)
2. version (1 byte): major (4 bits), minor (4 bits)
  - when major changes, you should be able to "parse" the archive but some contents may be unextractable
  - when minor changes, you should be able to extract all the contents you understand
  - to make incompatible (format, structure) changes, change the magic
3. reserved (0)
4. type (4 bits)
5. length of metadata block (12 bits)

Current version is 0x00.

## Data header

Single byte bitfield:
1. container? (1 = bottle, 0 = data)
2. 1 = not the last chunk for this block (only present for data blocks, with length > 0)
3. 3 reserved bits
4. 3-bit length of the size bytes to follow

The lowest 3 bits indicate the number of bytes to follow with the block size.
Byte 00 (data, length = 0) means end of data blocks for this bottle.

## Example archive

Two files, named "hello" and "smile".

- Bottle type 1 (file: directory): f0 9f 8d bc 00 00 10 22 - metadata length = 34
  - Metadata:
    - filename "." (00 01, '.')
    - created 1406011886_693_000_000, or: 88 08, 00 23 50 90 5c 28 83 13
    - similarly modified & accessed, 10 bytes each
    - is folder: c0 00
  - Data #1: 80 (container)
    - Bottle type 1 (file): f0 9f 8d bc 00 00 10 2c - metadata length = 44
      - Metadata:
        - filename "hello" (00 05, 'hello')
        - size 5 (80 01, 05)
        - mode 0666 = 0x1b6 (84 02, b6 01)
        - same 30 bytes of create/modify/access times
      - Data: (01 05 + 5 bytes)
      - 00 (end)
  - Data #2: 80 -- same as above except "smile"
  - 00 (end)

total: 8 + 34 + 1 + 8 + 44 + 8 + 1 + 8 + 44 + 8 + 1 = 165
