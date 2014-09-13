
# 4Q Archive Format

This is a low-level description of the file/stream format used by 4Q.


## Goals

- Streamable: Files may be saved one at a time as the archive is read, and an archive can be written without buffering the whole thing in memory. Headers should be small so they *can* be buffered, and data should be composed of streamable frames.
- It should be possible to cat several archives together and treat them as a larger archive.
- There should be an optional index so you don't have to scan the file to see what's in it.
- It should support encryption and verification using real, modern algorithms (AES & SHA-2, not DES & CRC).
- It should preserve all the important posix attributes for archival, like owner/group.


## Bottles

Everything is nested "bottles".

A bottle is a small header and one or more data streams. Each data stream is either another bottle, or in the case of file bottles, the raw file data. A data stream is made up of zero or more frames (blocks).

    4Q archive
    +---------------------+---------------------------------------------- ...
    | Bottle header       | Data stream (nested bottle)
    | (type = compressed) | +-----------------+-------------------------- ...
    |                     | | Bottle header   | Data stream (nested bottle) 
    |                     | | (type = folder) | +---------------+-------- ...
    |                     | |                 | | Bottle header | File
    |                     | |                 | | (type = file) | data...
    +---------------------+-+-----------------+-+---------------+-------- ...


## Bottle header

The bottle header is made up of 8 bytes of magic & version info, followed by a series of typed fields. The total size of the fields, combined, must be less than 4096 bytes.

    Magic
    +----------+----------+----------+----------+
    | 0xf0     | 0x9f     | 0x8d     | 0xbc     |
    +----------+----------+----------+----------+
    | VVVVvvvv | 00000000 | tttt   nnnnnnnnnnnn |
    +----------+----------+---------------------+

The first 8 bytes are always big-endian `0xf09f8dbc`, to identify the file or stream as being a 4Q bottle.

The next byte is the format version: the 4 high bits (V) are the major version, and the low 4 bits (v) are the minor version. The current version is (0, 0) so this byte is always 0x00. This is used to encode format compatibility (described below).

The next byte is reserved, and is currently always `0x00`.

The next two bytes are a big-endian 16-bit value. The 4 high bits of the next byte identify the bottle type, 0 - 15. (The types are defined below.) The low 12 bits are the length of the header to follow, 0 - 4095.


## Format compatibility

The 32-bit magic (`0xf09f8dbc`) identifies the basic structure of the header and framing: the magic, the header encoding, and the data stream frames.

The major version increments if the bottle types or streams change in such a way that older parsers won't understand the contents or be able to extract files.

The minor version increments if new bottle types are added, or the format changes in such a way that older parsers can understand the contents and extract files, but may not be able to take advantage of new features.

For example, if a new hash type is added, the minor version will increment: older parsers will be able to decode newer archives fine, but they can't validate the hash or update it.


## Encoding of the header fields

Each field in the header starts with a 16-bit big-endian descriptor, followed by 0 - 1023 bytes of the field value.

    +----------------+----------------+
    | T T D D D D L L L L L L L L L L |
    +----------------+----------------+
    
    T: 2-bit type identifier (0 - 3)
    D: 4-bit field id (0 - 15)
    L: 10-bit length of the field's value

Types are:

- 0: UTF-8 encoded string
- 1: (reserved)
- 2: unsigned integer
- 3: boolean

Unsigned integers are stored in the least number of bytes required, LSB order. So 0 is encoded as `0x00`, 200 as `0xc8`, 500 as `0xf4 0x01`, and 123456 as `0x40 0xe2 0x01`.

A boolean field is false by default, so if it's present, it always has a zero-length value and represents "true".

A field is uniquely identified, per bottle type, by the field type and ID. So integer #0 is a different field from string #0, and string #0 in bottle type 3 is a different field from string #0 in bottle type 4. Each bottle defines the exhaustive list of fields for that bottle.





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
