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
  # FIXME: serialize this!
  for filename in argv._
    dumpArchiveFile(filename)

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
    scanBottle(bottle)
  .fail (err) ->
    console.log "ERROR reading #{filename}: #{err.message}"
    stream.close()

scanBottle = (bottle) ->
  switch bottle.type
    when lib4q.TYPE_FILE then dumpFileBottle(bottle)
    else
      console.log "ERROR: unknown bottle type #{bottle.type}"
  skipBottle(bottle)

skipBottle = (bottle) ->
  toolkit.qread(bottle).then (s) ->
    if not s? then return
    sink = new toolkit.NullSinkStream()
    toolkit.qpipe(s, sink).then ->
      skipBottle(bottle)

# -rw-r--r--   1 robey  staff    73B Aug 10 17:29 4q.sublime-project

# either "13:45:30" or "10 Aug 2014"
relativeDate = (nanos) ->
  d = new Date(nanos / Math.pow(10, 6))
  if d.getTime() > NOW or d.getTime() < NOW - HOURS_20
    strftime("%d %b %Y", d)
  else
    strftime("%H:%M:%S", d)

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

summaryLineForFile = (stats) ->
  mode = modeToWire(stats.mode or 0, stats.folder)
  username = (stats.username or "nobody")[...8]
  groupname = (stats.groupname or "nobody")[...8]
  size = display.humanize(stats.size)
  time = relativeDate(stats.modifiedNanos)
  sprintf("%s  %-8s %-8s %11s  %s  %s", mode, username, groupname, time, size, stats.filename)

dumpFileBottle = (bottle) ->
  console.log summaryLineForFile(bottle.header)


exports.main = main
