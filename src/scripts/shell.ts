// The shell behind every control on the site. Buttons, keys and the prompt
// all run the same commands through `exec`, so anything you can click you can
// also type, and clicking shows you what you would have typed.
//
// The menu is not an overlay: it is the start screen, its own page at "/".
// Output always lands there, so nothing is ever drawn on top of a page.

import { navigate } from "astro:transitions/client";

export type Tone = "cmd" | "accent";

export interface Context {
    args: string[];
    raw: string;
    source: "shell" | "click" | "key";
    el?: HTMLElement | null;
    print: (text: string, tone?: Tone) => void;
    row: (name: string, desc: string, action: { cmd?: string; fill?: string }) => void;
}

export interface Command {
    name: string;
    aliases?: string[];
    usage?: string;
    summary: string;
    hidden?: boolean;
    /** Page commands are dropped on every navigation and re-registered. */
    scope?: "core" | "page";
    complete?: () => string[];
    run: (ctx: Context) => void;
}

type Entry =
    | { kind: "line"; text: string; tone?: Tone }
    | { kind: "row"; name: string; desc: string; cmd?: string; fill?: string };

const MENU_PATH = "/";
const registry = new Map<string, Command>();
const history: string[] = [];
// The transcript outlives the page that printed it.
const transcript: Entry[] = [];
let historyIndex = -1;
let activeIndex = 0;
let lastPage: string | null = null;
let scrollToEnd = false;
let echoTimer = 0;
let blocked = () => false;

const $ = (id: string) => document.getElementById(id);
const normalize = (path: string) => path.replace(/\/+$/, "") || "/";

export function register(command: Command) {
    registry.set(command.name, { scope: "core", ...command });
}

export function setBlocked(fn: () => boolean) {
    blocked = fn;
}

function find(name: string) {
    for (const command of registry.values()) {
        if (command.name === name || command.aliases?.includes(name)) {
            return command;
        }
    }
    return undefined;
}

export function visibleCommands() {
    return [...registry.values()].filter((command) => !command.hidden);
}

/* ---------------------------------------------------------------------------
   Output
   --------------------------------------------------------------------------- */

function renderEntry(entry: Entry) {
    if (entry.kind === "line") {
        const line = document.createElement("p");
        line.textContent = entry.text || "\u00a0";
        if (entry.tone) line.className = "is-" + entry.tone;
        return line;
    }
    // Rows in the output are as clickable as the section list above them.
    const row = document.createElement("button");
    row.type = "button";
    row.className = "term-row";
    if (entry.cmd) row.dataset.cmd = entry.cmd;
    if (entry.fill) row.dataset.fill = entry.fill;
    const caret = document.createElement("span");
    caret.className = "term-caret";
    caret.setAttribute("aria-hidden", "true");
    caret.textContent = ">";
    const name = document.createElement("span");
    name.className = "term-name";
    name.textContent = entry.name;
    const desc = document.createElement("span");
    desc.className = "term-desc";
    desc.textContent = entry.desc;
    row.append(caret, name, desc);
    return row;
}

function push(entry: Entry) {
    transcript.push(entry);
    while (transcript.length > 120) transcript.shift();
    const log = $("crt-log");
    if (!log) return;
    log.appendChild(renderEntry(entry));
    while (log.childElementCount > 120) log.firstElementChild?.remove();
    scrollMenuToEnd();
}

function scrollMenuToEnd() {
    const body = document.querySelector<HTMLElement>("#crt-menu .bios-body");
    if (body) requestAnimationFrame(() => (body.scrollTop = body.scrollHeight));
}

function renderTranscript() {
    const log = $("crt-log");
    if (!log) return;
    log.textContent = "";
    transcript.forEach((entry) => log.appendChild(renderEntry(entry)));
}

export function print(text: string, tone?: Tone) {
    push({ kind: "line", text, tone });
}

/** Forget everything typed and printed, as if the machine had been off. */
export function resetShell() {
    clearLog();
    history.length = 0;
    historyIndex = -1;
    const field = input();
    if (field) {
        field.value = "";
        field.blur();
    }
    setGhost("", "", "");
}

export function clearLog() {
    transcript.length = 0;
    const log = $("crt-log");
    if (log) log.textContent = "";
}

/* ---------------------------------------------------------------------------
   Prompt ghost: completion while typing, preview on hover, echo on click.
   One element, three states, so the prompt only ever says one thing.
   --------------------------------------------------------------------------- */

function input() {
    return $("shell-input") as HTMLInputElement | null;
}

function setGhost(typed: string, rest: string, mode: "suggest" | "preview" | "echo" | "") {
    const ghost = $("shell-ghost");
    if (!ghost) return;
    const typedEl = ghost.querySelector<HTMLElement>(".ghost-typed");
    const restEl = ghost.querySelector<HTMLElement>(".ghost-rest");
    if (typedEl) typedEl.textContent = typed;
    if (restEl) restEl.textContent = rest;
    ghost.dataset.mode = mode;
}

export function completion(value: string): string | null {
    const trimmed = value.replace(/^\s+/, "");
    // "/help" and "help" are the same command; the slash is kept as typed.
    const slash = trimmed.startsWith("/") ? "/" : "";
    const bare = trimmed.slice(slash.length);
    if (!bare) return null;
    const lower = bare.toLowerCase();
    const parts = lower.split(/\s+/);

    if (parts.length === 1) {
        const match = visibleCommands()
            .sort((a, b) => a.name.localeCompare(b.name))
            .find((command) => command.name.startsWith(lower) && command.name !== lower);
        if (!match) return null;
        // Commands that take an argument complete with the space after them,
        // so the next word can be typed straight away.
        const space = match.complete ? " " : "";
        return slash + bare + match.name.slice(lower.length) + space;
    }

    const command = find(parts[0]);
    const options = command?.complete?.() ?? [];
    const partial = parts.slice(1).join(" ");
    const match = options.find(
        (option) => option.startsWith(partial) && option !== partial
    );
    return match ? trimmed + match.slice(partial.length) : null;
}

function refreshSuggestion() {
    const field = input();
    if (!field) return;
    const value = field.value;
    const done = completion(value);
    if (done && value) setGhost(value, done.slice(value.length), "suggest");
    else setGhost("", "", "");
}

export function preview(command: string | null) {
    const field = input();
    if (!field || field.value || document.activeElement === field) return;
    window.clearTimeout(echoTimer);
    if (command) setGhost("", command, "preview");
    else setGhost("", "", "");
}

function echo(command: string) {
    const field = input();
    if (!field || field.value) return;
    window.clearTimeout(echoTimer);
    setGhost("", command, "echo");
    echoTimer = window.setTimeout(() => {
        const ghost = $("shell-ghost");
        if (ghost?.dataset.mode === "echo") ghost.dataset.mode = "fade";
    }, 1200);
}

/* ---------------------------------------------------------------------------
   Menu screen
   --------------------------------------------------------------------------- */

function menuItems() {
    return Array.from(
        document.querySelectorAll<HTMLElement>("#crt-menu .bios-item")
    );
}

function setActive(index: number) {
    const items = menuItems();
    if (!items.length) return;
    activeIndex = ((index % items.length) + items.length) % items.length;
    items.forEach((item, i) => item.classList.toggle("is-active", i === activeIndex));
}

export function onMenu() {
    return !!$("crt-menu");
}

export function openMenu() {
    if (blocked() || onMenu()) {
        if (scrollToEnd) scrollMenuToEnd();
        scrollToEnd = false;
        return;
    }
    navigate(MENU_PATH);
}

/** Back to the page the menu was opened from. */
export function closeMenu() {
    if (!onMenu()) return;
    navigate(lastPage ?? "/profile");
}

export function toggleMenu() {
    if (onMenu()) closeMenu();
    else openMenu();
}

/* ---------------------------------------------------------------------------
   Running commands
   --------------------------------------------------------------------------- */

export function exec(
    raw: string,
    options: { source?: Context["source"]; el?: HTMLElement | null } = {}
) {
    const line = raw.trim();
    if (!line || blocked()) return;
    const source = options.source ?? "shell";
    const [first, ...args] = line.split(/\s+/);
    const name = first.replace(/^\//, "").toLowerCase();
    const command = find(name);

    print("C:\\DIOGO> " + line, "cmd");
    if (source === "shell") {
        if (history[history.length - 1] !== line) history.push(line);
        historyIndex = -1;
    } else {
        echo(line);
    }

    let printed = false;
    const ctx: Context = {
        args,
        raw: line,
        source,
        el: options.el,
        print(text, tone) {
            printed = true;
            print(text, tone);
        },
        row(rowName, desc, action) {
            printed = true;
            push({ kind: "row", name: rowName, desc, ...action });
        },
    };

    if (!command) {
        ctx.print(`${name}: command not found. Type /help.`, "accent");
    } else {
        command.run(ctx);
    }
    // Output is read on the menu screen; actions speak for themselves.
    if (printed) {
        scrollToEnd = true;
        openMenu();
    }
}

/* ---------------------------------------------------------------------------
   Wiring, bound once. Elements are looked up at event time because every
   navigation replaces them.
   --------------------------------------------------------------------------- */

let bound = false;

export function bindShell() {
    if (bound) return;
    bound = true;

    // Capture phase, so a link with a command is handled before the router
    // sees it. Modified clicks still open links the normal way.
    document.addEventListener(
        "click",
        (event) => {
            const target = (event.target as HTMLElement).closest<HTMLElement>(
                "[data-cmd], [data-fill]"
            );
            if (!target) return;
            if (
                target instanceof HTMLAnchorElement &&
                (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0)
            ) {
                return;
            }
            event.preventDefault();
            if (target.dataset.fill !== undefined) {
                const field = input();
                if (!field) return;
                field.value = target.dataset.fill;
                field.focus();
                refreshSuggestion();
                return;
            }
            exec(target.dataset.cmd!, { source: "click", el: target });
        },
        true
    );

    if (window.matchMedia("(hover: hover) and (pointer: fine)").matches) {
        document.addEventListener("pointerover", (event) => {
            const target = (event.target as HTMLElement).closest<HTMLElement>("[data-cmd]");
            if (target) preview(target.dataset.cmd!);
        });
        document.addEventListener("pointerout", (event) => {
            const from = (event.target as HTMLElement).closest("[data-cmd]");
            const to = (event.relatedTarget as HTMLElement | null)?.closest?.("[data-cmd]");
            if (from && from !== to) {
                const ghost = $("shell-ghost");
                if (ghost?.dataset.mode === "preview") preview(null);
            }
        });
    }

    document.addEventListener("input", (event) => {
        if ((event.target as HTMLElement).id === "shell-input") refreshSuggestion();
    });

    document.addEventListener("focusin", (event) => {
        if ((event.target as HTMLElement).id === "shell-input") refreshSuggestion();
    });

    document.addEventListener("keydown", (event) => {
        const field = event.target as HTMLInputElement;
        if (field.id !== "shell-input") return;
        const value = field.value;
        const menu = onMenu();

        switch (event.key) {
            case "Enter": {
                event.preventDefault();
                if (value.trim() && value.trim() !== "/") {
                    field.value = "";
                    setGhost("", "", "");
                    exec(value, { source: "shell" });
                } else if (menu) {
                    field.value = "";
                    menuItems()[activeIndex]?.click();
                }
                break;
            }
            case "Tab":
            case "ArrowRight": {
                const done = completion(value);
                const atEnd = field.selectionStart === value.length;
                if (done && value && (event.key === "Tab" || atEnd)) {
                    event.preventDefault();
                    field.value = done;
                    refreshSuggestion();
                }
                break;
            }
            case "ArrowUp":
            case "ArrowDown": {
                event.preventDefault();
                const up = event.key === "ArrowUp";
                // On the menu with nothing typed, the arrows walk the
                // sections; otherwise they walk the history.
                if (menu && !value && historyIndex === -1) {
                    setActive(activeIndex + (up ? -1 : 1));
                    break;
                }
                if (!history.length) break;
                if (historyIndex === -1) historyIndex = history.length;
                historyIndex = Math.min(history.length, Math.max(0, historyIndex + (up ? -1 : 1)));
                field.value = history[historyIndex] ?? "";
                if (historyIndex === history.length) historyIndex = -1;
                refreshSuggestion();
                break;
            }
            case "Escape": {
                event.preventDefault();
                event.stopPropagation();
                if (value) {
                    field.value = "";
                    setGhost("", "", "");
                    historyIndex = -1;
                } else {
                    field.blur();
                    exec("menu", { source: "key" });
                }
                break;
            }
            default:
                if (menu && !value && /^[1-5]$/.test(event.key)) {
                    event.preventDefault();
                    menuItems()[Number(event.key) - 1]?.click();
                }
        }
    });

    // The start screen answers the arrows wherever focus is: after the boot,
    // a click to skip it or a stray Tab, the prompt may not have it.
    document.addEventListener("keydown", (event) => {
        if (!onMenu() || blocked() || event.defaultPrevented) return;
        if (event.metaKey || event.ctrlKey || event.altKey) return;
        const target = event.target as HTMLElement;
        if (target.id === "shell-input") return;
        if (target.closest?.("input, textarea, select, [contenteditable]")) return;
        if (event.key === "ArrowUp" || event.key === "ArrowDown") {
            event.preventDefault();
            setActive(activeIndex + (event.key === "ArrowUp" ? -1 : 1));
            input()?.focus();
        } else if (event.key === "Enter" && !target.closest?.("a, button")) {
            event.preventDefault();
            menuItems()[activeIndex]?.click();
        }
    });

    // Once the boot hands the screen over, the prompt is ready to type into.
    document.addEventListener("crt:booted", () => {
        if (onMenu() && window.matchMedia("(pointer: fine)").matches) input()?.focus();
    });

    // A page change rebuilds the prompt; if you were typing, keep typing.
    let refocus = false;
    document.addEventListener("astro:page-load", () => {
        const path = normalize(location.pathname);
        if (path !== MENU_PATH) lastPage = path;

        if (onMenu()) {
            renderTranscript();
            // Start on the section you came from, or the first one.
            const items = menuItems();
            const from = items.findIndex(
                (item) => item.getAttribute("href") === lastPage
            );
            setActive(Math.max(0, from));
            if (scrollToEnd) scrollMenuToEnd();
            scrollToEnd = false;
            // A terminal is ready to type into, where typing is cheap.
            if (window.matchMedia("(pointer: fine)").matches) refocus = true;
        }
        if (refocus) input()?.focus();
        refocus = false;
    });

    document.addEventListener("astro:before-swap", () => {
        refocus = document.activeElement === input();
        for (const [name, command] of registry) {
            if (command.scope === "page") registry.delete(name);
        }
        historyIndex = -1;
    });
}
