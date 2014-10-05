fs = require "fs"
mocha_sprinkles = require "mocha-sprinkles"
path = require "path"
Q = require "q"
# shell = require 'shelljs'
# should = require 'should'
# touch = require 'touch'
util = require "util"

exec = mocha_sprinkles.exec
future = mocha_sprinkles.future
withTempFolder = mocha_sprinkles.withTempFolder

qpack = "#{process.cwd()}/bin/qpack"
qls = "#{process.cwd()}/bin/qls"
qunpack = "#{process.cwd()}/bin/qunpack"

#
# effectively, these are integration tests.
# verify the behavior of "qpack", "qls", and "qunpack".
#
describe "bin/qpack", ->
  it "responds to --help", future ->
    exec("#{qpack} --help").then (p) ->
      p.stderr.toString().should.eql("")
      p.stdout.toString().should.match /usage:/
      p.stdout.toString().should.match /options:/

  it "packs, lists, and unpacks a single file", future withTempFolder (folder) ->
    fs.writeFileSync "#{folder}/file1", "nothing\n"
    exec("#{qpack} #{folder}/file1").then ->
      fs.existsSync("#{folder}/file1.4q").should.eql(true)
      exec("#{qls} -l #{folder}/file1.4q")
    .then (p) ->
      p.stdout.should.match /\sfile1\s/
      p.stdout.should.match /\s8\s/   # file length
      exec("#{qunpack} -o #{folder}/out #{folder}/file1.4q")
    .then (p) ->
      fs.existsSync("#{folder}/out/file1").should.eql(true)
      fs.readFileSync("#{folder}/out/file1").toString().should.eql("nothing\n")

  it "packs, lists, and unpacks a set of files", future withTempFolder (folder) ->
    fs.writeFileSync "#{folder}/file1", "nothing\n"
    fs.writeFileSync "#{folder}/file2", "nothing\n"
    fs.writeFileSync "#{folder}/file3", "nothing\n"
    exec("#{qpack} -o #{folder}/test.4q #{folder}/file1 #{folder}/file2 #{folder}/file3").then ->
      fs.existsSync("#{folder}/test.4q").should.eql(true)
      exec("#{qls} -l #{folder}/test.4q")
    .then (p) ->
      # three files, each length 8
      p.stdout.should.match /\s8\s*test\/file1\s/
      p.stdout.should.match /\s8\s*test\/file2\s/
      p.stdout.should.match /\s8\s*test\/file3\s/
      exec("#{qunpack} -o #{folder}/out #{folder}/test.4q")
    .then (p) ->
      fs.existsSync("#{folder}/out/test/file1").should.eql(true)
      fs.readFileSync("#{folder}/out/test/file1").toString().should.eql("nothing\n")
      fs.existsSync("#{folder}/out/test/file2").should.eql(true)
      fs.readFileSync("#{folder}/out/test/file2").toString().should.eql("nothing\n")
      fs.existsSync("#{folder}/out/test/file3").should.eql(true)
      fs.readFileSync("#{folder}/out/test/file3").toString().should.eql("nothing\n")

