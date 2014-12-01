crypto = require "crypto"
fs = require "fs"
minimist = require "minimist"
Promise = require "bluebird"
toolkit = require "stream-toolkit"
util = require "util"

display = require "./display"
helpers = require "./helpers"
keybaser = require "./keybaser"
lib4q = require "./lib4q"

VERSION = "1.0.0"

COLORS = helpers.COLORS

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

password = null

main = ->
  keybaser = new keybaser.Keybaser()

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
  if argv.password? then password = argv.password

  (if argv.structure then dumpArchiveStructures(argv._) else dumpArchiveFiles(argv._, argv.l, argv.q)).catch (error) ->
    display.displayError "Unable to read archive: #{helpers.messageForError(error)}"
    if argv.debug then console.log error.stack
    process.exit(1)
  .done()

dumpArchiveStructures = (filenames) ->
  Promise.map(filenames, ((filename) -> dumpArchiveStructure(filename)), concurrency: 1)

dumpArchiveStructure = (filename) ->
  indent = 0
  pad = -> [0 ... indent].map((x) -> " ").join("")

  reader = new lib4q.ArchiveReader()
  reader.decryptKey = (keymap) ->
    keybaser.check().then ->
      self = "keybase:#{keybaser.identity}"
      allowed = Object.keys(keymap).join(", ")
      if not keymap[self]? then throw new Error("No encryption key for #{self} (only: #{allowed})")
      keybaser.decrypt(keymap[self])

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
  reader.on "encrypt", (bottle) ->
    process.stdout.write display.paint(pad(), "[encrypted for: ", bottle.header.recipients.join(", "), "]").toString() + "\n"

  reader.scanStream(helpers.readStream(filename))

dumpArchiveFiles = (filenames, isVerbose, isQuiet) ->
  Promise.map(filenames, ((filename) -> dumpArchiveFile(filename, isVerbose, isQuiet)), concurrency: 1)

dumpArchiveFile = (filename, isVerbose, isQuiet) ->
  # count total bytes packed away
  state = { totalBytesIn: 0, totalBytes: 0, totalFiles: 0, prefix: [] }

  countingInStream = toolkit.countingStream()
  countingInStream.on "count", (n) ->
    state.totalBytesIn = n
  helpers.readStream(filename).pipe(countingInStream)

  reader = new lib4q.ArchiveReader()
  reader.decryptKey = (keymap) ->
    if Object.keys(keymap).length == 0
      if not password? then throw new Error("No password provided.")
      return Promise.promisify(crypto.pbkdf2)(password, helpers.SALT, 10000, 48)
    keybaser.check().then ->
      self = "keybase:#{keybaser.identity}"
      allowed = Object.keys(keymap).join(", ")
      if not keymap[self]? then throw new Error("No encryption key for #{self} (only: #{allowed})")
      keybaser.decrypt(keymap[self])

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
  reader.on "encrypt", (bottle) ->
    # FIXME display something if this is per-file
    if state.prefix.length == 0
      state.encryption = bottle.header.encryptionName
      if bottle.header.recipients.length > 0 then state.encryptedFor = bottle.header.recipients.join(" & ")

  reader.scanStream(countingInStream).then ->
    annotations = []
    importante = []
    if state.encryption?
      importante.push state.encryption + (if state.encryptedFor? then " for #{state.encryptedFor}" else "")
    if state.compression? then annotations.push state.compression
    if state.validHash? then annotations.push state.validHash
    compressionStatus = if state.compression? then display.paint(" -> ", display.color(COLORS.file_size, display.humanize(state.totalBytesOut) + "B")) else ""
    sizes = display.color(COLORS.file_size, "(#{state.totalFiles} files, #{display.humanize(state.totalBytesIn)}B)")
    extras = if importante.length > 0 then display.color(COLORS.importante, " [#{importante.join("; ")}]") else ""
    extras += if annotations.length > 0 then display.color(COLORS.annotations, " [#{annotations.join(", ")}]") else ""
    process.stdout.write "#{filename} #{sizes}#{extras}\n"


exports.main = main
