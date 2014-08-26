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
    --no-color
        turn off cool console colors
"""

main = ->
  argv = minimist(process.argv[2...], boolean: [ "help", "version", "l", "color" ], default: { color: true })
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
  dumpArchiveFiles(argv._, argv)
  .fail (err) ->
    console.log "\nERROR: #{err.message}"
    process.exit(1)
  .done()

dumpArchiveFiles = (filenames, argv) ->
  if filenames.length == 0 then return Q()
  dumpArchiveFile(filenames.shift(), argv).then ->
    dumpArchiveFiles(filenames, argv)

dumpArchiveFile = (filename, argv) ->
  try
    fd = fs.openSync(filename, "r")
  catch err
    console.log "ERROR reading #{filename}: #{err.message}"
    process.exit(1)
  
  stream = fs.createReadStream(filename, fd: fd)
  stream.on "error", (err) ->
    console.log "ERROR reading #{filename}: #{err.message}"
    stream.close()

  # count total bytes packed away
  state = { totalBytesIn: 0, totalBytes: 0, totalFiles: 0, verbose: argv.l }

  countingInStream = new toolkit.CountingStream()
  countingInStream.on "count", (n) ->
    state.totalBytesIn = n
  stream.pipe(countingInStream)

  lib4q.readBottleFromStream(countingInStream).then (bottle) ->
    scanBottle(bottle, "", state).then ->
      process.stdout.write "#{filename} (#{state.totalFiles} files, #{display.humanize(state.totalBytesIn)} -> #{display.humanize(state.totalBytes)} bytes)\n"
  .fail (err) ->
    console.log "ERROR reading #{filename}: #{err.message}"
    console.log err.stack
    stream.close()

scanBottle = (bottle, prefix, state) ->
  switch bottle.type
    when lib4q.TYPE_FILE then dumpFileBottle(bottle, prefix, state)
    else
      console.log "ERROR: unknown bottle type #{bottle.type}"

skipBottle = (bottle) ->
  toolkit.qread(bottle).then (s) ->
    if not s? then return
    sink = new toolkit.NullSinkStream(objectMode: true)
    toolkit.qpipe(s, sink).then ->
      skipBottle(bottle)

dumpFileBottle = (bottle, prefix, state) ->
  process.stdout.write summaryLineForFile(bottle.header, prefix, state.verbose) + "\n"
  if bottle.header.folder
    dumpFolderBottle(bottle, prefix + bottle.header.filename + "/", state)
  else
    state.totalFiles += 1
    state.totalBytes += bottle.header.size
    skipBottle(bottle)

dumpFolderBottle = (bottle, prefix, state) ->
  toolkit.qread(bottle).then (s) ->
    if not s? then return Q()
    if s instanceof lib4q.ReadableBottle
      scanBottle(s, prefix, state).then -> dumpFolderBottle(bottle, prefix, state)

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

summaryLineForFile = (stats, prefix, verbose) ->
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
  if verbose
    display.paint(mode, "  ", userdata, " ", time, "  ", size, "  ", filename).toString()
  else
    display.paint("  ", size, "  ", filename).toString()


exports.main = main
