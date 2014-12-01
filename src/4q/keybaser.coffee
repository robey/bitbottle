child_process = require "child_process"
Promise = require "bluebird"
toolkit = require "stream-toolkit"
util = require "util"

display = require "./display"

# keybase support!

KEYBASE_BINARY = "keybase"

class Keybaser
  constructor: ->
    @identity = null

  # return true if keybase is actually installed and we got an identity
  check: ->
    if @identity? then return Promise.resolve()
    display.displayStatus "Checking keybase..."
    p = child_process.spawn(KEYBASE_BINARY, [ "status" ], stdio: [ "ignore", "pipe", process.stderr ])
    waitForProcess(p).then (code) =>
      if code != 0 then throw new Error("Keybase exit code #{code}")
      toolkit.pipeToBuffer(p.stdout).then (stdout) =>
        status = JSON.parse(stdout)
        if not status?.status?.configured? then throw new Error("Keybase is not configured.")
        if not status?.status?.logged_in? then throw new Error("You aren't currently logged in to keybase.")
        if not status?.user?.name? then throw new Error("Can't determine your keybase username")
        display.displayStatus ""
        @identity = status.user.name
    .catch (error) =>
      # translate a particularly odd error
      if error.code == "ENOENT" and error.syscall == "spawn"
        throw new Error("Can't find keybase binary.")
      throw error

  encrypt: (key, target, options = {}) ->
    args = [ "encrypt", "--message", key.toString("base64") ]
    if options.sign then args.push "--sign"
    args.push target
    if options.updater? then options.updater.update "Encrypting key for #{target} ..."
    p = child_process.spawn(KEYBASE_BINARY, args, stdio: [ process.stdin, "pipe", process.stderr ])
    waitForProcess(p).then (code) =>
      if options.updater? then options.updater.update ""
      toolkit.pipeToBuffer(p.stdout).then (buffer) =>
        if code != 0 then throw new Error("Keybase exit code #{code}")
        buffer

  decrypt: (encrypted) ->
    args = [ "decrypt", "--batch", "--message", encrypted ]
    display.displayStatus "Decrypting key as #{@identity} ..."
    p = child_process.spawn(KEYBASE_BINARY, args, stdio: [ process.stdin, "pipe", process.stderr ])
    waitForProcess(p).then (code) =>
      if code != 0 then throw new Error("Keybase exit code #{code}")
      display.displayStatus ""
      toolkit.pipeToBuffer(p.stdout).then (data) =>
        new Buffer(data.toString(), "base64")


waitForProcess = (process) ->
  deferred = Promise.defer()
  process.on "error", (error) ->
    try
      deferred.reject(error)
    catch e
      # fine.
  process.on "exit", (code, signal) ->
    if signal?
      deferred.reject("Process exited abnormally: " + signal)
    else
      deferred.resolve(code)
  deferred.promise


exports.Keybaser = Keybaser
