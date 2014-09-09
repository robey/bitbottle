fs = require "fs"
minimist = require "minimist"
path = require "path"
Q = require "q"
sprintf = require "sprintf"
stream = require "stream"
strftime = require "strftime"
toolkit = require "stream-toolkit"
util = require "util"

display = require "./display"
lib4q = require "./lib4q"

NOW = Date.now()

VERSION = "1.0.0"

COLORS =
  status_count: "cyan"
  status_size: "cyan"
  verbose_size: "green"

USAGE = """
usage: qpack [options] <filename(s)...>
    create a 4Q archive from a set of files (or folders)

options:
    --help
    -o <filename>
        archive filename to write
    -v
        verbose: display files as they're written
    -q
        quiet: display nothing unless there's an error
"""

main = ->
  argv = minimist(process.argv[2...], boolean: [ "help", "version" ])
  if argv.help or argv._.length == 0
    console.log USAGE
    process.exit(0)
  if argv.version
    console.log "qpack #{VERSION}"
    process.exit(0)
  if argv._.length == 0
    console.log "Required: filename(s) to archive"
    process.exit(1)
  if not argv.o?
    argv.o = if argv._.length > 1 then "archive.4q" else argv._[0] + ".4q"

  # quick sanity check: do all these files exist?
  okay = true
  for filename in argv._
    if not fs.existsSync(filename)
      console.log "Can't find file: #{filename}"
      okay = false
  if not okay then process.exit(1)

  try
    fd = fs.openSync(argv.o, "w")
  catch err
    console.log "ERROR writing #{argv.o}: #{err.message}"
    process.exit(1)
  outStream = fs.createWriteStream(filename, fd: fd)

  updater = new StatusUpdater(verbose: argv.v, quiet: argv.q)
  countingOutStream = new toolkit.CountingStream()
  countingOutStream.on "count", (n) ->
    updater.totalBytes = n
    updater.update()

  hashBottle = new lib4q.HashBottleWriter(lib4q.HASH_SHA512)

  hashBottle.pipe(countingOutStream).pipe(outStream)
  targetStream = hashBottle

  if false
    compressedBottle = new lib4q.CompressedBottleWriter(lib4q.COMPRESSION_LZMA2)
    compressedBottle.pipe(targetStream)
    targetStream = compressedBottle

  writer = new lib4q.ArchiveWriter()
  writer.on "filename", (filename, header) ->
    updater.setName(filename)
    if not header.folder
      updater.fileCount += 1
      updater.totalBytesIn += header.size
  writer.on "status", (filename, byteCount) ->
    updater.currentBytes = byteCount
    updater.update()
  writer.on "error", (error) ->
    console.log "\nERROR: #{error.message}"
    console.log err.stack
    process.exit(1)

  promise = if argv._.length > 1
    # multiple files: just make a fake folder
    folderName = path.join(path.dirname(argv.o), path.basename(argv.o, ".4q"))
    writer.archiveFiles(folderName, argv._)
  else
    writer.archiveFile(argv._[0])
  promise.then (bottle) ->
    bottle.pipe(targetStream)
    toolkit.qfinish(outStream)
  .then ->
    updater.done()
    updater.clear()
    if not argv.q then process.stdout.write "#{argv.o} (#{updater.fileCount} files, #{display.humanize(updater.totalBytesIn)} -> #{display.humanize(updater.totalBytes)} bytes)\n"
  .fail (err) ->
    console.log "\nERROR: #{err.message}"
    console.log err.stack
    process.exit(1)
  .done()


# this really should be part of js. :/
copy = (obj, fields) ->
  rv = {}
  for k, v of obj then rv[k] = v
  for k, v of fields then rv[k] = v
  rv


class StatusUpdater
  constructor: (@options) ->
    @totalBytes = 0
    @currentBytes = 0
    @totalBytesIn = 0
    @fileCount = 0
    @lastUpdate = 0
    @frequency = 500

  setName: (filename, isFolder) ->
    if @filename? then @_finishedFile()
    @currentBytes = 0
    @filename = filename
    @isFolder = isFolder
    @forceUpdate()

  done: ->
    if @filename? then @_finishedFile()

  _finishedFile: ->
    if not @options.verbose then return
    @forceUpdate()
    @clear()
    bytes = if @isFolder then "     " else display.color(COLORS.verbose_size, sprintf("%5s", display.humanize(@currentBytes)))
    process.stdout.write display.paint("  ", bytes, "  ", @filename).toString() + "\n"

  clear: ->
    @lastUpdate = 0
    if not @options.quiet then display.displayStatus ""

  forceUpdate: ->
    @lastUpdate = 0
    @update()

  update: ->
    if @options.quiet then return
    now = Date.now()
    if now > @lastUpdate + @frequency and @filename?
      @lastUpdate = now
      count = display.color(COLORS.status_count, sprintf("%6s", @fileCount))
      sizes = if @currentBytes == 0
        sprintf("%6s%5s", " ", display.humanize(@totalBytes))
      else
        sprintf("%5s/%5s", display.humanize(@currentBytes), display.humanize(@totalBytes))
      progress = display.color(COLORS.status_size, sizes)
      display.displayStatus display.paint(count, ": (", progress, ")  ", @filename, " ")


exports.main = main
