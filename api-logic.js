console.log("API Logic Module Loaded");

var fullChannelData = null;
var cachedChannelCid = null;
var isFetching = false;

function getUserToken() {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      const value = localStorage.getItem(key);
      if (value && value.startsWith("eyJ") && value.length > 100) {
        return value;
      }
    }
    return null;
  } catch (e) {
    return null;
  }
}

function getUserUid() {
  return localStorage.getItem("uid") || "b5df2a3b5252473e994ae0d1688790db";
}

async function handleSortRequest(sortType) {
  const statusLabel = document.getElementById("sorter-status-text");
  const loader = document.getElementById("sorter-loader");
  if (!statusLabel || !loader) return;

  const match = window.location.pathname.match(/-id(\d+)/);
  const currentCid = match ? match[1] : null;

  if (currentCid && cachedChannelCid && currentCid !== cachedChannelCid) {
    fullChannelData = null;
    cachedChannelCid = null;
  }

  if (isFetching) return;

  if (sortType === "default") {
    statusLabel.innerText = "Resetting...";
    loader.style.display = "none";
    showOriginalList();
    statusLabel.innerText = "";
    return;
  }

  if (!fullChannelData) {
    if (!currentCid) {
      alert("Channel ID not found.");
      return;
    }
    statusLabel.innerText = "Fetching all episodes";
    loader.style.display = "block";
    isFetching = true;

    try {
      const response = await chrome.runtime.sendMessage({
        type: "GET_SORTED_EPISODES",
        cid: currentCid,
      });
      if (response.status === "success") {
        fullChannelData = response.episodes;
        cachedChannelCid = currentCid;
        statusLabel.innerText = "Building list";
      } else {
        throw new Error(response.message);
      }
    } catch (error) {
      statusLabel.innerText = "Error fetching data.";
      loader.style.display = "none";
      isFetching = false;
      return;
    } finally {
      isFetching = false;
    }
  }

  renderFullSortedList(fullChannelData, sortType);

  setTimeout(() => {
    if (statusLabel) statusLabel.innerText = "";
    if (loader) loader.style.display = "none";
  }, 500);
}

async function sendSyncLikeRequest(eid, cid, isLiked) {
  const token = getUserToken();
  if (!token) throw new Error("Please login first.");
  const uid = getUserUid();
  const url = `https://sync.castbox.fm/my/records?web=1&m=20251121&n=4ed715e85851c4e0678819e1419a28fe&r=1`;
  const payload = {
    record_list: [
      {
        table: "fav_ep",
        type: 1,
        fid: String(eid),
        exid: String(cid),
        sort_ts_at: Date.now(),
        sort_ts: Date.now(),
        update_at: Date.now(),
        create_at: Date.now(),
        operation: isLiked ? 1 : 2,
      },
    ],
  };

  await fetch(url, {
    method: "POST",
    headers: {
      accept: "*/*",
      "content-type": "text/plain;charset=UTF-8",
      "x-access-token": token,
      "x-uid": uid,
      "x-suid": "25641860",
      "x-web": "true",
    },
    body: JSON.stringify(payload),
    mode: "cors",
    credentials: "omit",
  });
}

function attachLikeListeners() {
  const likeButtons = document.querySelectorAll(".custom-like-btn");
  likeButtons.forEach((btn) => {
    if (btn.dataset.hasListener) return;
    btn.dataset.hasListener = "true";

    btn.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const eid = btn.dataset.eid;
      const cid = btn.dataset.cid;
      const currentStatus = btn.dataset.liked === "true";
      const newStatus = !currentStatus;

      // Optimistic UI Update
      if (newStatus) {
        btn.classList.add("liked");
        // Site CSS handles the background image for .liked, so we don't need inner HTML SVG here anymore for the button itself
      } else {
        btn.classList.remove("liked");
      }
      btn.dataset.liked = newStatus;

      try {
        await sendSyncLikeRequest(eid, cid, newStatus);
        console.log(`Synced: ${newStatus ? "Liked" : "Unliked"}`);
      } catch (error) {
        console.error("Sync Error:", error);
        // Revert UI
        if (currentStatus) {
          btn.classList.add("liked");
        } else {
          btn.classList.remove("liked");
        }
        btn.dataset.liked = currentStatus;
      }
    });
  });
}
