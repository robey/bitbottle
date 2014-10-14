fs = require "fs"
minimist = require "minimist"
path = require "path"
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
    -f, --force
        overwrite any existing files when unpacking
    -v
        verbose: display files as they're written
    -q
        quiet: display only the summary line at the end
    --no-color
        turn off cool console colors
"""

main = ->
  argv = minimist process.argv[2...],
    boolean: [ "help", "version", "q", "v", "color", "debug", "force" ],
    alias: { "f": "force" }
    default: { color: true, force: false }
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
      display.displayError "Can't create folder #{outputFolder}: #{helpers.messageForError(error)}"
      if argv.debug then console.log error.stack
      process.exit(1)
  if not fs.statSync(outputFolder).isDirectory
    display.displayError "Not a folder: #{outputFolder}"
    process.exit(1)
  
  options =
    isQuiet: argv.q
    isVerbose: argv.v
    debug: argv.debug
    force: argv.force
  unpackArchiveFiles(argv._, outputFolder, options).fail (error) ->
    display.displayError "Unable to unpack archive: #{helpers.messageForError(error)}"
    if argv.debug then console.log error.stack
    process.exit(1)
  .done()

unpackArchiveFiles = (filenames, outputFolder, options) ->
  helpers.foreachSerial filenames, (filename) ->
    unpackArchiveFile(filename, outputFolder, options)

unpackArchiveFile = (filename, outputFolder, options) ->
  state =
    totalFiles: 0
    totalBytesOut: 0
    totalBytesIn: 0
    currentFileBytes: 0
    currentFileTotalBytes: 0
    currentFilename: null
    currentDestFilename: null
    prefix: [ ]
    validHash: null
    compression: null

  updater = new display.StatusUpdater()
  countingInStream = new toolkit.CountingStream()
  countingInStream.on "count", (n) ->
    state.totalBytesIn = n
    unless options.isQuiet then updater.update statusMessage(state)
  helpers.readStream(filename).pipe(countingInStream)
  ultimateOutputFolder = outputFolder

  reader = new lib4q.ArchiveReader()
  reader.on "start-bottle", (bottle) ->
    switch bottle.typeName()
      when "file", "folder"
        nicePrefix = state.prefix.join("/") + (if state.prefix.length > 0 then "/" else "")
        niceFilename = nicePrefix + bottle.header.filename
        state.currentFileBytes = 0
        state.currentFileTotalBytes = bottle.header.size
        state.currentFilename = niceFilename
        state.currentDestFilename = path.join(outputFolder, niceFilename)
        state.isFolder = bottle.header.folder
        state.mode = bottle.header.mode
        if state.isFolder and (not ultimateOutputFolder?) then ultimateOutputFolder = state.currentDestFilename
        if not state.isFolder then state.totalFiles += 1
        unless options.isQuiet then updater.update statusMessage(state)
        if state.isFolder then ensureFolder(state.currentDestFilename)
        state.prefix.push bottle.header.filename
  reader.on "end-bottle", (bottle) ->
    switch bottle.typeName()
      when "file", "folder"
        if options.isVerbose
          unless options.isQuiet then updater.clear()
          unless bottle.typeName() == "folder" then printFinishedFile(state)
        unless bottle.typeName() == "folder" then state.totalBytesOut += state.currentFileTotalBytes
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
  reader.on "error", (error) ->
    display.displayError "Can't write #{state.currentDestFilename or '?'}: #{helpers.messageForError(error)}"
    if error.code == "EEXIST" then display.displayError "Use -f or --force to overwrite existing files."
    if options.debug then console.log error.stack
    process.exit(1)

  reader.processFile = (dataStream) ->
    countingOutStream = new toolkit.CountingStream()
    countingOutStream.on "count", (n) ->
      state.currentFileBytes = n
      unless options.isQuiet then updater.update statusMessage(state)

    realFilename = path.join(outputFolder, state.currentFilename)

    access = if options.force then "w" else "wx"
    Q.nfbind(fs.open)(realFilename, access, state.mode or parseInt("666", 8)).then (fd) ->
      outStream = fs.createWriteStream(realFilename, fd: fd)
      outStream.on "error", (error) -> reader.emit "error", error
      dataStream.pipe(countingOutStream).pipe(outStream)
      toolkit.qfinish(outStream)
    .fail (error) ->
      reader.emit "error", error

  ensureFolder = (realFilename) ->
    if not (fs.existsSync(realFilename) and fs.statSync(realFilename).isDirectory())
      fs.mkdirSync(realFilename)

  reader.scanStream(countingInStream).then ->
    updater.clear()
    byteTraffic = "#{display.humanize(state.totalBytesIn)} -> #{display.humanize(state.totalBytesOut)} bytes"
    annotations = []
    if state.compression? then annotations.push state.compression
    if state.validHash? then annotations.push state.validHash
    extras = if annotations.length > 0 and options.isVerbose then display.color(COLORS.annotations, "[#{annotations.join(", ")}] ") else ""
    inStatus = display.paint(filename, " ", display.color(COLORS.file_size, "(#{display.humanize(state.totalBytesIn)})"))
    outStatus = display.paint(ultimateOutputFolder, " ", display.color(COLORS.file_size, "(#{state.totalFiles} files, #{display.humanize(state.totalBytesOut)}B)"))
    process.stdout.write "#{filename} -> #{outStatus} #{extras}\n"


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