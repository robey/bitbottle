fs = require "fs"
minimist = require "minimist"
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

USAGE = """
usage: qpack [options] <filename(s)...>
    create a 4Q archive from a set of files (or folders)

options:
    --help
    -o <filename>
        archive filename to write
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

  counter = new CountingMonster()
  if argv._.length > 1
    # files
    console.log "dammit."
  else
    archiveFile(outStream, counter, argv._[0]).then ->
      outStream.close()
      console.log "\ndone."
    .done()


archiveFile = (outStream, counter, filename) ->
  counter.reset(filename)
  lib4q.writeFileBottleFromFile(filename).then (s) ->
    s.pipe(counter, end: false)
    counter.pipe(new toolkit.NullSinkStream())
    toolkit.qpipe(s, outStream, end: false)


class CountingMonster extends stream.Transform
  constructor: ->
    super(end: false)
    @totalBytes = 0
    @bytes = 0
    @lastUpdate = 0
    @frequency = 500

  reset: (filename) ->
    @bytes = 0
    @filename = filename

  _transform: (buffer, encoding, callback) ->
    if buffer?
      @bytes += buffer.length
      @totalBytes += buffer.length
    now = Date.now()
    if (not buffer?) or now > @lastUpdate + @frequency then @_updateDisplay()
    @push buffer
    callback()

  _flush: (callback) ->
    @_updateDisplay()
    callback()

  _updateDisplay: ->
    @lastUpdate = Date.now()
    display.displayStatus sprintf("  [%s/%s] %s", display.humanize(@bytes), display.humanize(@totalBytes), @filename)


exports.main = main
