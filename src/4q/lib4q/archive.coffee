bottle_stream = require "./bottle_stream"
events = require "events"
file_bottle = require "./file_bottle"
fs = require "fs"
path = require "path"
Promise = require "bluebird"
stream = require "stream"
toolkit = require "stream-toolkit"
util = require "util"

# higher-level API for maniplating 4Q archives of files & folders.

# Create a file or folder bottle stream, emitting events for:
#   - "filename", (filename, header) -> begin processing a new file
#   - "status", (filename, byteCount) -> current # of bytes read from the current file
#   - "error", (error) -> an error occurred during the data streaming
class ArchiveWriter extends events.EventEmitter
  constructor: ->
    super()

  # Write a file into a bottle and return that a promise for that bottle.
  # If it's a plain file, the file's contents are piped in.
  # If it's a folder, a folder bottle is generated, and each file in the
  # folder is added sequentially. (Nested folders are handled recursively.)
  # In each case, the promise is fulfilled before the data is completely
  # written. Handle the "end" event on the bottle to reach the end.
  archiveFile: (filename) ->
    @_processFile(filename, null)

  # Create a fake folder with the given name, and archive a list of files
  # into it, as with `archiveFile`.
  archiveFiles: (folderName, filenames) ->
    header = @_makeFakeFolderHeader(folderName)
    prefix = folderName + "/"
    @emit "filename", prefix, header
    @_processFolder(null, prefix, header, filenames)

  _processFile: (filename, prefix) ->
    basename = path.basename(filename)
    Promise.promisify(fs.stat)(filename).then (stats) =>
      header = file_bottle.fileHeaderFromStats(basename, stats)
      displayName = (if prefix? then path.join(prefix, basename) else basename) + (if header.folder then "/" else "")
      @emit "filename", displayName, header
      if header.folder then return @_processFolder(filename, displayName, header)
      Promise.promisify(fs.open)(filename, "r").then (fd) =>
        countingFileStream = toolkit.countingStream()
        countingFileStream.on "count", (n) =>
          @emit "status", displayName, n
        fileBottle = new file_bottle.FileBottleWriter(header)
        fs.createReadStream(filename, fd: fd).pipe(countingFileStream).pipe(fileBottle)
        fileBottle

  _processFolder: (folderName, prefix, header, files = null) ->
    (if files? then Promise.resolve(files) else Promise.promisify(fs.readdir)(folderName)).then (files) =>
      folderBottle = new file_bottle.FolderBottleWriter(header)
      # fill the bottle in the background, closing it when done.
      Promise.map(files, ((filename) =>
        fullPath = if folderName? then path.join(folderName, filename) else filename
        @_processFile(fullPath, prefix).then (fileStream) =>
          folderBottle.writePromise(fileStream)
      ), concurrency: 1).then =>
        folderBottle.end()
      .catch (error) =>
        @emit "error", error
      folderBottle

  _makeFakeFolderHeader: (name) ->
    nowNanos = Date.now() * Math.pow(10, 6)
    stats =
      folder: true
      filename: name
      mode: 0x1c0
      createdNanos: nowNanos
      modifiedNanos: nowNanos
      accessedNanos: nowNanos
    stats


class ArchiveReader extends events.EventEmitter
  constructor: ->
    super()

  scanStream: (inStream) ->
    bottle_stream.readBottleFromStream(inStream).then (bottle) =>
      @scan(bottle)

  scan: (bottle) ->
    @emit "start-bottle", bottle
    promise = switch bottle.type
      when bottle_stream.TYPE_FILE
        if bottle.header.folder then @_scanFolder(bottle) else @_scanFile(bottle)
      when bottle_stream.TYPE_HASHED then @_scanHashed(bottle)
      when bottle_stream.TYPE_COMPRESSED then @_scanCompressed(bottle)
      else
        @_skipBottle(bottle)
    promise.then =>
      @emit "end-bottle", bottle

  # scan each internal stream recursively
  _scanFolder: (bottle) ->
    bottle.readPromise().then (nextStream) =>
      if not nextStream? then return
      @scanStream(nextStream).then =>
        @_scanFolder(bottle)

  _scanFile: (bottle) ->
    bottle.readPromise().then (nextStream) =>
      if not nextStream? then return
      @processFile(nextStream).then =>
        @_scanFile(bottle)

  # override this method to do something besides just skip the stream and move on.
  processFile: (dataStream) ->
    sink = toolkit.nullSinkStream()
    dataStream.pipe(sink)
    sink.finishPromise()

  _scanHashed: (bottle) ->
    bottle.validate().then ({ bottle: innerBottle, valid: validPromise, hex: hexPromise }) =>
      @scan(innerBottle).then =>
        validPromise.then (isValid) =>
          hexPromise.then (hex) =>
            @emit "hash", bottle, isValid, hex

  _scanCompressed: (bottle) ->
    @emit "compress", bottle
    bottle.decompress().then (nextBottle) =>
      @scan(nextBottle)

  _skipBottle: (bottle) ->
    bottle.readPromise().then (s) ->
      if not s? then return
      sink = new toolkit.NullSinkStream()
      s.pipe(sink)
      sink.endPromise().then ->
        skipBottle(bottle)


exports.ArchiveReader = ArchiveReader
exports.ArchiveWriter = ArchiveWriter
