import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { unquote } from "./config.js";

describe("unquote", () => {
  it("strips the quotes docker's --env-file leaves behind", () => {
    assert.equal(
      unquote('"postgres://u:p@dokploy-postgres:5432/dokploy"'),
      "postgres://u:p@dokploy-postgres:5432/dokploy",
    );
    assert.equal(unquote("'single'"), "single");
  });

  it("leaves unquoted values alone", () => {
    assert.equal(
      unquote("postgres://u:p@host:5432/db"),
      "postgres://u:p@host:5432/db",
    );
  });

  it("does not strip quotes that are part of the value", () => {
    assert.equal(unquote('say "hi"'), 'say "hi"');
    assert.equal(unquote('"unbalanced'), '"unbalanced');
    assert.equal(unquote('pass"word"'), 'pass"word"');
  });

  it("handles short and empty values without slicing them away", () => {
    assert.equal(unquote(""), "");
    assert.equal(unquote('"'), '"');
    assert.equal(unquote('""'), "");
  });
});
