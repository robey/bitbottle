fs = require "fs"
Q = require "q"
sprintf = require "sprintf"
strftime = require "strftime"

display = require "./display"

# some helpers for the command-line tools.

COLORS =
  executable: "red"
  mode: "088"
  user_group: "088"
  timestamp: "blue"
  file_size: "green"
  status_count: "0c8"
  status_total_progress: "0c8"
  status_file_progress: "0af"

# this really should be part of js. :/
copy = (obj, fields) ->
  rv = {}
  for k, v of obj then rv[k] = v
  for k, v of fields then rv[k] = v
  rv

# read a file into a stream, bailing with sys.exit(1) on errors.
readStream = (filename, showStack = false) ->
  try
    fd = fs.openSync(filename, "r")
  catch error
    console.log "ERROR reading #{filename}: #{error.message}"
    if showStack then console.log error.stack
    process.exit(1)
  
  stream = fs.createReadStream(filename, fd: fd)
  stream.on "error", (error) ->
    console.log "ERROR reading #{filename}: #{error.message}"
    if showStack then console.log error.stack
    process.exit(1)
  stream

# given a list, and a map function that returns promises, do them one at a time.
foreachSerial = (list, f) ->
  if list.length == 0 then return Q()
  item = list.shift()
  f(item).then ->
    foreachSerial(list, f)

# NOW = Date.now()
# HOURS_20 = 20 * 60 * 60 * 1000
# DAYS_250 = 250 * 24 * 60 * 60 * 1000

# # either "13:45" or "10 Aug" or "2014"
# # (25 Aug 2014: this is stupid.)
# relativeDate = (nanos) ->
#   d = new Date(nanos / Math.pow(10, 6))
#   if d.getTime() > NOW or d.getTime() < NOW - DAYS_250
#     strftime("%Y", d)
#   else if d.getTime() < NOW - HOURS_20
#     strftime("%b %d", d)
#   else
#     strftime("%H:%M", d)

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


exports.COLORS = COLORS
exports.copy = copy
exports.foreachSerial = foreachSerial
exports.readStream = readStream
exports.summaryLineForFile = summaryLineForFile
