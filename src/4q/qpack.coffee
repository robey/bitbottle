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
  countingOutStream.pipe(outStream)

  state =
    outStream: countingOutStream
    updater: updater
    prefix: null

  promise = if argv._.length > 1
    # multiple files: just make a fake folder
    folderName = path.join(path.dirname(argv.o), path.basename(argv.o, ".4q"))
    nowNanos = Date.now() * Math.pow(10, 6)
    stats =
      folder: true
      filename: folderName
      mode: 0x1c0
      createdNanos: nowNanos
      modifiedNanos: nowNanos
      accessedNanos: nowNanos
    state.updater.setName(folderName + "/")
    state.updater.finishedFile(true)
    archiveFolderOfFiles(copy(state, prefix: folderName), null, stats, argv._)
  else
    archiveFile(state, argv._[0])
  promise.then ->
    countingOutStream.end()
    toolkit.qfinish(countingOutStream).then ->
      toolkit.qfinish(outStream)
  .then ->
    updater.clear()
    if not argv.q then process.stdout.write "#{argv.o} (#{updater.fileCount} files, #{display.humanize(updater.totalBytesIn)} -> #{display.humanize(updater.totalBytes)} bytes)\n"
  .fail (err) ->
    console.log "\nERROR: #{err.message}"
    process.exit(1)
  .done()


archiveFiles = (state, folder, filenames) ->
  if filenames.length == 0 then return Q()
  filename = filenames.shift()
  filepath = if folder? then path.join(folder, filename) else filename
  archiveFile(state, filepath).then ->
    archiveFiles(state, folder, filenames)

archiveFile = (state, filename) ->
  basename = path.basename(filename)
  qify(fs.stat)(filename).then (stats) ->
    stats = lib4q.fileHeaderFromStats(filename, basename, stats)
    displayName = if state.prefix? then path.join(state.prefix, basename) else basename
    state.updater.setName(if stats.folder then displayName + "/" else displayName)
    if stats.folder
      # display the folder name before the files
      state.updater.finishedFile(true)
      archiveFolder(copy(state, prefix: displayName), filename, stats).then ->
    else
      state.updater.fileCount += 1
      state.updater.totalBytesIn += stats.size
      qify(fs.open)(filename, "r").then (fd) ->
        fileStream = fs.createReadStream(filename, fd: fd)
        countingFileStream = new toolkit.CountingStream()
        countingFileStream.on "count", (n) ->
          state.updater.currentBytes = n
          state.updater.update()
        fileStream.pipe(countingFileStream)
        pushBottle(state.outStream, lib4q.writeFileBottle(stats, countingFileStream)).then ->
          state.updater.finishedFile()

archiveFolder = (state, folder, stats) ->
  qify(fs.readdir)(folder).then (files) ->
    archiveFolderOfFiles(state, folder, stats, files)

archiveFolderOfFiles = (state, folder, stats, files) ->
  folderOutStream = lib4q.writeFileBottle(stats, null)
  Q.all([
    pushBottle(state.outStream, folderOutStream)
    archiveFiles(copy(state, outStream: folderOutStream), folder, files).then ->
      folderOutStream.close()
  ])

pushBottle = (outStream, bottle) ->
  if outStream instanceof lib4q.WritableBottle
    outStream.writeStream(bottle)
  else
    toolkit.qpipe(bottle, outStream, end: false)

qify = (f) ->
  (arg...) ->
    deferred = Q.defer()
    f arg..., (err, rv) ->
      if err? then return deferred.reject(err)
      deferred.resolve(rv)
    deferred.promise

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

  setName: (filename) ->
    @currentBytes = 0
    @filename = filename
    @forceUpdate()

  finishedFile: (isFolder = false) ->
    if not @options.verbose then return
    @forceUpdate()
    @clear()
    bytes = if isFolder then "     " else display.color(COLORS.verbose_size, sprintf("%5s", display.humanize(@currentBytes)))
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
