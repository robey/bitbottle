fs = require "fs"
minimist = require "minimist"
Q = require "q"
toolkit = require "stream-toolkit"
util = require "util"

display = require "./display"
helpers = require "./helpers"
lib4q = require "./lib4q"

VERSION = "1.0.0"

USAGE = """
usage: qls [options] <filename(s)...>
    displays contents of 4Q archives

options:
    --help
    -l
        long form: display date/time, user/group, and posix permissions
    -q
        quiet: display only the summary line at the end
    --structure
        show the bottle structure of the archive, instead of the listing
    --no-color
        turn off cool console colors
"""

main = ->
  argv = minimist process.argv[2...],
    boolean: [ "help", "version", "l", "q", "color", "structure", "debug" ],
    default: { color: true }
  if argv.help or argv._.length == 0
    console.log USAGE
    process.exit(0)
  if argv.version
    console.log "qls #{VERSION}"
    process.exit(0)
  if argv._.length == 0
    console.log "required: filename of 4Q archive file(s)"
    process.exit(1)
  if not argv.color then display.noColor()

  (if argv.structure then dumpArchiveStructures(argv._) else dumpArchiveFiles(argv._, argv.l, argv.q)).fail (error) ->
    display.displayError "Unable to read archive: #{helpers.messageForError(error)}"
    if argv.debug then console.log error.stack
    process.exit(1)
  .done()

dumpArchiveStructures = (filenames) ->
  helpers.foreachSerial filenames, (filename) ->
    dumpArchiveStructure(filename)

dumpArchiveStructure = (filename) ->
  indent = 0
  pad = -> [0 ... indent].map((x) -> " ").join("")

  reader = new lib4q.ArchiveReader()
  reader.on "start-bottle", (bottle) ->
    typeName = display.color("purple", bottle.typeName())
    extra = switch bottle.typeName()
      when "file" then "#{bottle.header.filename} (#{bottle.header.size})"
      when "folder" then bottle.header.filename
      else ""
    process.stdout.write display.paint(pad(), "+ ", typeName, " ", extra).toString() + "\n"
    indent += 2
  reader.on "end-bottle", (bottle) ->
    indent -= 2
  reader.on "hash", (bottle, isValid, hex) ->
    validString = if isValid then display.color("green", "valid") else display.color("red", "INVALID")
    process.stdout.write display.paint(pad(), "[", validString, " hash: ", hex, "]").toString() + "\n"

  reader.scanStream(helpers.readStream(filename))

dumpArchiveFiles = (filenames, isVerbose, isQuiet) ->
  helpers.foreachSerial filenames, (filename) ->
    dumpArchiveFile(filename, isVerbose, isQuiet)

dumpArchiveFile = (filename, isVerbose, isQuiet) ->
  # count total bytes packed away
  state = { totalBytesIn: 0, totalBytes: 0, totalFiles: 0, prefix: [] }

  countingInStream = new toolkit.CountingStream()
  countingInStream.on "count", (n) ->
    state.totalBytesIn = n
  helpers.readStream(filename).pipe(countingInStream)

  reader = new lib4q.ArchiveReader()
  reader.on "start-bottle", (bottle) ->
    switch bottle.typeName()
      when "file", "folder"
        nicePrefix = state.prefix.join("/") + (if state.prefix.length > 0 then "/" else "")
        unless isQuiet
          process.stdout.write helpers.summaryLineForFile(bottle.header, nicePrefix, isVerbose) + "\n"
        state.prefix.push bottle.header.filename
        if not bottle.header.folder
          state.totalFiles += 1
          state.totalBytes += bottle.header.size
  reader.on "end-bottle", (bottle) ->
    switch bottle.typeName()
      when "file", "folder"
        state.prefix.pop()
  reader.on "hash", (bottle, isValid, hex) ->
    # FIXME display something if this is per-file
    if not isValid then throw new Error("Invalid hash; archive is probably corrupt.")
    if state.prefix.length == 0 then state.validHash = bottle.header.hashName
  reader.on "compress", (bottle) ->
    # FIXME display something if this is per-file
    if state.prefix.length == 0 then state.compression = bottle.header.compressionName

  reader.scanStream(countingInStream).then ->
    byteTraffic = "#{display.humanize(state.totalBytesIn)} -> #{display.humanize(state.totalBytes)} bytes"
    annotations = []
    if state.compression? then annotations.push state.compression
    if state.validHash? then annotations.push state.validHash
    hashStatus = if annotations.length > 0 then "[#{annotations.join(", ")}] " else ""
    process.stdout.write "#{filename} #{hashStatus}(#{state.totalFiles} files, #{byteTraffic})\n"



exports.main = main
