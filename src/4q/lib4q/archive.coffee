events = require "events"
file_bottle = require "./file_bottle"
fs = require "fs"
path = require "path"
Q = require "q"
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
    qify(fs.stat)(filename).then (stats) =>
      header = file_bottle.fileHeaderFromStats(basename, stats)
      displayName = (if prefix? then path.join(prefix, basename) else basename) + (if header.folder then "/" else "")
      @emit "filename", displayName, header
      if header.folder then return @_processFolder(filename, displayName, header)
      qify(fs.open)(filename, "r").then (fd) =>
        countingFileStream = new toolkit.CountingStream()
        countingFileStream.on "count", (n) =>
          @emit "status", displayName, n
        fileBottle = new file_bottle.FileBottleWriter(header)
        fs.createReadStream(filename, fd: fd).pipe(countingFileStream).pipe(fileBottle)
        fileBottle

  _processFolder: (folderName, prefix, header, files = null) ->
    (if files? then Q(files) else qify(fs.readdir)(folderName)).then (files) =>
      folderBottle = new file_bottle.FolderBottleWriter(header)
      # fill the bottle in the background, closing it when done.
      foreachSerial files, (filename) =>
        fullPath = if folderName? then path.join(folderName, filename) else filename
        @_processFile(fullPath, prefix).then (fileStream) =>
          toolkit.qwrite(folderBottle, fileStream)
      .then =>
        folderBottle.end()
      .fail (error) =>
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


# take a node function that takes a callback, and return a form that returns a promise.
qify = (f) ->
  (arg...) ->
    deferred = Q.defer()
    f arg..., (err, rv) ->
      if err? then return deferred.reject(err)
      deferred.resolve(rv)
    deferred.promise

# given a list, and a map function that returns promises, do them one at a time.
foreachSerial = (list, f) ->
  if list.length == 0 then return Q()
  item = list.shift()
  f(item).then ->
    foreachSerial(list, f)


exports.ArchiveWriter = ArchiveWriter
