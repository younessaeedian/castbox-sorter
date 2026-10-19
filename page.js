// Runs in the page's own JavaScript world (manifest: "world": "MAIN").
// It talks to Castbox's React/Redux app so the sorted list is rendered by
// Castbox itself, with all native features (play, like, add to playlist, more menu).
//
// How Castbox's own "Reverse" button works (reverse-engineered from page.ch.*.js):
//   dispatch(resetEpList())                                   // overview {}, eps [], epStatus {}
//   dispatch({ type: "ch-setEpOverview", data: { ...overview, eids: overview.eids.reverse() } })
//   dispatch(getChEpList({ skip: 0, limit: 20, cid }))        // load first page; infinite scroll loads the rest
// We do the same thing, only with our own eid order.
//
// Communication with content.js uses window CustomEvents with JSON string details.

(() => {
  if (window.__castboxSorterPage) return;
  window.__castboxSorterPage = true;

  const PAGE_SIZE = 20; // Same page size Castbox uses for "Reverse"
  const statsByEid = new Map(); // eid -> { plays, comments } (from content.js)
  let applyQueue = Promise.resolve(); // Serializes applyOrder calls

  // --- Access to Castbox's React/Redux internals ---

  /**
   * Finds the Redux store and the channel page props (getChEpList) by walking
   * the React 16 fiber tree up from the channel page root element.
   */
  function findCastboxApp() {
    const root = document.getElementById("trackList");
    if (!root) return null;
    const fiberKey = Object.keys(root).find(
      (key) => key.startsWith("__reactInternalInstance$") || key.startsWith("__reactFiber$")
    );
    let fiber = fiberKey ? root[fiberKey] : null;
    let pageProps = null;
    let store = null;
    while (fiber && !(pageProps && store)) {
      const props = fiber.memoizedProps;
      if (props) {
        if (!pageProps && typeof props.getChEpList === "function") pageProps = props;
        if (!store && props.store && typeof props.store.dispatch === "function") {
          store = props.store;
        }
      }
      fiber = fiber.return;
    }
    return pageProps && store ? { pageProps, store } : null;
  }

  function getChannelState(app) {
    const state = app.store.getState();
    return (state && state.ch) || {};
  }

  /**
   * Applies a new episode order to Castbox's list (same steps as native "Reverse").
   * Returns the final order and a promise that resolves when the first page is loaded.
   */
  function applyOrder(cid, order) {
    const app = findCastboxApp();
    if (!app) throw new Error("Castbox page is not ready");

    const ch = getChannelState(app);
    const overview = ch.overview || {};
    if (
      String(overview.cid) !== String(cid) ||
      !Array.isArray(overview.eids) ||
      overview.eids.length === 0
    ) {
      throw new Error("Castbox page is not ready");
    }

    // Keep only eids Castbox knows about, and never drop any of them
    const known = new Set(overview.eids.map(Number));
    const seen = new Set();
    const eids = [];
    order.forEach((eid) => {
      const n = Number(eid);
      if (known.has(n) && !seen.has(n)) {
        seen.add(n);
        eids.push(n);
      }
    });
    overview.eids.forEach((eid) => {
      const n = Number(eid);
      if (!seen.has(n)) {
        seen.add(n);
        eids.push(n);
      }
    });

    const { dispatch } = app.store;
    dispatch({ type: "ch-setEpOverview", data: {} });
    dispatch({ type: "ch-setEpList", data: { eps: [], skip: 0, limit: 1 } });
    dispatch({ type: "ch-setEpStatus", data: { status: {}, cid: -1 } });
    dispatch({ type: "ch-setEpOverview", data: { ...overview, eids } });
    // getChEpList is a redux-thunk action; dispatching it returns its promise
    const loaded = Promise.resolve(
      app.pageProps.getChEpList({ skip: 0, limit: PAGE_SIZE, cid: overview.cid })
    );
    return { eids, loaded };
  }

  // --- Extra stats (plays / comments) on Castbox's own rows ---

  const formatNumber = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ","); // Castbox's formatter

  function toCount(value) {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  }

  function upsertStat(container, className, title, count) {
    let el = container.querySelector(`.${className}`);
    if (!count) {
      if (el) el.remove();
      return;
    }
    if (!el) {
      el = document.createElement("span");
      el.className = `item icon cbs-stat ${className}`; // Same look as Castbox's date / time items
      el.title = title;
      container.appendChild(el);
    }
    const text = formatNumber(count);
    if (el.textContent !== text) el.textContent = text;
  }

  /**
   * Adds plays / comments to each row's info line. With style.css the line
   * becomes two lines: episode info (date, time, "Played x%") and popularity
   * (likes, plays, comments). A zero-height ".cbs-break" forces the line break.
   */
  function decorateRows() {
    const list = document.querySelector("#trackList #trackListCon_list");
    if (!list) return;

    const app = findCastboxApp();
    const eps = app ? getChannelState(app).eps || [] : [];
    const epByEid = new Map(eps.map((ep) => [String(ep.eid), ep]));

    list.querySelectorAll("section.episodeRow").forEach((row) => {
      const link = row.querySelector(".ep-item-con > a[href]");
      const des = row.querySelector(".ep-item-con-des");
      if (!link || !des) return;
      const match = link.getAttribute("href").match(/-id(\d+)(?:[?#].*)?$/);
      if (!match) return;
      const eid = match[1];

      const ep = epByEid.get(eid) || {};
      const extra = statsByEid.get(eid) || {};
      const plays = ep.play_count != null ? toCount(ep.play_count) : toCount(extra.plays);
      const comments =
        ep.comment_count != null ? toCount(ep.comment_count) : toCount(extra.comments);

      if (!des.querySelector(".cbs-break")) {
        const lineBreak = document.createElement("span");
        lineBreak.className = "cbs-break";
        des.appendChild(lineBreak);
      }
      upsertStat(des, "cbs-plays", "Plays", plays);
      upsertStat(des, "cbs-comments", "Comments", comments);
    });
  }

  let decorateTimer = null;
  function scheduleDecorate() {
    if (decorateTimer) return;
    decorateTimer = setTimeout(() => {
      decorateTimer = null;
      decorateRows();
    }, 50);
  }

  // Re-decorate when Castbox renders rows. This runs inside the MutationObserver
  // callback (before the browser paints), so new rows never show up without
  // their stats. Only mutations inside the episode list matter, and mutations
  // caused by our own elements are ignored.
  const toElement = (node) =>
    node && node.nodeType === Node.ELEMENT_NODE ? node : node && node.parentElement;
  const isOurs = (node) => {
    const el = toElement(node);
    return !!(el && el.closest(".cbs-stat, .cbs-break"));
  };
  const LIST_PARTS = "#trackListCon_list, section.episodeRow";
  const touchesList = (m) => {
    const target = toElement(m.target);
    if (target && target.closest("#trackListCon_list")) return true;
    return [...m.addedNodes].some(
      (n) => n.nodeType === Node.ELEMENT_NODE && (n.matches(LIST_PARTS) || n.querySelector(LIST_PARTS))
    );
  };
  new MutationObserver((mutations) => {
    const relevant = mutations.some(
      (m) => !isOurs(m.target) && ![...m.addedNodes].every(isOurs) && touchesList(m)
    );
    if (relevant) decorateRows();
  }).observe(document.body, { childList: true, subtree: true });

  // --- Bridge with content.js ---

  function reply(id, payload) {
    window.dispatchEvent(
      new CustomEvent("cbs:response", { detail: JSON.stringify({ id, ...payload }) })
    );
  }

  window.addEventListener("cbs:request", async (event) => {
    let request;
    try {
      request = JSON.parse(event.detail);
    } catch (e) {
      return;
    }
    const { id, action } = request;

    try {
      if (action === "getState") {
        const app = findCastboxApp();
        const overview = app ? getChannelState(app).overview || {} : {};
        reply(id, {
          ok: !!app,
          cid: overview.cid != null ? String(overview.cid) : null,
          eids: Array.isArray(overview.eids) ? overview.eids.map(Number) : [],
        });
      } else if (action === "applyOrder") {
        // Run one at a time: two overlapping first-page loads would race, and the
        // older one could finish last and overwrite the newer order
        const run = applyQueue.then(async () => {
          const { eids, loaded } = applyOrder(request.cid, request.order);
          await loaded; // Reply once Castbox has rendered the first page
          return eids;
        });
        applyQueue = run.catch(() => {});
        reply(id, { ok: true, eids: await run });
      } else if (action === "setStats") {
        (request.stats || []).forEach(([eid, plays, comments]) => {
          statsByEid.set(String(eid), { plays, comments });
        });
        scheduleDecorate();
        reply(id, { ok: true });
      } else {
        reply(id, { ok: false, error: `Unknown action: ${action}` });
      }
    } catch (error) {
      reply(id, { ok: false, error: error.message || String(error) });
    }
  });

  scheduleDecorate();
})();
