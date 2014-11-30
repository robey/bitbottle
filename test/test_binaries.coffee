crypto = require "crypto"
fs = require "fs"
mocha_sprinkles = require "mocha-sprinkles"
path = require "path"
util = require "util"

exec = mocha_sprinkles.exec
future = mocha_sprinkles.future
withTempFolder = mocha_sprinkles.withTempFolder

qpack = "#{process.cwd()}/bin/qpack"
qls = "#{process.cwd()}/bin/qls"
qunpack = "#{process.cwd()}/bin/qunpack"

sourceFolder = "#{process.cwd()}/src"
xzFolder = "#{process.cwd()}/node_modules/xz"

hashFile = (filename) ->
  h = crypto.createHash("sha512")
  h.update(fs.readFileSync(filename))
  x = h.digest()
  x

# uh?
arraysAreEqual = (x, y) ->
  if x.length != y.length then return false
  for i in [0 ... x.length] then if x[i] != y[i] then return false
  true

compareFolders = (folder1, folder2) ->
  files1 = fs.readdirSync(folder1).sort()
  files2 = fs.readdirSync(folder2).sort()
  if not arraysAreEqual(files1, files2) then throw new Error("Different file sets in #{folder1} vs #{folder2}")
  for filename in files1
    fullFilename1 = path.join(folder1, filename)
    fullFilename2 = path.join(folder2, filename)
    if fs.statSync(fullFilename1).isDirectory()
      if not fs.statSync(fullFilename2).isDirectory() then throw new Error("Expected folder: #{fullFilename1} is, #{fullFilename2} is not.")
      compareFolders(fullFilename1, fullFilename2)
    else
      if fs.statSync(fullFilename2).isDirectory() then throw new Error("Expected folder: #{fullFilename1} is not, #{fullFilename2} is.")
      if hashFile(fullFilename1).toString("hex") != hashFile(fullFilename2).toString("hex")
        throw new Error("File #{fullFilename1} != #{fullFilename2}")


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

  it "packs, lists, and unpacks a folder of files", future withTempFolder (folder) ->
    fs.mkdirSync("#{folder}/in")
    fs.writeFileSync "#{folder}/in/file1", "part 1\n"
    fs.writeFileSync "#{folder}/in/file2", "part two\n"
    fs.writeFileSync "#{folder}/in/file3", "part 333333\n"
    exec("#{qpack} -o #{folder}/test.4q #{folder}/in").then ->
      fs.existsSync("#{folder}/test.4q").should.eql(true)
      exec("#{qls} -l #{folder}/test.4q")
    .then (p) ->
      # three files, each length 8
      p.stdout.should.match /\s7\s*in\/file1\s/
      p.stdout.should.match /\s9\s*in\/file2\s/
      p.stdout.should.match /\s12\s*in\/file3\s/
      exec("#{qunpack} -o #{folder}/out #{folder}/test.4q")
    .then (p) ->
      fs.existsSync("#{folder}/out/in/file1").should.eql(true)
      fs.readFileSync("#{folder}/out/in/file1").toString().should.eql("part 1\n")
      fs.existsSync("#{folder}/out/in/file2").should.eql(true)
      fs.readFileSync("#{folder}/out/in/file2").toString().should.eql("part two\n")
      fs.existsSync("#{folder}/out/in/file3").should.eql(true)
      fs.readFileSync("#{folder}/out/in/file3").toString().should.eql("part 333333\n")

  describe "preserves file contents", ->
    it "source, with --snappy", future withTempFolder (folder) ->
      exec("#{qpack} -q -o #{folder}/src.4q #{sourceFolder} -S").then ->
        fs.existsSync("#{folder}/src.4q").should.eql(true)
        exec("#{qunpack} -q -o #{folder}/src2 #{folder}/src.4q")
      .then ->
        exec("#{qls} -q #{folder}/src.4q").then (p) ->
          console.log p.stdout
          compareFolders("#{sourceFolder}", "#{folder}/src2/src")

    it "node_modules, with --snappy", future withTempFolder (folder) ->
      exec("#{qpack} -q -o #{folder}/xz.4q #{xzFolder} -S").then ->
        fs.existsSync("#{folder}/xz.4q").should.eql(true)
        exec("#{qunpack} -q -o #{folder}/xz #{folder}/xz.4q")
      .then ->
        exec("#{qls} -q #{folder}/xz.4q").then (p) ->
          console.log p.stdout
          compareFolders("#{xzFolder}", "#{folder}/xz/xz")

    it "source, with xz", future withTempFolder (folder) ->
      exec("#{qpack} -q -o #{folder}/src.4q #{sourceFolder}").then ->
        fs.existsSync("#{folder}/src.4q").should.eql(true)
        exec("#{qunpack} -q -o #{folder}/src2 #{folder}/src.4q")
      .then ->
        exec("#{qls} -q #{folder}/src.4q").then (p) ->
          console.log p.stdout
          compareFolders("#{sourceFolder}", "#{folder}/src2/src")

    it "node_modules, with xz", future withTempFolder (folder) ->
      exec("#{qpack} -q -o #{folder}/xz.4q #{xzFolder}").then ->
        fs.existsSync("#{folder}/xz.4q").should.eql(true)
        exec("#{qunpack} -q -o #{folder}/xz #{folder}/xz.4q")
      .then ->
        exec("#{qls} -q #{folder}/xz.4q").then (p) ->
          console.log p.stdout
          compareFolders("#{xzFolder}", "#{folder}/xz/xz")



