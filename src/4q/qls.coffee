fs = require "fs"
minimist = require "minimist"
Q = require "q"
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
    displays contents of 4q archives

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
  for filename in argv._
    dumpArchiveFile(filename)

dumpArchiveFile = (filename) ->
  try
    fd = fs.openSync(filename, "r")
  catch err
    console.log "ERROR reading #{filename}: #{err.message}"
    return Q()
  
  stream = fs.createReadStream(filename, fd: fd)
  stream.on "error", (err) ->
    console.log "ERROR reading #{filename}: #{err.message}"
    stream.close()
  bottle = new lib4q.ReadableBottle(stream)
  x = toolkit.qread(bottle).then (item) ->
    console.log util.inspect(item)
  .fail (err) ->
    console.log "ERROR reading #{filename}: #{err.message}"
    stream.close()
  .done()
  

# -rw-r--r--   1 robey  staff    73B Aug 10 17:29 4q.sublime-project

# either "13:45:30" or "10 Aug 2014"
relativeDate = (nanos) ->
  d = new Date(nanos / Math.pow(10, 6))
  if d.getTime() > now or d.getTime() < now - HOURS_20
    strftime("%d %b %Y", d)
  else
    strftime("%H:%M:%S")

# convert a numeric mode into the "-rw----" wire
modeToWire = (mode) ->
  octize = (n) ->
    [
      if n & 4 != 0 then "r" else "-"
      if n & 2 != 0 then "w" else "-"
      if n & 1 != 0 then "x" else "-"
    ].join("")
  octize((mode >> 6) & 7) + octize((mode >> 3) & 7) + octize(mode & 7)

summaryLineForFile = (stats) ->
  mode = modeToWire(stats.mode or 0)
  username = display.lpad((stats.username or "nobody")[...8], 8)
  groupname = display.lpad((stats.groupname or "nobody")[...8], 8)
  size = display.humanize(stats.size)
  time = relativeDate(stats.modifiedNanos)
  "#{mode} #{username} #{groupname} #{time}  #{size}  #{stats.filename}"

dumpFileBottle = (bottle) ->
  toolkit.qread(bottle)


exports.main = main
