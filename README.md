# 4bottle

4Bottle: the final archive format.

4Bottle is a data & file format for archiving collections of files & folders, like "tar", "zip", and "winrar". Its primary differentiating features are:

- All important unix/posix attributes are preserved (owner, group, permissions, create/modify timestamps).
- The format is streamable: Files may be unpacked as an archive is read, and an archive may be written with minimal buffering.
- Compression may occur per-file or over the whole archive, using snappy (very fast) or LZMA2 (very compact).
- Modern crypto is used: SHA-512 for verification, and AES-256 for encryption. Encryption normally uses the keybase.io registry (and library), although the lib4bottle library allows for a pluggable key registry.

## Status

As of today (January 2015), I'm pretty satisfied with the data format, so it's unlikely to change, but I reserve the right to make some last-minute adjustments over the next few months if I feel they're necessary. When I bump the version to 1.0, I'll promise not to change the underlying data format anymore, which should ensure all archive files are supported from then on.

There are some missing features that I'd like (listed in the TODO section below). Most are small things, but being able to (cryptographically) sign an archive is one feature I'd like to finish before declaring 1.0 victory. If you have any pet features (or bugs) that you consider a hard requirement, let me know, so I can take that into consideration.

## Usage

FIXME: describe the library.

## TODO

- signed bottles
- sparse files?
