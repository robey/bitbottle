fs = require "fs"
minimist = require "minimist"
Q = require "q"
sprintf = require "sprintf"
strftime = require "strftime"
toolkit = require "stream-toolkit"
util = require "util"

display = require "./display"
helpers = require "./helpers"
lib4q = require "./lib4q"

NOW = Date.now()
HOURS_20 = 20 * 60 * 60 * 1000
DAYS_250 = 250 * 24 * 60 * 60 * 1000

VERSION = "1.0.0"

COLORS = helpers.COLORS

USAGE = """
usage: qunpack [options] <filename(s)...>
    unpacks contents of 4Q archives

options:
    --help
    -v
        verbose: display files as they're written
    -q
        quiet: display only the summary line at the end
    --no-color
        turn off cool console colors
"""

main = ->
  argv = minimist process.argv[2...],
    boolean: [ "help", "version", "q", "v", "color", "debug" ],
    default: { color: true }
  if argv.help or argv._.length == 0
    console.log USAGE
    process.exit(0)
  if argv.version
    console.log "qunpack #{VERSION}"
    process.exit(0)
  if argv._.length == 0
    console.log "required: filename of 4Q archive file(s)"
    process.exit(1)
  if not argv.color then display.noColor()
  if not argv.o? then argv.o = process.cwd()

  outputFolder = argv.o
  if not fs.existsSync(outputFolder)
    try
      fs.mkdirSync(outputFolder)
    catch error
      display.displayError "Can't create output folder: #{outputFolder} (#{error.message})"
      if argv.debug then console.log error.stack
      process.exit(1)
  if not fs.statSync(outputFolder).isDirectory
    display.displayError "Not a folder: #{outputFolder}"
    process.exit(1)
    
  unpackArchiveFiles(argv._, outputFolder, argv.q, argv.v).fail (error) ->
    display.displayError error.message
    if argv.debug then console.log error.stack
    process.exit(1)
  .done()

unpackArchiveFiles = (filenames, outputFolder, isQuiet, isVerbose) ->
  helpers.foreachSerial filenames, (filename) ->
    unpackArchiveFile(filename, outputFolder, isQuiet, isVerbose)

unpackArchiveFile = (filename, outputFolder, isQuiet, isVerbose) ->
  state =
    totalFiles: 0
    totalBytesOut: 0
    totalBytesIn: 0
    currentFileBytes: 0
    currentFileTotalBytes: 0
    currentFilename: null
    prefix: [ ]
    validHash: null
    compression: null

  updater = new display.StatusUpdater()
  countingInStream = new toolkit.CountingStream()
  countingInStream.on "count", (n) ->
    state.totalBytesIn = n
    unless isQuiet then updater.update statusMessage(state)
  helpers.readStream(filename).pipe(countingInStream)

  reader = new lib4q.ArchiveReader()
  reader.on "start-bottle", (bottle) ->
    switch bottle.typeName()
      when "file", "folder"
        state.prefix.push bottle.header.filename
        nicePrefix = state.prefix.join("/") + (if state.prefix.length > 0 then "/" else "")
        niceFilename = nicePrefix + filename
        state.currentFileBytes = 0
        state.currentFileTotalBytes = bottle.header.size
        state.currentFilename = niceFilename
        state.isFolder = bottle.header.folder
        if not state.isFolder then state.totalFiles += 1
        unless isQuiet then updater.update statusMessage(state)
  reader.on "end-bottle", (bottle) ->
    switch bottle.typeName()
      when "file", "folder"
        if isVerbose
          unless isQuiet then updater.clear()
          printFinishedFile(state)
        if not state.isFolder then state.totalBytesOut += state.currentFileTotalBytes
        state.currentFileBytes = 0
        state.currentFileTotalBytes = 0
        state.prefix.pop()
  reader.on "hash", (bottle, isValid, hex) ->
    # FIXME display something if this is per-file
    if not isValid then throw new Error("Invalid hash; archive is probably corrupt.")
    if state.prefix.length == 0 then state.validHash = bottle.header.hashName
  reader.on "compress", (bottle) ->
    # FIXME display something if this is per-file
    if state.prefix.length == 0 then state.compression = bottle.header.compressionName

  reader.processFile = (dataStream) ->
    countingOutStream = new toolkit.CountingStream()
    countingOutStream.on "count", (n) ->
      state.currentFileBytes = n
      unless isQuiet then updater.update statusMessage(state)
    # FIXME actually write the file. :)
    sink = new toolkit.NullSinkStream()
    dataStream.pipe(countingOutStream).pipe(sink)
    toolkit.qfinish(sink)

  reader.scanStream(countingInStream).then ->
    updater.clear()
    byteTraffic = "#{display.humanize(state.totalBytesIn)} -> #{display.humanize(state.totalBytesOut)} bytes"
    annotations = []
    if state.compression? then annotations.push state.compression
    if state.validHash? then annotations.push state.validHash
    hashStatus = if annotations.length > 0 then "[#{annotations.join(", ")}] " else ""
    process.stdout.write "#{filename} #{hashStatus}(#{state.totalFiles} files, #{byteTraffic})\n"


statusMessage = (state) ->
  return unless state.currentFilename?
  count = display.color(COLORS.status_count, sprintf("%6s", state.totalFiles))
  totalProgress = display.color(COLORS.status_total_progress, sprintf("%5s -> %5s", display.humanize(state.totalBytesIn), display.humanize(state.totalBytesOut + state.currentFileBytes)))
  fileProgress = if state.currentFileBytes > 0 and state.currentFileTotalBytes > 0
    display.color(COLORS.status_file_progress, "(#{Math.floor(100 * state.currentFileBytes / state.currentFileTotalBytes)}%)")
  else
    ""
  display.paint(count, ": (", totalProgress, ")  ", state.currentFilename, " ", fileProgress)

printFinishedFile = (state) ->
  return unless state.currentFilename?
  bytes = if state.isFolder then "     " else display.color(COLORS.file_size, sprintf("%5s", display.humanize(state.currentFileTotalBytes)))
  process.stdout.write display.paint("  ", bytes, "  ", state.currentFilename).toString() + "\n"

exports.main = main
