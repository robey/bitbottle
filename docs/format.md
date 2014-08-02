
Everything is nested bottles.

A bottle is some metadata (header) and one or more data blocks. Each data block can be another bottle.

## Goals

- Streamable: Files may be saved one at a time as the archive is read, and an archive can be written without buffering the whole thing in memory. Metadata should be small so it *can* be buffered, and data should be streamable always.
- It should be possible to cat several archives together and treat them as a larger archive. (That means the magic number has to be a special header, and EOF can be implicit.)
- There should be an optional index so you don't have to scan the file to see what's in it.

## Bottle types

1. File

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
- zint (type 10): high clear on final byte, LSB order, 7 bits per byte
- [list of] strings (type 00): series of utf8 data, separated by \u0000

## Bottle header

1. type (4 bits) -- except F which means "magic"
2. length of metadata block (12 bits)

## Data header

Single byte:
1. type field (2 bits: 00=end, 01=data, 10=container, 11=reserved)
2. is this the last chunk? (1 bit, 1 = yes)

For type=01, zint size follows. Byte 00 is the end of a stream of data blocks.

## Magic header

F0 9F 8D BC (f09f8dbc big-endian)
00 00 00 00

1. major / minor version (4 bits each)
2. flags for support of new features, grouped by what you should do if you don't understand the feature flag:
  - can read/write without problem (8 bits)
  - can read, but not rewrite (8 bits)
  - can't even read (8 bits)

A magic header can appear anywhere and refers to the rest of the stream. Current version is 00.

## Example archive

Two files, named "hello" and "smile".

- Magic header (8 bytes)
- Bottle type 1 (file: directory): 10 26 - metadata length = 38
  - Metadata:
    - filename "." (04 01, '.')
    - created 1406011886_693_000_000, or: 14 09, 80 c6 c0 82 c9 8b ca c1 13
    - similarly modified & accessed, 11 bytes each
    - is folder: 28 00
  - Data #1: a0 (container) 3b (59 bytes)
    - Bottle type 1 (file): 10 31 - metadata length = 49
      - Metadata:
        - filename "hello" (04 05, 'hello')
        - size 5 (0c 01, 05)
        - mode 0666 = 0x1b6 (10 02, 36 03)
        - same 33 bytes of create/modify/access times
        - is folder: 28 00
      - Data: (60 05 + 5 bytes)
      - 00 (end)
  - Data #2: a0 3c -- same as above except "smile"
  - 00 (end)

total: 8 + 2 + 38 + 2 + 59 + 1 + 2 + 59 + 1 + 1 = 173
