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

USAGE = """
usage: qls [options] <filename(s)...>
    displays contents of 4Q archives

options:
    --help
"""

main = ->
  argv = minimist(process.argv[2...], boolean: [ "help", "version" ])
  if argv.help or argv._.length == 0
    console.log USAGE
    process.exit(0)
  if argv.version
    console.log VERSION
    process.exit(0)
  if argv._.length == 0
    console.log "required: filename of 4Q archive file(s)"
    process.exit(1)
  dumpArchiveFiles(argv._)
  .fail (err) ->
    console.log "\nERROR: #{err.message}"
    process.exit(1)
  .done()

dumpArchiveFiles = (filenames) ->
  if filenames.length == 0 then return Q()
  dumpArchiveFile(filenames.shift()).then ->
    dumpArchiveFiles(filenames)

dumpArchiveFile = (filename) ->
  try
    fd = fs.openSync(filename, "r")
  catch err
    console.log "ERROR reading #{filename}: #{err.message}"
    process.exit(1)
  
  stream = fs.createReadStream(filename, fd: fd)
  stream.on "error", (err) ->
    console.log "ERROR reading #{filename}: #{err.message}"
    stream.close()
  lib4q.readBottleFromStream(stream).then (bottle) ->
    scanBottle(bottle, "")
  .fail (err) ->
    console.log "ERROR reading #{filename}: #{err.message}"
    stream.close()

scanBottle = (bottle, prefix) ->
  switch bottle.type
    when lib4q.TYPE_FILE then dumpFileBottle(bottle, prefix)
    else
      console.log "ERROR: unknown bottle type #{bottle.type}"

skipBottle = (bottle) ->
  toolkit.qread(bottle).then (s) ->
    if not s? then return
    sink = new toolkit.NullSinkStream(objectMode: true)
    toolkit.qpipe(s, sink).then ->
      skipBottle(bottle)

dumpFileBottle = (bottle, prefix) ->
  console.log summaryLineForFile(bottle.header, prefix)
  if bottle.header.folder then dumpFolderBottle(bottle, prefix + bottle.header.filename + "/") else skipBottle(bottle)

dumpFolderBottle = (bottle, prefix) ->
  toolkit.qread(bottle).then (s) ->
    if not s? then return Q()
    if s instanceof lib4q.ReadableBottle
      scanBottle(s, prefix).then -> dumpFolderBottle(bottle, prefix)

# -rw-r--r--   1 robey  staff    73B Aug 10 17:29 4q.sublime-project

# either "13:45:30" or "10 Aug 2014"
relativeDate = (nanos) ->
  d = new Date(nanos / Math.pow(10, 6))
  if d.getTime() > NOW or d.getTime() < NOW - DAYS_250
    strftime("%Y", d)
  else if d.getTime() < NOW - HOURS_20
    strftime("%b %d", d)
  else
    strftime("%H:%M", d)

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

summaryLineForFile = (stats, prefix) ->
  mode = modeToWire(stats.mode or 0, stats.folder)
  username = (stats.username or "nobody")[...8]
  groupname = (stats.groupname or "nobody")[...8]
  size = if stats.size? then display.humanize(stats.size) else "     "
  time = relativeDate(stats.modifiedNanos)
  filename = if stats.folder then stats.filename + "/" else stats.filename
  sprintf("%s  %-8s %-8s %6s  %s  %s", mode, username, groupname, time, size, prefix + filename)



exports.main = main
