console.log("Castbox Sorter (v3.0 - native list) Loaded!");

// The list itself is rendered by Castbox (see page.js). This script adds the
// "Sort" control in place of Castbox's "Reverse" button, fetches the data
// needed for sorting (via background.js) and asks page.js to apply the order.

// --- Sort Options ---
const SORT_OPTIONS = {
  default: "Default",
  newest: "Newest",
  oldest: "Oldest",
  likes: "Most Liked",
  plays: "Most Played",
  comments: "Most Commented",
};
const STAT_SORTS = new Set(["likes", "plays", "comments"]); // Need per-episode stats

const CACHE_TTL_MS = 10 * 60 * 1000;
const BRIDGE_TIMEOUT_MS = 5000;
const APPLY_TIMEOUT_MS = 30000; // applyOrder waits for Castbox to load the first page
const FUNC_BTN_SELECTOR = "#trackList .trackListCon .funcBtn";
const TRACK_LIST_SELECTOR = "#trackList .trackListCon";
const LOADER_TEXT_DELAY_MS = 400; // Fast sorts finish before the text appears (no flash)

// Castbox's own list loader (component "LoadInline", page.castbox.main.*.js module 536):
// three gray dots, animated SVG shown as an <img>
const CASTBOX_LOADER_SRC =
  "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIzMiIgaGVpZ2h0PSIzMiIgZmlsbD0iI2NjYyI+PGNpcmNsZSB0cmFuc2Zvcm09InRyYW5zbGF0ZSg4KSIgY3k9IjE2IiByPSIwIj48YW5pbWF0ZSBhdHRyaWJ1dGVOYW1lPSJyIiB2YWx1ZXM9IjA7IDQ7IDA7IDAiIGR1cj0iMS4ycyIgcmVwZWF0Q291bnQ9ImluZGVmaW5pdGUiIGJlZ2luPSIwIiBrZXlTcGxpbmVzPSIwLjIgMC4yIDAuNCAwLjg7MC4yIDAuNiAwLjQgMC44OzAuMiAwLjYgMC40IDAuOCIgY2FsY01vZGU9InNwbGluZSIvPjwvY2lyY2xlPjxjaXJjbGUgdHJhbnNmb3JtPSJ0cmFuc2xhdGUoMTYpIiBjeT0iMTYiIHI9IjAiPjxhbmltYXRlIGF0dHJpYnV0ZU5hbWU9InIiIHZhbHVlcz0iMDsgNDsgMDsgMCIgZHVyPSIxLjJzIiByZXBlYXRDb3VudD0iaW5kZWZpbml0ZSIgYmVnaW49Ii4zIiBrZXlTcGxpbmVzPSIwLjIgMC4yIDAuNCAwLjg7MC4yIDAuNiAwLjQgMC44OzAuMiAwLjYgMC40IDAuOCIgY2FsY01vZGU9InNwbGluZSIvPjwvY2lyY2xlPjxjaXJjbGUgdHJhbnNmb3JtPSJ0cmFuc2xhdGUoMjQpIiBjeT0iMTYiIHI9IjAiPjxhbmltYXRlIGF0dHJpYnV0ZU5hbWU9InIiIHZhbHVlcz0iMDsgNDsgMDsgMCIgZHVyPSIxLjJzIiByZXBlYXRDb3VudD0iaW5kZWZpbml0ZSIgYmVnaW49Ii42IiBrZXlTcGxpbmVzPSIwLjIgMC4yIDAuNCAwLjg7MC4yIDAuNiAwLjQgMC44OzAuMiAwLjYgMC40IDAuOCIgY2FsY01vZGU9InNwbGluZSIvPjwvY2lyY2xlPjwvc3ZnPg==";

// --- State ---
const channelCache = new Map(); // cid -> { overview, stats, failedCount, fetchedAt }
const inflightFetches = new Map(); // `${cid}|${withStats}` -> Promise
const appliedSorts = new Map(); // cid -> { sortType, orderKey } (what we applied to Castbox's list)
let currentSortType = "default";
let busyRequestId = null; // Non-null while a sort is being applied
let requestCounter = 0;
let lastSeenCid; // Used to detect SPA navigation between channels
let ui = null; // { root, toggle, value, status, options }
let statusClearTimer = null;
let isListLoading = false;
// Loader text under Castbox's dots, e.g. "Loading episodes… 120 / 385"
const loaderText = { cid: null, withStats: false, text: "", visible: false, timer: null };

/**
 * Extracts the channel CID from the URL.
 * Supports both /channel/Name-id123 and /channel/id123.
 */
function getChannelCid() {
  const match = window.location.pathname.match(/\/channel\/(?:[^/]*-)?id(\d+)/);
  return match ? match[1] : null;
}

// --- Bridge to page.js (Castbox's own world) ---

const pendingBridgeCalls = new Map();
let bridgeCounter = 0;

window.addEventListener("cbs:response", (event) => {
  let response;
  try {
    response = JSON.parse(event.detail);
  } catch (e) {
    return;
  }
  const resolve = pendingBridgeCalls.get(response.id);
  if (resolve) {
    pendingBridgeCalls.delete(response.id);
    resolve(response);
  }
});

function callPage(action, payload = {}, timeoutMs = BRIDGE_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const id = `${Date.now()}-${++bridgeCounter}`;
    const timer = setTimeout(() => {
      pendingBridgeCalls.delete(id);
      reject(new Error("Castbox page did not respond"));
    }, timeoutMs);
    pendingBridgeCalls.set(id, (response) => {
      clearTimeout(timer);
      if (response.ok) resolve(response);
      else reject(new Error(response.error || "Unknown error"));
    });
    window.dispatchEvent(
      new CustomEvent("cbs:request", { detail: JSON.stringify({ id, action, ...payload }) })
    );
  });
}

// --- UI ---

/**
 * Injects the sort control into Castbox's list header (where "Reverse" is)
 */
function injectControls() {
  const cid = getChannelCid();
  if (!cid) return;

  const funcBtn = document.querySelector(FUNC_BTN_SELECTOR);
  if (!funcBtn || funcBtn.querySelector(".cbs-sort")) return;

  ui = buildControls();
  funcBtn.classList.add("cbs-has-sort"); // Hides the native "Reverse" (covered by Newest/Oldest)
  funcBtn.appendChild(ui.root);
  updateSelectionUi();
  updateStatusUi();

  // The list may already be sorted (e.g. user came back to this channel)
  if (busyRequestId === null) syncSelectionWithPage(cid);
  updateListLoadingUi();
}

function buildControls() {
  const root = document.createElement("span");
  root.className = "funcBtn-item cbs-sort";

  const status = document.createElement("span");
  status.className = "cbs-sort-status";
  status.setAttribute("aria-live", "polite");

  // Same structure as Castbox's dropdown (react-select on /categories):
  // [ value container | separator | chevron ]
  const toggle = document.createElement("div");
  toggle.className = "cbs-sort-toggle";
  toggle.setAttribute("role", "button");
  toggle.setAttribute("tabindex", "0");
  toggle.setAttribute("aria-haspopup", "listbox");
  toggle.setAttribute("aria-expanded", "false");

  const valueContainer = document.createElement("div");
  valueContainer.className = "cbs-sort-value-container";
  const prefix = document.createElement("span");
  prefix.className = "cbs-sort-prefix";
  prefix.textContent = "Sort:";
  const value = document.createElement("span");
  value.className = "cbs-sort-value";
  valueContainer.append(prefix, value);

  const indicators = document.createElement("div");
  indicators.className = "cbs-sort-indicators";
  const separator = document.createElement("span");
  separator.className = "cbs-sort-separator";
  const arrow = document.createElement("div");
  arrow.className = "cbs-sort-arrow";
  // react-select's chevron, as used by Castbox
  arrow.innerHTML =
    '<svg height="20" width="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false"><path d="M4.516 7.548c0.436-0.446 1.043-0.481 1.576 0l3.908 3.747 3.908-3.747c0.533-0.481 1.141-0.446 1.574 0 0.436 0.445 0.408 1.197 0 1.615-0.406 0.418-4.695 4.502-4.695 4.502-0.217 0.223-0.502 0.335-0.787 0.335s-0.57-0.112-0.789-0.335c0 0-4.287-4.084-4.695-4.502s-0.436-1.17 0-1.615z" fill="currentColor"></path></svg>';
  indicators.append(separator, arrow);
  toggle.append(valueContainer, indicators);

  const menu = document.createElement("div");
  menu.className = "cbs-sort-menu";
  menu.setAttribute("role", "listbox");

  const options = Object.keys(SORT_OPTIONS).map((key) => {
    const option = document.createElement("p");
    option.className = "cbs-sort-option";
    option.setAttribute("role", "option");
    option.setAttribute("tabindex", "-1");
    option.dataset.value = key;
    option.textContent = SORT_OPTIONS[key];
    menu.appendChild(option);
    return option;
  });

  toggle.addEventListener("click", (e) => {
    e.stopPropagation();
    setMenuOpen(!root.classList.contains("is-open"));
  });
  toggle.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") {
      e.preventDefault();
      setMenuOpen(true);
      const selected = options.find((o) => o.dataset.value === currentSortType) || options[0];
      selected.focus();
    }
  });
  menu.addEventListener("click", (e) => {
    e.stopPropagation();
    const option = e.target.closest(".cbs-sort-option");
    if (option) selectSort(option.dataset.value);
  });
  menu.addEventListener("keydown", (e) => {
    const index = options.indexOf(document.activeElement);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const next = (index + (e.key === "ArrowDown" ? 1 : -1) + options.length) % options.length;
      options[next].focus();
    } else if ((e.key === "Enter" || e.key === " ") && index >= 0) {
      e.preventDefault();
      selectSort(options[index].dataset.value, { fromKeyboard: true });
    }
  });

  root.append(status, toggle, menu);
  return { root, toggle, value, status, options };
}

/**
 * Opens or closes the menu. When closed from the keyboard, focus goes back
 * to the toggle; when closed with the mouse, focus is simply released.
 */
function setMenuOpen(isOpen, { fromKeyboard = false } = {}) {
  if (!ui) return;
  ui.root.classList.toggle("is-open", isOpen);
  ui.toggle.setAttribute("aria-expanded", String(isOpen));
  if (!isOpen && ui.root.contains(document.activeElement)) {
    if (fromKeyboard) ui.toggle.focus();
    else document.activeElement.blur();
  }
}

function setSelection(sortType) {
  currentSortType = sortType;
  updateSelectionUi();
}

function updateSelectionUi() {
  if (!ui || !ui.root.isConnected) return;
  ui.value.textContent = SORT_OPTIONS[currentSortType];
  ui.options.forEach((opt) => {
    const selected = opt.dataset.value === currentSortType;
    opt.classList.toggle("is-selected", selected);
    opt.setAttribute("aria-selected", String(selected));
  });
}

let statusState = { text: "", isError: false };

/**
 * Updates the small status text next to the control.
 * If clearAfterMs is given, the status is cleared after that delay.
 */
function setStatus(text, { isError = false, clearAfterMs = 0 } = {}) {
  clearTimeout(statusClearTimer);
  statusState = { text, isError };
  updateStatusUi();
  if (clearAfterMs) statusClearTimer = setTimeout(() => setStatus(""), clearAfterMs);
}

function updateStatusUi() {
  if (!ui || !ui.root.isConnected) return;
  ui.status.textContent = statusState.text;
  ui.status.classList.toggle("is-error", statusState.isError);
}

/**
 * Shows Castbox's own loader in place of the list while a sort is applied,
 * exactly like Castbox does while it loads a list. Below the dots, a short
 * progress text appears only if loading takes longer than LOADER_TEXT_DELAY_MS
 * (large channels need several seconds to load all episode stats).
 */
function setListLoading(isLoading, { cid = null, withStats = false } = {}) {
  isListLoading = isLoading;
  clearTimeout(loaderText.timer);
  Object.assign(loaderText, { cid, withStats, text: "Loading episodes…", visible: false });
  if (isLoading) {
    loaderText.timer = setTimeout(() => {
      loaderText.visible = true;
      updateListLoadingUi();
    }, LOADER_TEXT_DELAY_MS);
  }
  updateListLoadingUi();
}

/**
 * Stats are loaded in groups of 20; background.js reports after each group
 */
function setLoadingProgress(cid, done, total) {
  if (!isListLoading || !loaderText.withStats || loaderText.cid !== cid) return;
  loaderText.text = done >= total ? "Sorting…" : `Loading episodes… ${done} / ${total}`;
  updateListLoadingUi();
}

function updateListLoadingUi() {
  const trackList = document.querySelector(TRACK_LIST_SELECTOR);
  if (!trackList) return;
  let loader = trackList.querySelector(":scope > .cbs-load-inline");
  if (isListLoading && !loader) {
    // Same markup and inline styles as Castbox's LoadInline component
    loader = document.createElement("div");
    loader.className = "cbs-load-inline";
    loader.style.textAlign = "center";
    const img = document.createElement("img");
    img.src = CASTBOX_LOADER_SRC;
    img.alt = "loading";
    Object.assign(img.style, {
      width: ".84rem",
      maxWidth: "64px",
      height: ".84rem",
      maxHeight: "64px",
    });
    const text = document.createElement("div");
    text.className = "cbs-load-text";
    text.setAttribute("aria-live", "polite");
    loader.append(img, text);
    trackList.appendChild(loader);
  }
  if (loader) {
    const text = loader.querySelector(".cbs-load-text");
    const value = isListLoading && loaderText.visible ? loaderText.text : "";
    if (text && text.textContent !== value) text.textContent = value;
  }
  if (trackList.classList.contains("cbs-loading") !== isListLoading) {
    trackList.classList.toggle("cbs-loading", isListLoading);
  }
}

// --- Data ---

/**
 * Returns { overview, stats, failedCount } for a channel, using the cache when fresh.
 * Concurrent calls share the same request.
 */
function getChannelData(cid, withStats) {
  const cached = channelCache.get(cid);
  const fresh = cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS;
  if (fresh && (!withStats || cached.stats)) return Promise.resolve(cached);

  // Sorts without stats (e.g. Newest) don't wait for a slower stats fetch in progress
  const key = `${cid}|${withStats}`;
  if (inflightFetches.has(key)) return inflightFetches.get(key);

  const promise = (async () => {
    const response = await chrome.runtime.sendMessage({
      type: "GET_CHANNEL_DATA",
      cid,
      withStats,
    });
    if (!response) throw new Error("No response from the extension");
    if (response.status !== "success") throw new Error(response.message);

    // A stats fetch may have finished meanwhile; never drop its stats
    const latest = channelCache.get(cid);
    const latestStats =
      latest && latest.stats && Date.now() - latest.fetchedAt < CACHE_TTL_MS ? latest : null;
    if (!withStats && latestStats) return latestStats;

    const entry = {
      overview: response.overview,
      stats: withStats
        ? new Map(
            response.stats.map(([eid, likes, plays, comments]) => [
              String(eid),
              { likes, plays, comments },
            ])
          )
        : fresh
        ? cached.stats
        : null,
      failedCount: withStats ? response.failed_count || 0 : 0,
      fetchedAt: Date.now(),
    };
    channelCache.set(cid, entry);

    // Let page.js show plays / comments on Castbox's own rows
    if (withStats) {
      callPage("setStats", {
        stats: response.stats.map(([eid, , plays, comments]) => [eid, plays, comments]),
      }).catch(() => {});
    }
    return entry;
  })().finally(() => inflightFetches.delete(key));

  inflightFetches.set(key, promise);
  return promise;
}

/**
 * Returns the list of eids in the requested order.
 * Ties keep Castbox's default order.
 */
function computeOrder(data, sortType) {
  const items = data.overview.map((ep, index) => ({
    eid: ep.eid,
    index,
    date: Date.parse(ep.release_date) || 0,
    stats: data.stats ? data.stats.get(String(ep.eid)) : null,
  }));

  let compare = null;
  if (sortType === "newest") {
    compare = (a, b) => b.date - a.date;
  } else if (sortType === "oldest") {
    compare = (a, b) => a.date - b.date;
  } else if (STAT_SORTS.has(sortType)) {
    // Episodes whose stats could not be loaded go last
    const value = (item) => (item.stats ? Number(item.stats[sortType]) || 0 : -1);
    compare = (a, b) => value(b) - value(a);
  }
  if (compare) items.sort((a, b) => compare(a, b) || a.index - b.index);
  return items.map((item) => item.eid);
}

// --- Sorting ---

async function selectSort(sortType, { fromKeyboard = false } = {}) {
  setMenuOpen(false, { fromKeyboard });
  const cid = getChannelCid();
  if (!cid) return;
  if (sortType === currentSortType && busyRequestId === null) return;

  const previousSortType = appliedSorts.has(cid) ? appliedSorts.get(cid).sortType : "default";
  const requestId = ++requestCounter;
  busyRequestId = requestId;
  setSelection(sortType);
  setStatus("");

  const needsStats = STAT_SORTS.has(sortType);
  setListLoading(true, { cid, withStats: needsStats });

  try {
    const data = await getChannelData(cid, needsStats);
    if (busyRequestId !== requestId || getChannelCid() !== cid) return; // Superseded

    const order = computeOrder(data, sortType);
    const result = await callPage("applyOrder", { cid, order }, APPLY_TIMEOUT_MS);
    if (busyRequestId !== requestId) return; // Superseded

    busyRequestId = null;
    setListLoading(false);
    if (sortType === "default") appliedSorts.delete(cid);
    else appliedSorts.set(cid, { sortType, orderKey: result.eids.join(",") });

    if (needsStats && data.failedCount > 0) {
      setStatus(`${data.failedCount} episodes could not be loaded`, { clearAfterMs: 6000 });
    } else {
      setStatus("");
    }
  } catch (error) {
    if (busyRequestId !== requestId) return; // Superseded
    busyRequestId = null;
    setListLoading(false);
    setSelection(previousSortType);
    const message = /context invalidated/i.test(error.message)
      ? "Extension was updated, please reload the page"
      : error.message;
    setStatus(message, { isError: true, clearAfterMs: 6000 });
  }
}

/**
 * Shows the right selection when the control is (re)created:
 * if Castbox's list still has the order we applied, keep that sort selected.
 */
async function syncSelectionWithPage(cid) {
  const applied = appliedSorts.get(cid);
  if (!applied) {
    setSelection("default");
    return;
  }
  try {
    const state = await callPage("getState");
    if (busyRequestId !== null || getChannelCid() !== cid) return;
    if (state.cid === cid && state.eids.join(",") === applied.orderKey) {
      setSelection(applied.sortType);
      return;
    }
  } catch (e) {
    // Page not ready; fall through
  }
  if (busyRequestId !== null) return;
  appliedSorts.delete(cid);
  setSelection("default");
}

// --- Global Listeners (registered once) ---

// Close the menu when clicking outside of it
document.addEventListener("click", (e) => {
  if (ui && !ui.root.contains(e.target)) setMenuOpen(false);
});

// Close the menu with Escape
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && ui && ui.root.classList.contains("is-open")) {
    setMenuOpen(false, { fromKeyboard: true });
  }
});

// Progress from background.js while episode stats are loading
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "FETCH_PROGRESS") {
    setLoadingProgress(String(message.cid), message.done, message.total);
  }
});

// --- Main Execution ---

/**
 * Runs on page changes: resets state on SPA navigation and injects the controls
 */
function onDomChange() {
  const cid = getChannelCid();
  if (cid !== lastSeenCid) {
    if (lastSeenCid !== undefined) {
      busyRequestId = null; // Ignore any in-flight sort
      setListLoading(false);
      setSelection("default");
      setStatus("");
      setMenuOpen(false);
    }
    lastSeenCid = cid;
  }
  injectControls();
}

// DOM mutations come in bursts; handle them at most once per short interval
let domChangeTimer = null;
const observer = new MutationObserver(() => {
  if (domChangeTimer) return;
  domChangeTimer = setTimeout(() => {
    domChangeTimer = null;
    onDomChange();
  }, 100);
});

observer.observe(document.body, {
  childList: true,
  subtree: true,
});

onDomChange();
