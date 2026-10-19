// --- Section 1: API Functions ---

const API_BASE = "https://everest.castbox.fm/data";
const REQUEST_TIMEOUT_MS = 15000;
const CHUNK_SIZE = 20;
const CONCURRENT_REQUESTS = 4; // Parallel chunk requests (browsers allow 6 per host)
const CHUNK_DELAY_MS = 100; // Short pause per worker between requests, to respect the server

/**
 * Fetches a URL and parses JSON, with a timeout and one retry.
 */
async function fetch_json(url, retries = 1) {
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!response.ok)
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      return await response.json();
    } catch (error) {
      if (attempt >= retries) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}

async function get_episode_overview(cid) {
  // API Step 1: Get all EIDs in Castbox's default order (+ release dates)
  const url = `${API_BASE}/episodes/overview?_t=${Date.now()}&cids=${encodeURIComponent(
    cid
  )}&compare_eid=1&country=us&eids=&raw=1`;

  const data = await fetch_json(url);
  const episode_list = data && data.data && data.data[0] && data.data[0].episode_list;
  if (!Array.isArray(episode_list)) {
    throw new Error("Unexpected EID response structure");
  }
  return episode_list
    .filter((ep) => ep.eid != null)
    .map((ep) => ({ eid: ep.eid, release_date: ep.release_date || null }));
}

async function get_episode_stats(eids_list, onProgress) {
  // API Step 2: Get likes / plays / comments in chunks of 20,
  // CONCURRENT_REQUESTS chunks at a time
  const chunks = [];
  for (let i = 0; i < eids_list.length; i += CHUNK_SIZE) {
    chunks.push(eids_list.slice(i, i + CHUNK_SIZE));
  }

  const stats = []; // [eid, likes, plays, comments]
  let failed_count = 0;
  let done = 0;
  let next = 0;

  async function worker() {
    while (next < chunks.length) {
      const chunk = chunks[next++];
      const eids_string = chunk.map((eid) => encodeURIComponent(eid)).join(",");
      const url = `${API_BASE}/episodes/v2?country=us&eids=${eids_string}&raw=1`;

      try {
        const data = await fetch_json(url);
        if (!Array.isArray(data && data.data)) throw new Error("Unexpected response");
        data.data.forEach((ep) => {
          stats.push([ep.eid, ep.like_count || 0, ep.play_count || 0, ep.comment_count || 0]);
        });
        failed_count += Math.max(0, chunk.length - data.data.length);
      } catch (error) {
        console.error("Error in get_episode_stats (chunk):", error);
        failed_count += chunk.length;
      }

      done += chunk.length;
      onProgress(done, eids_list.length);

      if (next < chunks.length) {
        await new Promise((resolve) => setTimeout(resolve, CHUNK_DELAY_MS));
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENT_REQUESTS, chunks.length) }, worker)
  );
  return { stats, failed_count };
}

// --- Section 2: Message Listener ---

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type !== "GET_CHANNEL_DATA") return;

  // Progress for the loader text ("Loading episodes… 120 / 385"), sent to the tab that asked
  const reportProgress = (done, total) => {
    if (!sender.tab) return;
    chrome.tabs
      .sendMessage(
        sender.tab.id,
        { type: "FETCH_PROGRESS", cid: request.cid, done, total },
        { frameId: sender.frameId }
      )
      .catch(() => {}); // The tab may have been closed or navigated away
  };

  (async () => {
    try {
      const overview = await get_episode_overview(request.cid);
      if (!request.withStats) {
        sendResponse({ status: "success", overview });
        return;
      }

      const eids = overview.map((ep) => ep.eid);
      const { stats, failed_count } = await get_episode_stats(eids, reportProgress);
      if (eids.length > 0 && stats.length === 0) {
        throw new Error("Could not fetch episode details");
      }
      console.log(`Received stats for ${stats.length}/${eids.length} episodes.`);
      sendResponse({ status: "success", overview, stats, failed_count });
    } catch (error) {
      console.error("Error fetching channel data:", error);
      sendResponse({ status: "error", message: error.message || String(error) });
    }
  })();

  // Tells Chrome we will respond asynchronously
  return true;
});
