antsy = require "antsy"
sprintf = require "sprintf"
util = require "util"

HUMAN_LABELS = " KMGTPE"
SPACE = "         "

COLORS =
  error: "#c00"

useColor = process.stdout.isTTY

noColor = -> useColor = false

humanize = (number, base = 1024.0) ->
  index = HUMAN_LABELS.indexOf(" ")
  number = Math.abs(number)
  originalNumber = number
  while number >= base and index < HUMAN_LABELS.length - 1
    number /= base
    index += 1
  if originalNumber > base
    number = if number < 10 then roundToPrecision(number, 2) else Math.round(number)
  label = HUMAN_LABELS[index]
  if label == " " then label = ""
  number = number.toString()[...4]
  # compensate for sloppy floating-point rounding:
  while number.indexOf(".") > 0 and number[number.length - 1] == "0"
    number = number[0 ... number.length - 1]
  number.toString()[...4] + label

roundToPrecision = (number, digits, op = "round") ->
  if number == 0 then return 0
  scale = digits - Math.floor(Math.log(number) / Math.log(10)) - 1
  Math[op](number * Math.pow(10, scale)) * Math.pow(10, -scale)

screenWidth = ->
  if process.stdout.isTTY then process.stdout.columns else 80

displayStatus = (message = "") ->
  return unless process.stdout.isTTY
  width = screenWidth() - 1
  message = message.toString()[...width]
  process.stdout.write(sprintf("\r%-#{width}s\r%s", " ", message))

displayError = (message) ->
  displayStatus ""
  process.stdout.write paint(color(COLORS.error, "ERROR"), ": ", message).toString() + "\n"


class Span
  constructor: (@color, @spans) ->

  toString: ->
    if @color? and useColor
      c = antsy.get_color(@color)
      esc = if c < 8
        "\u001b[0;3#{c}m"
      else if c < 16
        "\u001b[1;3#{c - 8}m"
      else
        "\u001b[38;5;#{c}m"
      esc + (@spans.map (span) -> span.toString()).join(esc) + "\u001b[0m"
    else
      @spans.map((span) -> span.toString()).join("")

paint = (spans...) ->
  new Span(null, spans)

color = (colorName, spans...) ->
  new Span(colorName, spans)


class StatusUpdater
  constructor: (@options = {}) ->
    @frequency = @options.frequency or 100
    @lastUpdate = 0
    @displayedMessage = null
    @currentMessage = null
    @timer = null

  update: (message) ->
    if not message? then message = @currentMessage
    if not message? then return
    @currentMessage = message
    now = Date.now()
    nextTime = @lastUpdate + @frequency
    if now >= nextTime
      displayStatus @currentMessage
      @displayedMessage = @currentMessage
      @lastUpdate = now
      if @timer? then clearTimeout(@timer)
      @timer = null
    else
      if not @timer? then @timer = setTimeout((=> @update()), nextTime - now)

  clear: ->
    if @timer? then clearTimeout(@timer)
    @timer = null
    @currentMessage = null
    if not @displayedMessage? then return
    displayStatus ""
    @displayedMessage = null


exports.color = color
exports.displayError = displayError
exports.displayStatus = displayStatus
exports.humanize = humanize
exports.noColor = noColor
exports.paint = paint
exports.roundToPrecision = roundToPrecision
exports.StatusUpdater = StatusUpdater
