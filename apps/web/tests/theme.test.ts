import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { parseThemePreference, resolveTheme, SYSTEM_DARK_QUERY, THEME_PREFERENCES, THEME_STORAGE_KEY, themeOptionLabel } from "../src/theme.ts";
import { messages } from "../src/i18n/catalog.ts";

test("a stored theme preference is read as itself, and anything else as System", () => {
  assert.equal(parseThemePreference("light"), "light");
  assert.equal(parseThemePreference("dark"), "dark");
  for (const value of ["system", null, undefined, "", "Dark", "sepia", 1]) assert.equal(parseThemePreference(value), "system");
});

test("System resolves to the operating system's theme; Light and Dark ignore it", () => {
  assert.equal(resolveTheme("system", true), "dark");
  assert.equal(resolveTheme("system", false), "light");
  for (const systemDark of [true, false]) {
    assert.equal(resolveTheme("light", systemDark), "light");
    assert.equal(resolveTheme("dark", systemDark), "dark");
  }
});

test("the selector offers System, Light, and Dark, and System names the theme it resolves to", () => {
  assert.deepEqual(THEME_PREFERENCES, ["system", "light", "dark"]);
  assert.deepEqual(THEME_PREFERENCES.map(option => themeOptionLabel(option, true, messages("en"))), ["System (dark)", "Light", "Dark"]);
  assert.equal(themeOptionLabel("system", false, messages("en")), "System (light)");
});

test("the pre-paint script in index.html uses the same storage key and media query", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  assert.ok(html.includes(`localStorage.getItem("${THEME_STORAGE_KEY}")`));
  assert.ok(html.includes(`matchMedia("${SYSTEM_DARK_QUERY}")`));
});

test("ADR-007: theme labels follow the interface language", () => {
  assert.deepEqual(THEME_PREFERENCES.map(option => themeOptionLabel(option, false, messages("es"))), ["Sistema (claro)", "Claro", "Oscuro"]);
});
