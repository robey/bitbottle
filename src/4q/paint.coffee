antsy = require "antsy"
util = require "util"

class Span
  constructor: (@color, @spans) ->

  toString: ->
    if @color?
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

paint.color = (colorName, spans...) ->
  new Span(colorName, spans)


exports.paint = paint
