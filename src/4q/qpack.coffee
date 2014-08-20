fs = require "fs"
minimist = require "minimist"
path = require "path"
Q = require "q"
sprintf = require "sprintf"
stream = require "stream"
strftime = require "strftime"
toolkit = require "stream-toolkit"
util = require "util"

display = require "./display"
lib4q = require "./lib4q"
paint = require("./paint").paint

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
  promise1 = toolkit.qpipe(counter, outStream)
  promise2 = if argv._.length > 1
    # multiple files: just make a fake folder
    folderName = path.join(path.dirname(argv.o), path.basename(argv.o, ".4q"))
    nowNanos = Date.now() * Math.pow(10, 6)
    stats =
      folder: true
      filename: folderName
      mode: 0x1c0
      createdNanos: nowNanos
      modifiedNanos: nowNanos
      accessedNanos: nowNanos
    s = lib4q.writeFileBottle(stats, null)
    Q.all([
      pushBottle(counter, s)
      archiveFiles(s, counter, null, argv._, folderName).then ->
        s.close()
    ])
  else
    archiveFile(counter, counter, argv._[0], null)
  Q.all([ promise1, promise2 ]).then ->
    counter.close()
    outStream.close()
    console.log "done."
  .fail (err) ->
    console.log "\nERROR: #{err.message}"
    process.exit(1)
  .done()


archiveFiles = (outStream, counter, folder, filenames, prefix) ->
  if filenames.length == 0 then return Q()
  filename = filenames.shift()
  filepath = if folder? then path.join(folder, filename) else filename
  archiveFile(outStream, counter, filepath, prefix).then ->
    archiveFiles(outStream, counter, folder, filenames, prefix)

archiveFile = (outStream, counter, filename, prefix) ->
  basename = path.basename(filename)
  qify(fs.stat)(filename).then (stats) ->
    stats = lib4q.fileHeaderFromStats(filename, basename, stats)
    displayName = if prefix? then path.join(prefix, basename) else basename
    counter.setName(displayName)
    if stats.folder
      archiveFolder(outStream, counter, filename, prefix, stats, displayName)
    else
      qify(fs.open)(filename, "r").then (fd) ->
        fileStream = fs.createReadStream(filename, fd: fd)
        pushBottle(outStream, lib4q.writeFileBottle(stats, fileStream))

archiveFolder = (outStream, counter, folder, prefix, stats, displayName) ->
  s = lib4q.writeFileBottle(stats, null)
  qify(fs.readdir)(folder).then (files) ->
    Q.all([
      pushBottle(outStream, s)
      archiveFiles(s, counter, folder, files, displayName).then ->
        s.close()
    ])

pushBottle = (outStream, bottle) ->
  if outStream instanceof lib4q.WritableBottle
    outStream.writeData(bottle)
  else
    toolkit.qpipe(bottle, outStream, end: false)

qify = (f) ->
  (arg...) ->
    deferred = Q.defer()
    f arg..., (err, rv) ->
      if err? then return deferred.reject(err)
      deferred.resolve(rv)
    deferred.promise


class CountingMonster extends stream.Transform
  constructor: ->
    super(end: false)
    @totalBytes = 0
    @bytes = 0
    @lastUpdate = 0
    @frequency = 500
    @flushedLine = true

  setName: (filename, readable) ->
    if not @flushedLine then @_updateDisplay(true)
    @bytes = 0
    @filename = filename
    @_updateDisplay()
    @flushedLine = false

  close: ->
    @push null

  _transform: (buffer, encoding, callback) ->
    if buffer?
      @bytes += buffer.length
      @totalBytes += buffer.length
    now = Date.now()
    if now > @lastUpdate + @frequency
      @lastUpdate = now
      @_updateDisplay()
    @push buffer
    callback()

  _flush: (callback) ->
    @lastUpdate = 0
    @_updateDisplay(true)
    @flushedLine = true
    callback()

  _updateDisplay: (lf = false) ->
    if @filename?
      progress = paint.color("cyan", sprintf("[%s/%s]", display.humanize(@bytes), display.humanize(@totalBytes)))
      display.displayStatus paint("  ", progress, " ", @filename, " ")
    #if lf then process.stdout.write "\n"


exports.main = main
