const assert = require("node:assert/strict");
const test = require("node:test");
const SmsCsv = require("./csv");

test("quotes CSV values containing delimiters, quotes, or line breaks", () => {
  assert.equal(SmsCsv.cell('Green Valley, "Primary"\nSchool'), '"Green Valley, ""Primary""\nSchool"');
});

test("neutralizes formula prefixes in untrusted text", () => {
  for (const value of ["=1+1", "+SUM(A1:A2)", "-2+3", "@SUM(A1)", " \t=1+1"]) {
    assert.equal(SmsCsv.cell(value), `"\'${value}"`);
  }
});

test("preserves numeric values as numeric CSV cells", () => {
  assert.equal(SmsCsv.cell(-25), '"-25"');
  assert.equal(SmsCsv.cell(1200), '"1200"');
});
