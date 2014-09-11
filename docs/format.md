
Everything is nested bottles.

A bottle is some (small, structured) header and one or more data streams. Each data stream can be another bottle. A data stream is made up of zero or more frames (blocks).

## Goals

- Streamable: Files may be saved one at a time as the archive is read, and an archive can be written without buffering the whole thing in memory. Headers should be small so they *can* be buffered, and data should be streamable always.
- It should be possible to cat several archives together and treat them as a larger archive. (That means the magic number has to be a special header, and EOF can be implicit.)
- There should be an optional index so you don't have to scan the file to see what's in it.

## Bottle types

- File (0)

    Header:
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

- Hashed data (1)

    Header:
    1. hash type [zint 0]
      - sha-512 [0]

    Data:
    1. actual data
    2. hash value

3. Signed data

    Two data blocks: the signature, then the data.

4. Encrypted data

    Header:
    - cipher name (as in SSH) or "gnupg" for a gnupg armored blob

- Compressed data (4)

    Header:
    1. compression type [zint 0]
      - lzma2 [0]
      - snappy [1]

6. Alternate versions

    Each data block is the same content, but with different encoding (maybe each encrypted with a different key, for example).

7. Partial bottle

    Header:
    - which part # is this?
    - how many parts total?
    - raid format (string)

    Two data blocks: the header for the total reconstituted bottle, and the partial block. That is, each part has the header attached redundantly as a prefix data block.

## Encoding of headers

Each item in the header is marked by two bytes: type (2 bits), id (4 bits), length (10 bits)

- bool (type 11): true if present (length=0), false if the field is missing
- int (type 10): LSB order, 8 bits per byte
- [list of] strings (type 00): series of utf8 data, separated by \u0000

## Bottle magic

8 bytes total.

1. magic (4 bytes): F0 9F 8D BC (f09f8dbc big-endian)
2. version (1 byte): major (4 bits), minor (4 bits)
  - when major changes, you should be able to "parse" the archive but some contents may be unextractable
  - when minor changes, you should be able to extract all the contents you understand
  - to make incompatible (format, structure) changes, change the magic
3. reserved (0)
4. type (4 bits)
5. length of header block (12 bits)

Current version is (0, 0).

## Data

A data block is made up of frames. Each frame consists of:
1. 1 byte length prefix: how many length bytes are there?
2. length bytes for this frame
3. data bytes

A prefix byte of 0x00 is the final (empty) frame marking the end of the data block.

A prefix byte of 0xff marks the end of the bottle.


## Example archive

Two files, named "hello" and "smile".

- Bottle type 1 (file: directory): f0 9f 8d bc 00 00 10 22 - header length = 34
  - Header:
    - filename "." (00 01, '.')
    - created 1406011886_693_000_000, or: 88 08, 00 23 50 90 5c 28 83 13
    - similarly modified & accessed, 10 bytes each
    - is folder: c0 00
  - Data #1: 01 3c (60 bytes)
    - Bottle type 1 (file): f0 9f 8d bc 00 00 10 2c - header length = 44
      - Metadata:
        - filename "hello" (00 05, 'hello')
        - size 5 (80 01, 05)
        - mode 0666 = 0x1b6 (84 02, b6 01)
        - same 30 bytes of create/modify/access times
      - Data: (01 05 + 5 bytes)
      - 00 (end)
  - Data #2: 01 3c -- same as above except "smile"
  - 00 (end)

total: 8 + 34 + 2 + 60 + 2 + 60 + 1 = 167
