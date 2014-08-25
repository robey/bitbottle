antsy = require "antsy"
sprintf = require "sprintf"
util = require "util"

HUMAN_LABELS = " KMGTPE"
SPACE = "         "

useColor = process.stdout.isTTY

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


exports.color = color
exports.displayStatus = displayStatus
exports.humanize = humanize
exports.paint = paint
exports.roundToPrecision = roundToPrecision
