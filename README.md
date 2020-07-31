# bitbottle

bitbottle: the final archive format

Bitbottle is a data & file format for archiving collections of files & folders, like "tar", "zip", and "winrar". Its primary differentiating features are:

- All important unix/posix attributes are preserved (owner & group _by name_, permissions, create/modify timestamps).
- The format is streamable: Files may be unpacked as an archive is read, and an archive may be written with minimal buffering.
- Compression may occur per-file or over the whole archive, using snappy (very fast) or LZMA2 (very compact).
- Modern crypto is used: AES-128-GCM for encryption/authentication, SHA-512 for verification, and Keybase or OpenPGP for signing and key encryption.

## Status

I'm rewriting this in typescript, fixing some things from the original in 2015.

When I bump the version to 1.0, I'll promise not to change the underlying data format anymore, which should ensure all archive files are supported from then on.

## Usage

FIXME: describe the library.

## TODO

- sparse files? i'm not sure these exist anymore
