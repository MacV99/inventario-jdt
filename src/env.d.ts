/// <reference types="astro/client" />

type ThemePref = "system" | "light" | "dark";

interface Window {
  __theme: {
    get(): ThemePref;
    set(value: ThemePref): void;
  };
}
