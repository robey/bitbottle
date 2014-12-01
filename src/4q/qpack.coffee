crypto = require "crypto"
fs = require "fs"
minimist = require "minimist"
path = require "path"
Promise = require "bluebird"
sprintf = require "sprintf"
stream = require "stream"
strftime = require "strftime"
toolkit = require "stream-toolkit"
util = require "util"

display = require "./display"
helpers = require "./helpers"
keybaser = require "./keybaser"
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
    -v
        verbose: display files as they're written
    -q
        quiet: display nothing unless there's an error
    -Z, --no-compress
        do not compress the contents
    -S, --snappy
        use snappy compression instead of LZMA2
    -H, --no-hash
        do not compute a check hash (let go and use the force)
    -e <user>, --encrypt <user>
        encrypt archive for a keybase user (may be used multiple times to
        send to multiple recipients)
    --no-color
        turn off cool console colors
"""

COLORS = helpers.COLORS

main = ->
  keybaser = new keybaser.Keybaser()

  argv = minimist process.argv[2...],
    alias: { "Z": "no-compress", "H": "no-hash", "S": "snappy", "e": "encrypt" }
    boolean: [ "help", "version", "v", "q", "color", "compress", "snappy", "debug" ]
    default: { color: true, compress: true, hash: true }
  # minimist isn't great at decoding -Z:
  if argv["no-compress"]? then argv.compress = false
  if argv["no-hash"]? then argv.hash = false
  if argv.help or argv._.length == 0
    console.log USAGE
    process.exit(0)
  if argv.version
    console.log "qpack #{VERSION}"
    process.exit(0)
  if argv._.length == 0
    console.log "Required: filename(s) to archive"
    process.exit(1)
  if not argv.color then display.noColor()
  if not argv.o?
    argv.o = if argv._.length > 1
      "archive.4q"
    else
      archiveFolder = argv._[0]
      if archiveFolder[archiveFolder.length - 1] == "/" then archiveFolder = archiveFolder[0 ... archiveFolder.length - 1]
      archiveFolder + ".4q"

  # quick sanity check: do all these files exist?
  okay = true
  for filename in argv._
    if not fs.existsSync(filename)
      console.log "Can't find file: #{filename}"
      okay = false
  if not okay then process.exit(1)

  (if argv.encrypt?
    if not Array.isArray(argv.encrypt) then argv.encrypt = [ argv.encrypt ]
    keybaser.check().catch (error) ->
      display.displayError "Keybase error: #{helpers.messageForError(error)}"
      if argv.debug then console.log error.stack
      process.exit(1)
  else
    Promise.resolve()
  ).then ->
    die = (error) ->
      display.displayError "Unable to write #{argv.o}: #{helpers.messageForError(error)}"
      if argv.debug then console.log error.stack
      process.exit(1)

    try
      fd = fs.openSync(argv.o, "w")
    catch error
      die(error)
    outStream = fs.createWriteStream(filename, fd: fd)
    toolkit.promisify(outStream)

    state =
      fileCount: 0
      totalBytesOut: 0
      totalBytesIn: 0
      currentFileBytes: 0
      currentFileTotalBytes: 0
      currentFilename: null
    updater = new display.StatusUpdater()
    countingOutStream = toolkit.countingStream()
    countingOutStream.on "count", (n) ->
      state.totalBytesOut = n
      unless argv.q then updater.update statusMessage(state)
    countingOutStream.pipe(outStream)
    targetStream = countingOutStream

    (if argv.encrypt?
      encrypter = (recipient, buffer) ->
        [ scheme, name ] = recipient.split(":")
        if scheme != "keybase" then throw new Error("Expected keybase scheme, got #{scheme}")
        keybaser.encrypt(buffer, name, updater: updater)
      recipients = argv.encrypt.map (name) -> "keybase:#{name}"
      encryptedBottle = new lib4q.EncryptedBottleWriter(lib4q.ENCRYPTION_AES_256, recipients, encrypter)
      encryptedBottle.pipe(targetStream)
      targetStream = encryptedBottle
      encryptedBottle.on "error", die
      encryptedBottle.ready
    else if argv.password?
      # this is really bad. don't use it.
      Promise.promisify(crypto.pbkdf2)(argv.password, helpers.SALT, 10000, 48).then (keyBuffer) ->
        encryptedBottle = new lib4q.EncryptedBottleWriter(lib4q.ENCRYPTION_AES_256, [], keyBuffer)
        encryptedBottle.pipe(targetStream)
        targetStream = encryptedBottle
        encryptedBottle.on "error", die
        encryptedBottle.ready
    else
      Promise.resolve()
    ).then ->

      if argv.hash
        hashBottle = new lib4q.HashBottleWriter(lib4q.HASH_SHA512)
        hashBottle.pipe(targetStream)
        targetStream = hashBottle

      if argv.compress
        compressionType = if argv.snappy then lib4q.COMPRESSION_SNAPPY else lib4q.COMPRESSION_LZMA2
        compressedBottle = new lib4q.CompressedBottleWriter(compressionType)
        compressedBottle.pipe(targetStream)
        targetStream = compressedBottle

      writer = new lib4q.ArchiveWriter()
      writer.on "filename", (filename, header) ->
        if argv.v
          unless argv.q then updater.clear()
          printFinishedFile(state)
        state.currentFileBytes = 0
        state.currentFileTotalBytes = header.size
        state.currentFilename = filename
        state.isFolder = header.folder
        if not header.folder
          state.fileCount += 1
          state.totalBytesIn += header.size
        unless argv.q then updater.update statusMessage(state)
      writer.on "status", (filename, byteCount) ->
        state.currentFileBytes = byteCount
        unless argv.q then updater.update statusMessage(state)
      writer.on "error", die

      promise = if argv._.length > 1
        # multiple files: just make a fake folder
        folderName = path.basename(argv.o, ".4q")
        writer.archiveFiles(folderName, argv._)
      else
        writer.archiveFile(argv._[0])
      promise.then (bottle) ->
        bottle.pipe(targetStream)
        outStream.finishPromise()
      .then ->
        if argv.v then printFinishedFile(state)
        unless argv.q
          updater.clear()
          compressionStatus = if argv.compress then display.paint(" -> ", display.color(COLORS.file_size, display.humanize(state.totalBytesOut) + "B")) else ""
          inStatus = display.color(COLORS.file_size, "(#{state.fileCount} files, #{display.humanize(state.totalBytesIn)}B)")
          process.stdout.write "#{argv.o} #{inStatus}#{compressionStatus}\n"
  .catch (error) ->
    display.displayError "Unable to write #{argv.o}: #{helpers.messageForError(error)}"
    if argv.debug then console.log error.stack
    process.exit(1)
  .done()


statusMessage = (state) ->
  return unless state.currentFilename?
  count = display.color(COLORS.status_count, sprintf("%6s", state.fileCount))
  totalProgress = display.color(COLORS.status_total_progress, sprintf("%5s -> %5s", display.humanize(state.totalBytesIn), display.humanize(state.totalBytesOut)))
  fileProgress = if state.currentFileBytes > 0 and state.currentFileTotalBytes?
    display.color(COLORS.status_file_progress, "(#{Math.floor(100 * state.currentFileBytes / state.currentFileTotalBytes)}%)")
  else
    ""
  display.paint(count, ": (", totalProgress, ")  ", state.currentFilename, " ", fileProgress)

printFinishedFile = (state) ->
  return unless state.currentFilename?
  bytes = if state.isFolder then "     " else display.color(COLORS.file_size, sprintf("%5s", display.humanize(state.currentFileTotalBytes)))
  process.stdout.write display.paint("  ", bytes, "  ", state.currentFilename).toString() + "\n"

launchKeybase = () ->
  

exports.main = main
