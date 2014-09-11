fs = require "fs"
minimist = require "minimist"
Q = require "q"
sprintf = require "sprintf"
strftime = require "strftime"
toolkit = require "stream-toolkit"
util = require "util"

display = require "./display"
lib4q = require "./lib4q"

NOW = Date.now()
HOURS_20 = 20 * 60 * 60 * 1000
DAYS_250 = 250 * 24 * 60 * 60 * 1000

VERSION = "1.0.0"

COLORS =
  executable: "red"
  mode: "088"
  user_group: "088"
  timestamp: "blue"
  file_size: "green"

USAGE = """
usage: qls [options] <filename(s)...>
    displays contents of 4Q archives

options:
    --help
    -l
        long form: display date/time, user/group, and posix permissions
    --structure
        show the bottle structure of the archive, instead of the listing
    --no-color
        turn off cool console colors
"""

main = ->
  argv = minimist(process.argv[2...], boolean: [ "help", "version", "l", "color", "structure" ], default: { color: true })
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

  (if argv.structure then dumpArchiveStructures(argv._) else dumpArchiveFiles(argv._, argv.l)).fail (err) ->
    console.log "\nERROR: #{err.message}"
    process.exit(1)
  .done()

dumpArchiveStructures = (filenames) ->
  foreachSerial filenames, (filename) ->
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

  reader.scanStream(readStream(filename))

dumpArchiveFiles = (filenames, isVerbose) ->
  foreachSerial filenames, (filename) ->
    dumpArchiveFile(filename, isVerbose)

dumpArchiveFile = (filename, isVerbose) ->
  # count total bytes packed away
  state = { totalBytesIn: 0, totalBytes: 0, totalFiles: 0, isVerbose: isVerbose, prefix: [] }

  countingInStream = new toolkit.CountingStream()
  countingInStream.on "count", (n) ->
    state.totalBytesIn = n
  readStream(filename).pipe(countingInStream)

  reader = new lib4q.ArchiveReader()
  reader.on "start-bottle", (bottle) ->
    switch bottle.typeName()
      when "file", "folder"
        nicePrefix = state.prefix.join("/") + (if state.prefix.length > 0 then "/" else "")
        process.stdout.write summaryLineForFile(bottle.header, nicePrefix, state.isVerbose) + "\n"
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

readStream = (filename) ->
  try
    fd = fs.openSync(filename, "r")
  catch err
    console.log "ERROR reading #{filename}: #{err.message}"
    process.exit(1)
  
  stream = fs.createReadStream(filename, fd: fd)
  stream.on "error", (err) ->
    console.log "ERROR reading #{filename}: #{err.message}"
    stream.close()
  stream

# either "13:45" or "10 Aug" or "2014"
# (25 Aug 2014: this is stupid.)
relativeDate = (nanos) ->
  d = new Date(nanos / Math.pow(10, 6))
  if d.getTime() > NOW or d.getTime() < NOW - DAYS_250
    strftime("%Y", d)
  else if d.getTime() < NOW - HOURS_20
    strftime("%b %d", d)
  else
    strftime("%H:%M", d)

fullDate = (nanos) ->
  d = new Date(nanos / Math.pow(10, 6))
  strftime("%Y-%m-%d %H:%M", d)

# convert a numeric mode into the "-rw----" wire
modeToWire = (mode, isFolder) ->
  octize = (n) ->
    [
      if (n & 4) != 0 then "r" else "-"
      if (n & 2) > 0 then "w" else "-"
      if (n & 1) != 0 then "x" else "-"
    ].join("")
  d = if isFolder then "d" else "-"
  d + octize((mode >> 6) & 7) + octize((mode >> 3) & 7) + octize(mode & 7)

summaryLineForFile = (stats, prefix, isVerbose) ->
  mode = modeToWire(stats.mode or 0, stats.folder)
  username = (stats.username or "nobody")[...8]
  groupname = (stats.groupname or "nobody")[...8]
  size = if stats.size? then display.humanize(stats.size) else "     "
  time = fullDate(stats.modifiedNanos)
  filename = if stats.folder
    prefix + stats.filename + "/"
  else if (stats.mode & 0x40) != 0
    display.paint(display.color(COLORS.executable, prefix + stats.filename + "*"))
  else
    prefix + stats.filename
  mode = display.color(COLORS.mode, mode)
  userdata = display.color(COLORS.user_group, sprintf("%-8s %-8s", username, groupname))
  time = display.color(COLORS.timestamp, sprintf("%6s", time))
  size = display.color(COLORS.file_size, sprintf("%5s", size))
  if isVerbose
    display.paint(mode, "  ", userdata, " ", time, "  ", size, "  ", filename).toString()
  else
    display.paint("  ", size, "  ", filename).toString()

# given a list, and a map function that returns promises, do them one at a time.
foreachSerial = (list, f) ->
  if list.length == 0 then return Q()
  item = list.shift()
  f(item).then ->
    foreachSerial(list, f)

exports.main = main
