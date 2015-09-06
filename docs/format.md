
# 4bottle Archive Format

This is a low-level description of the file/stream format used by 4bottle.


## Goals

- Streamable: Files may be saved one at a time as the archive is read, and an archive can be written without buffering the whole thing in memory. Headers should be small so they *can* be buffered, and data should be composed of streamable frames.
- It should be possible to cat several archives together and treat them as a larger archive.
- There should be an optional index so you don't have to scan the file to see what's in it.
- It should support encryption and verification using real, modern algorithms (AES & SHA-2, not DES & CRC).
- It should preserve all the important posix attributes for archival, like owner/group.


## Bottles

Everything is nested "bottles".

A bottle is a small header and one or more data streams. Each data stream is either another bottle, or in the case of file bottles, the raw file data. A data stream is made up of zero or more frames (blocks).

    4bottle archive
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

The first 8 bytes are always big-endian `0xf09f8dbc`, to identify the file or stream as being a bottle.

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

A field is uniquely identified, per bottle type, by the field type and ID. So integer \#0 is a different field from string \#0, and string \#0 in bottle type 3 is a different field from string \#0 in bottle type 4. Each bottle defines the exhaustive list of fields for that bottle.


## Encoding of data streams

Data streams are framed, so that streaming readers can clearly identify where each data stream ends. A frame header is 1 to 4 bytes, encoding the length of the frame. The high bits of the first byte indicate the length and encoding of the frame header.

    0xxxxxxx : 0 - 128
    10xxxxxx : (+ 1 byte) 0 - 8K, LSB
    110xxxxx : (+ 2 byte) 0 - 2M, LSB
    1110xxxx : (+ 3 byte) 0 - 128M, LSB
    1111xxxx : 2**(7+x) -- any power-of-2 block size from 2**7 (128) to 2**21 (2M)

For example, a frame of length 100 would be encoded as `0x64`, followed by 100 bytes of data. A frame of one million and one (1000001) bytes would be encoded as `0xc1 0x11 0x7a`: the first byte's highest 3 bits are `110`, indicating a 3-byte length in LSB order that decodes to `0xf4241`.

```
    -------========~~~~~
    11110100001001000001

    .-- 3-byte encoding
    |  .-- lowest 5 bits (0x01)
    |  |     .-- next 8 bits (0x11)
    |  |     |          .-- highest 7 bits (0x7a)
    v  v     v         v
    ***~~~~~ ========  -------
    11000001 00010010 01111010
```

The final encoding form (`0xf0` - `0xfe`) is used as a shorthand for any power-of-2 block size, which is common for buffering large files. A 1GB file may be encoded using a 1MB buffer size, leading to 1MB frames. A 1MB (1048576 byte) frame length would be encoded as `0xfd`: 2 to the power of (13 + 7), or `2**20`.

The frame size is usually dictated by the willingness of the encoder to buffer (or have pre-knowledge about the size of the file). A decoder can treat each frame as a miniature stream, and is not required to buffer their complete contents.

There are two special header bytes:

- `0x00` - end of this stream
- `0xff` - end of all data streams in this bottle

For example, the data stream "hello" can be encoded as one frame of five bytes, like this:

    0x05 0x68 0x65 0x6c 0x6c 0x6f 0x00

or even two frames, of two bytes and then three:

    0x02 0x68 0x65 0x03 0x6c 0x6c 0x6f 0x00

Because of the inevitable overhead of the frame headers, you generally want to use large frames whenever possible. The 1MB frame size is recommended.


## Bottle types

### File / Folder (0)

Header fields:

- is a folder? [bool 0]
- filename [string 0] -- required
- mime type [string 1]
- size (bytes) [int 0] -- required for files
- posix mode (lowest 9 bits) [int 1]
- create timestamp (nanoseconds) [int 2]
- modification timestamp (nanoseconds) [int 3]
- accessed timestamp (nanoseconds) [int 4]
- owner username [string 2]
- group name [string 3]

For a folder, the bottle's contents are nested bottles, representing the contents of the folder.

For a file, the bottle contains exactly one data stream: the file's raw contents.


### Hashed data (1)

Header fields:

- hash type [int 0]
  - SHA-512 [0]

There are two data streams in a hashed bottle:

- the hashed contents (a nested bottle)
- the hash value, as bytes

There is only one hash defined currently: SHA-512, with a 64-byte hash as the second data stream.


### Signed data (2)

(Not implemented yet.)


### Encrypted data (3)

Header fields:

- encryption type [int 0]
  - AES-256-CTR [0]
- recipients [string 0]

There are N + 1 data streams, where N is the number of recipients. The recipients' data streams come first, in the order listed, followed by the actual encrypted data.

Recipients are namespaced by protocol:

    <namespace>:<user-identifier>

and separated by a NUL character (`0x00`):

    <namespace>:<user-identifier>\x00<namespace>:<user-identifier>

The only currently defined protocol is "keybase". The user identifier for keybase is the keybase username. So, for example, if the recipients field contains

    keybase:robey\x00keybase:max

then the encrypted bottle has two recipients: "robey" on keybase, and "max" on keybase. The first data stream will be an encrypted message for robey; the second data stream is the same encrypted message for max; and the final stream is the encrypted bottle.

The encrypted message is always the encryption key (for the final data stream) followed by its IV. For AES-256, this will be 48 bytes: 32 bytes of key followed by 16 bytes of IV. In the keybase protocol, the data stream itself will be a binary (not armored) message of the type keybase generates by default.

N may be zero. There may be no recipients, in which case you must have received the encryption key and IV out-of-band in order to decrypt the bottle.

The expected data flow for decryption is to identify which recipient is opening the bottle, ask them to decrypt their key message, and use the decrypted key and IV to decrypt the final data stream which contains the bottle.


### Compressed data (4)

Header fields:

- compression type [int 0]
  - LZMA2 [0]
  - Snappy [1]

There is only one data stream: a nested bottle as compressed data.


### Alternate versions (5)

(Not implemented yet. This is reserved for use in cases where the same content may be encoded in multiple ways, and you only need to decode one. For example, a message encrypted with several different keys.)


### Partial (6)

(Not implemented yet. This is reserved for file-based RAID, where a single archive may be spread out across redundant files.)

Possible header fields:

- UUID for the total bottle [string 0]
- RAID type [int 0]
- total # of partials [int 1]
- index # of this part, from 0 [int 2]


## Example archive

Here is an archive of a folder named "archive", containing two files: "hello.txt" and "smile.txt".

    f0 9f 8d bc 00 00 10 03 -- bottle type 1 (hashed), 3 byte header
    80 01 00 -- int 0 = 0 (hash type SHA-512)

    hashed data stream:
      01 ea -- 234 byte frame:
        f0 9f 8d bc 00 00 00 3b -- bottle type 0 (file), 59 byte header
        00 07 61 72 63 68 69 76 65 -- string 0: "archive"
        84 02 ed 01 -- int 1: 0x1ed (octal 755)
        88 08 00 b8 3a 18 f1 93 93 13 -- int 2 (a big timestamp)
        8c 08 00 b8 3a 18 f1 93 93 13 -- int 3 (same)
        90 08 00 ce d4 71 55 94 93 13 -- int 4 (same)
        c0 00 -- bool 0 (this is a folder)
        08 05 72 6f 62 65 79 -- string 2: "robey"
        0c 05 73 74 61 66 66 -- string 3: "staff"

        data stream 1:
          01 50 -- 80 byte frame:
            f0 9f 8d bc 00 00 00 3e -- bottle type 0 (file), 62 byte header
            00 09 68 65 6c 6c 6f 2e 74 78 74 -- string 0: "hello.txt"
            84 02 a4 01 -- int 1: 0x1a4 (octal 644)
            88 08 00 b8 3a 18 f1 93 93 13 -- int 2 (a big timestamp)
            8c 08 00 b8 3a 18 f1 93 93 13 -- int 3 (same)
            90 08 00 ce d4 71 55 94 93 13 -- int 4 (same)
            80 01 06 -- int 0: 6
            08 05 72 6f 62 65 79 -- string 2: "robey"
            0c 05 73 74 61 66 66 -- string 3: "staff"

            data stream:
              01 06 -- 6 byte frame:
              68 65 6c 6c 6f 0a -- "hello\n"
              00 -- end of stream
            ff -- no more streams
          00 -- end of stream

        data stream 2:
          01 50 -- 80 byte frame:
            f0 9f 8d bc 00 00 00 3e -- bottle type 0 (file), 62 byte header
            00 09 73 6d 69 6c 65 2e 74 78 74 -- string 0: "smile.txt"
            84 02 a4 01 -- int 1: 0x1a4 (octal 644)
            88 08 00 90 cf 29 f0 93 93 13 -- int 2 (a big timestamp)
            8c 08 00 90 cf 29 f0 93 93 13 -- int 3 (same)
            90 08 00 ce d4 71 55 94 93 13 -- int 4 (same)
            80 01 06 -- int 0: 6
            08 05 72 6f 62 65 79 -- string 2: "robey"
            0c 05 73 74 61 66 66 -- string 3: "staff"

            data stream:
              01 06 -- 6 byte frame:
              73 6d 69 6c 65 0a -- "smile\n"
              00 -- end of stream
            ff -- no more streams
          00 -- end of stream

        ff -- no more streams
      00 -- end of stream

    hash result data stream:
      01 40 -- 64 byte frame:
        3c 4c ab 36 dc 96 fe 41 a9 56 ac bb 3f 80 96 47
        8d 7a 4b be 45 86 a4 ba a6 c1 44 4e 16 72 84 cb
        5e f4 e9 3d 7c 09 eb d9 d6 cb f8 96 bd 83 8c d4
        0e 56 e5 06 42 cc d0 ee 50 47 f1 dc b6 0d b2 f7
      00 -- end of stream

    ff -- no more streams
