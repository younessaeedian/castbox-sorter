// --- Section 1: API Functions ---

async function get_all_episode_ids(cid) {
  // API Step 1: Get the full list of EIDs
  const url = `https://everest.castbox.fm/data/episodes/overview?_t=176333&cids=${cid}&compare_eid=1&country=us&eids=&raw=1`;
  try {
    const response = await fetch(url);
    if (!response.ok)
      throw new Error(`API Error (EIDs): ${response.statusText}`);

    const data = await response.json();
    if (!data.data || !data.data[0] || !data.data[0].episode_list) {
      throw new Error("Unexpected EID response structure");
    }
    return data.data[0].episode_list.map((ep) => ep.eid); // Return the list [eid1, eid2, ...]
  } catch (error) {
    console.error("Error in get_all_episode_ids:", error);
    return null;
  }
}

async function get_episode_details(eids_list) {
  // API Step 2: Get details in chunks of 20
  const all_episodes_details = [];
  const chunk_size = 20;

  for (let i = 0; i < eids_list.length; i += chunk_size) {
    const chunk = eids_list.slice(i, i + chunk_size);
    const eids_string = chunk.join(",");
    const url = `https://everest.castbox.fm/data/episodes/v2?country=us&eids=${eids_string}&raw=1`;

    try {
      const response = await fetch(url);
      if (!response.ok)
        throw new Error(`API Error (Details): ${response.statusText}`);

      const data = await response.json();
      if (data.data) {
        all_episodes_details.push(...data.data);
      }
      // A short delay to respect the server
      await new Promise((resolve) => setTimeout(resolve, 200));
    } catch (error) {
      console.error("Error in get_episode_details (chunk):", error);
    }
  }
  return all_episodes_details; // Return the full list of details
}

// --- Section 2: Message Listener ---

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // We make sure we have received the correct message
  if (request.type === "GET_SORTED_EPISODES") {
    console.log("Message received from content.js. Fetching EIDs...");

    (async () => {
      // Step 1: Get EIDs
      const eids = await get_all_episode_ids(request.cid);
      if (!eids) {
        sendResponse({ status: "error", message: "Error fetching EIDs" });
        return;
      }
      console.log(`Received list of ${eids.length} EIDs. Fetching details...`);

      // Step 2: Get details
      const details_list = await get_episode_details(eids);
      if (!details_list) {
        sendResponse({ status: "error", message: "Error fetching details" });
        return;
      }
      console.log("Full details received.");

      // Sending the complete (still unsorted) result to content.js
      sendResponse({ status: "success", episodes: details_list });
    })();

    // This line is important because it tells Chrome we will respond later (as our work is Asynchronous)
    return true;
  }
});
