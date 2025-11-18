console.log("Castbox Sorter (API v2.5 - Custom Dropdown) Loaded!");

// --- Key Selectors ---
const INJECTION_POINT_SELECTOR = "div.trackListCon";
const ORIGINAL_LIST_SELECTOR = "div#trackListCon_list"; // The original list container

// --- Cache Variables ---
let fullChannelData = null; // All 200+ episodes from API
let cachedChannelCid = null; // Cached channel ID
let isFetching = false;
let currentSortType = "default";
let customListContainer = null; // Our custom container for the full results
let customDropdownMenu = null; // The custom dropdown menu
let customDropdownValue = null; // The element showing the selected value

// --- Dropdown Options ---
const SORT_OPTIONS = {
  default: "Default (Newest)",
  likes: "Most Likes",
  plays: "Most Plays",
  comments: "Most Comments",
  oldest: "Oldest",
};

/**
 * Injects the custom dropdown and our custom list container
 */
function injectControls() {
  const targetContainer = document.querySelector(INJECTION_POINT_SELECTOR);
  const alreadyExists = document.getElementById("sorter-container-wrapper");

  // This function is now called repeatedly
  // This condition ensures the injection only happens once
  if (targetContainer && !alreadyExists) {
    console.log("Container found. Injecting custom dropdown...");

    // --- 1. Create the main LTR wrapper ---
    const mainWrapper = document.createElement("div");
    mainWrapper.id = "sorter-container-wrapper";
    mainWrapper.className = "sorter-main-wrapper";

    // --- 2. Create the dropdown component (mimicking react-select) ---
    const sorterComponent = document.createElement("div");
    sorterComponent.className = "sorter-component-container"; // css-2b097c-container

    // Control Box (the clickable part)
    const sorterControl = document.createElement("div");
    sorterControl.className = "sorter-control"; // css-f7agmn-control
    sorterControl.onclick = toggleDropdown;

    const valueContainer = document.createElement("div");
    valueContainer.className = "sorter-value-container"; // css-1hwfws3

    customDropdownValue = document.createElement("div");
    customDropdownValue.className = "sorter-value-text"; // css-1uccc91-singleValue
    customDropdownValue.innerText = SORT_OPTIONS[currentSortType];

    valueContainer.appendChild(customDropdownValue);

    const indicators = document.createElement("div");
    indicators.className = "sorter-indicators"; // css-1wy0on6

    const separator = document.createElement("span");
    separator.className = "sorter-separator"; // css-1okebmr-indicatorSeparator

    const arrow = document.createElement("div");
    arrow.className = "sorter-arrow-container"; // css-1gtu0rj-indicatorContainer
    // --- SVG path uses "currentColor" to be styled by CSS ---
    arrow.innerHTML =
      '<svg height="20" width="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false"><path d="M4.516 7.548c0.436-0.446 1.043-0.481 1.576 0l3.908 3.747 3.908-3.747c0.533-0.481 1.141-0.446 1.574 0 0.436 0.445 0.408 1.197 0 1.615-0.406 0.418-4.695 4.502-4.695 4.502-0.217 0.223-0.502 0.335-0.787 0.335s-0.57-0.112-0.789-0.335c0 0-4.287-4.084-4.695-4.502s-0.436-1.17 0-1.615z" fill="currentColor"></path></svg>';

    indicators.appendChild(separator);
    indicators.appendChild(arrow);
    sorterControl.appendChild(valueContainer);
    sorterControl.appendChild(indicators);

    // Menu Box (the hidden part)
    customDropdownMenu = document.createElement("div");
    customDropdownMenu.className = "sorter-menu"; // css-26l3qy-menu

    const menuList = document.createElement("div");
    menuList.className = "sorter-menu-list"; // css-11unzgr

    Object.keys(SORT_OPTIONS).forEach((key) => {
      const option = document.createElement("div");
      option.className = "sorter-option"; // css-knui5-option
      if (key === currentSortType) {
        option.classList.add("is-selected"); // Mark as selected
      }
      option.innerText = SORT_OPTIONS[key];
      option.dataset.value = key; // Store the value
      option.onclick = handleOptionClick;
      menuList.appendChild(option);
    });

    customDropdownMenu.appendChild(menuList);
    sorterComponent.appendChild(sorterControl);
    sorterComponent.appendChild(customDropdownMenu);

    // --- 3. Create the status container (Text + Loader) ---
    const statusContainer = document.createElement("div");
    statusContainer.id = "sorter-status-container";

    // Status Text
    const statusText = document.createElement("span");
    statusText.id = "sorter-status-text"; // Renamed ID

    // Loader
    const loaderDiv = document.createElement("div");
    loaderDiv.id = "sorter-loader";
    loaderDiv.style.display = "none"; // Hide initially
    // SVG code provided by user
    const loaderSVG = `<svg viewBox="0 0 32 32" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns="http://www.w3.org/2000/svg" width="32" height="32" fill="#ccc"><circle transform="translate(8)" cy="16" r="0"><animate attributeName="r" values="0; 4; 0; 0" dur="1.2s" repeatCount="indefinite" begin="0" keySplines="0.2 0.2 0.4 0.8;0.2 0.6 0.4 0.8;0.2 0.6 0.4 0.8" calcMode="spline"></animate></circle><circle transform="translate(16)" cy="16" r="0"><animate attributeName="r" values="0; 4; 0; 0" dur="1.2s" repeatCount="indefinite" begin=".3" keySplines="0.2 0.2 0.4 0.8;0.2 0.6 0.4 0.8;0.2 0.6 0.4 0.8" calcMode="spline"></animate></circle><circle transform="translate(24)" cy="16" r="0"><animate attributeName="r" values="0; 4; 0; 0" dur="1.2s" repeatCount="indefinite" begin=".6" keySplines="0.2 0.2 0.4 0.8;0.2 0.6 0.4 0.8;0.2 0.6 0.4 0.8" calcMode="spline"></animate></circle></svg>`;
    loaderDiv.innerHTML = loaderSVG;

    // --- 4. Assemble and Inject ---
    statusContainer.appendChild(statusText);
    statusContainer.appendChild(loaderDiv);
    mainWrapper.appendChild(sorterComponent);
    mainWrapper.appendChild(statusContainer); // Add the new container
    targetContainer.prepend(mainWrapper);

    // --- 5. Create the custom list container ---
    customListContainer = document.createElement("div");
    customListContainer.id = "custom-sorted-list-container";
    customListContainer.className = "trackListCon_list"; // Use original class
    customListContainer.style.display = "none"; // Hide initially

    const originalList = document.querySelector(ORIGINAL_LIST_SELECTOR);
    if (originalList) {
      originalList.after(customListContainer);
    } else {
      mainWrapper.after(customListContainer);
    }

    // Add global click listener to close dropdown
    document.addEventListener("click", (e) => {
      if (!sorterComponent.contains(e.target)) {
        customDropdownMenu.classList.remove("is-open");
      }
    });
  }
}

/**
 * Toggles the visibility of the custom dropdown
 */
function toggleDropdown(e) {
  e.stopPropagation(); // Stop click from bubbling to document
  if (customDropdownMenu) {
    customDropdownMenu.classList.toggle("is-open");
  }
}

/**
 * Handles the click on a custom dropdown option
 */
function handleOptionClick(e) {
  const value = e.target.dataset.value;
  const text = e.target.innerText;

  // Update selected styles
  const allOptions = document.querySelectorAll(".sorter-option");
  allOptions.forEach((opt) => opt.classList.remove("is-selected"));
  e.target.classList.add("is-selected");

  // Update the displayed value
  if (customDropdownValue) {
    customDropdownValue.innerText = text;
  }

  // Close the menu
  if (customDropdownMenu) {
    customDropdownMenu.classList.remove("is-open");
  }

  // Trigger the actual sort request
  handleSortRequest(value);
}

/**
 * Handles the logic for sorting (fetches data if needed)
 */
async function handleSortRequest(sortType) {
  const statusLabel = document.getElementById("sorter-status-text");
  const loader = document.getElementById("sorter-loader");
  if (!statusLabel || !loader) return;

  // ✅ --- Bug Fix: Check for page change ---
  // 1. Get the current CID from the URL
  const match = window.location.pathname.match(/-id(\d+)/);
  const currentCid = match ? match[1] : null;

  // 2. If the current CID is different from the cached CID, clear the cache
  if (currentCid && cachedChannelCid && currentCid !== cachedChannelCid) {
    console.log("Channel changed! Invalidating cache.");
    fullChannelData = null;
    cachedChannelCid = null;
  }
  // --- End of Bug Fix ---

  if (isFetching) return;

  if (sortType === "default") {
    statusLabel.innerText = "Resetting to default...";
    loader.style.display = "none";
    showOriginalList();
    statusLabel.innerText = "";

    // ✅ --- Bug Fix: Clear cache when returning to default state ---
    fullChannelData = null;
    cachedChannelCid = null;
    return;
  }

  if (!fullChannelData) {
    // We already got currentCid, no need to match again
    if (!currentCid) {
      alert("Error: Could not extract Channel CID from URL.");
      // Reset dropdown to default visually
      currentSortType = "default";
      if (customDropdownValue)
        customDropdownValue.innerText = SORT_OPTIONS["default"];
      document.querySelectorAll(".sorter-option").forEach((opt) => {
        opt.classList.toggle("is-selected", opt.dataset.value === "default");
      });
      return;
    }
    const cid = currentCid; // Use the CID from the top of the function

    statusLabel.innerText =
      "Fetching all episodes from server... (This may take a moment)";
    loader.style.display = "block";
    isFetching = true;

    try {
      const response = await chrome.runtime.sendMessage({
        type: "GET_SORTED_EPISODES",
        cid: cid,
      });
      if (response.status === "success") {
        fullChannelData = response.episodes;
        cachedChannelCid = cid; // ✅ --- Bug Fix: Cache the channel ID ---
        console.log(`Successfully fetched ${fullChannelData.length} episodes.`);
        statusLabel.innerText = "Data received. Building list...";
      } else {
        throw new Error(response.message);
      }
    } catch (error) {
      statusLabel.innerText = `Error: ${error.message}`;
      loader.style.display = "none";
      isFetching = false;
      // Reset dropdown to default on error
      currentSortType = "default";
      if (customDropdownValue)
        customDropdownValue.innerText = SORT_OPTIONS["default"];
      document.querySelectorAll(".sorter-option").forEach((opt) => {
        opt.classList.toggle("is-selected", opt.dataset.value === "default");
      });
      return;
    } finally {
      isFetching = false;
    }
  } else {
    statusLabel.innerText = "Building list (from cache)...";
    loader.style.display = "block";
  }

  renderFullSortedList(fullChannelData, sortType);

  setTimeout(() => {
    if (statusLabel) statusLabel.innerText = "";
    if (loader) loader.style.display = "none";
  }, 1000);
}

/**
 * Hides the original Castbox list and shows our custom list
 */
function hideOriginalList() {
  const originalList = document.querySelector(ORIGINAL_LIST_SELECTOR);
  if (originalList) originalList.style.display = "none";
  if (customListContainer) customListContainer.style.display = "block";
}

/**
 * Hides our custom list and shows the original Castbox list
 */
function showOriginalList() {
  const originalList = document.querySelector(ORIGINAL_LIST_SELECTOR);
  if (originalList) originalList.style.display = "block";
  if (customListContainer) customListContainer.style.display = "none";
}

/**
 * Helper: Formats seconds into HH:MM:SS or MM:SS
 */
function formatDuration(seconds) {
  if (isNaN(seconds) || seconds < 1) return "0:00";
  const showHours = seconds >= 3600;
  const startIndex = showHours ? 11 : 14;
  return new Date(seconds * 1000)
    .toISOString()
    .substr(startIndex, showHours ? 8 : 5);
}

/**
 * Helper: Formats large numbers into 1K, 1.5M, etc.
 */
function formatCount(num) {
  if (isNaN(num) || num === 0) return "0";
  if (num < 1000) return String(num);
  if (num < 1000000) return (num / 1000).toFixed(1).replace(/\.0$/, "") + "K";
  return (num / 1000000).toFixed(1).replace(/\.0$/, "") + "M";
}

/**
 * Sorts the full episode list and renders it into our custom container,
 * perfectly mimicking the original Castbox HTML structure.
 */
function renderFullSortedList(episodes, sortType) {
  console.log(`Rendering full list based on: ${sortType}`);

  if (!customListContainer) {
    console.error("Custom container not found!");
    return;
  }

  // 1. Sort the full data list
  let sortedList = [...episodes]; // Create a copy

  if (sortType === "likes") {
    sortedList.sort((a, b) => (b.like_count || 0) - (a.like_count || 0));
  } else if (sortType === "plays") {
    sortedList.sort((a, b) => (b.play_count || 0) - (a.play_count || 0));
  } else if (sortType === "comments") {
    sortedList.sort((a, b) => (b.comment_count || 0) - (a.comment_count || 0));
  } else if (sortType === "oldest") {
    sortedList.sort(
      (a, b) => new Date(a.release_date || 0) - new Date(b.release_date || 0)
    );
  }

  // 2. Build the new HTML (mimicking 'div:first-child')
  let html = "<div>";

  // --- Icon Definitions ---

  // Like Icon (PNG)
  const likeIconHtml = `<img class="heart" src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACQAAAAgCAMAAABNTyq8AAAAtFBMVEUAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSe1G2AAAAPHRSTlMAAQIDBAYHCAkKCwwPEBESExUWGBkaGxwdHicoKSorLjA0NTY3ODk6Ozw9Pj9CQ0RGR0hJSktMTU5QUVIiOXN/AAAA0UlEQVQYGY3Bi1KCQACG0W+z0jTS7laWRhaWZZlCuf/7v1cMAw4QsJ5Dov8cSQqnfVIn/trKhk8emc6nMt8eseMvZRZtEgOrnAcYKcd6xLpWBf6jCmwHWMphCWdyOuVVTgG/cvpBO0A7QG6WUE5rAjm9cCWnc8xGDhsDEzmMgX2rRrZF7FaN7kis1GBlSBypQZfUULVu2BqrxoScQJVm5Jm5KrwbCsyb/pkbynyVTKkwUsE9lS6Uc0mNXqRU1KPWXqDErEWTayvZIQ4HH4tDSv4Akfi9Cqw4eqYAAAAASUVORK5CYII=">`;

  // Play Icon (SVG)
  const playIconHtml = `<svg class="heart" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
<g opacity="0.7">
<path d="M3 21.2421V2.75791C2.99991 2.44869 3.07991 2.14492 3.23191 1.87727C3.38391 1.60962 3.60254 1.38758 3.86572 1.23355C4.1289 1.07952 4.42732 0.99896 4.73083 1.00001C5.03435 1.00106 5.33221 1.08368 5.59436 1.23953L21.145 10.4834C21.4052 10.6382 21.6211 10.8598 21.7711 11.126C21.9211 11.3923 22 11.6939 22 12.0009C22 12.3079 21.9211 12.6095 21.7711 12.8757C21.6211 13.142 21.4052 13.3636 21.145 13.5184L5.59436 22.7605C5.33221 22.9163 5.03435 22.9989 4.73083 23C4.42732 23.001 4.1289 22.9205 3.86572 22.7665C3.60254 22.6124 3.38391 22.3904 3.23191 22.1227C3.07991 21.8551 2.99991 21.5513 3 21.2421Z" stroke="#9B9B9B" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
</g>
</svg>`;

  // Comment Icon (SVG)
  const commentIconHtml = `<svg class="heart" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
<g clip-path="url(#clip0_51_103)">
<g opacity="0.7">
<path d="M12 23C14.1756 23 16.3023 22.3549 18.1113 21.1462C19.9202 19.9375 21.3301 18.2195 22.1627 16.2095C22.9952 14.1995 23.2131 11.9878 22.7886 9.85401C22.3642 7.72022 21.3165 5.76021 19.7782 4.22183C18.2398 2.68345 16.2798 1.6358 14.146 1.21137C12.0122 0.78693 9.80047 1.00477 7.79048 1.83733C5.78049 2.66989 4.06253 4.07979 2.85383 5.88873C1.64514 7.69767 1 9.82441 1 12C1 13.8187 1.44 15.5334 2.22222 17.0441L1 23L6.95589 21.7778C8.46655 22.56 10.1826 23 12 23Z" stroke="#9B9B9B" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
</g>
</g>
<defs>
<clipPath id="clip0_51_103">
<rect width="24" height="24" fill="white"/>
</clipPath>
</defs>
</svg>`;

  sortedList.forEach((episode) => {
    const episodeUrl = `https://castbox.fm/episode/id${episode.cid}-id${episode.eid}`;
    const coverUrl = episode.small_cover_url || episode.cover_url || "icon.png";
    const releaseDate = (episode.release_date || "1970-01-01T00:00:00Z").split(
      "T"
    )[0];

    // This HTML is a 1:1 copy of the structure
    html += `
      <section class="episodeRow opacityinAnimate" style="opacity: 1;">
        <div class="ep-item">
          <div class="ep-item-cover">
            <a href="${episodeUrl}" target="_blank">
              <div class="coverImgContainer" style="display: inline-block; height: 100%; width: 100%; overflow: hidden; border-radius: 4px; background-color: inherit;">
                <img src="${coverUrl}" class="image" alt="${
      episode.title
    }" style="display: inline-block; opacity: 1; width: 100%; height: 100%;">
              </div>
            </a>
          </div>
          <div class="ep-item-con">
            <a href="${episodeUrl}" target="_blank">
              <p title="${episode.title}" class="ep-item-con-title">
                <span class="ellipsis" style="display: inline-block;">${
                  episode.title || "(Untitled)"
                }</span>
              </p>
            </a>
            <p class="ep-item-con-des">
              <span class="item icon date">${releaseDate}</span>
              <span class="item icon time">${formatDuration(
                episode.duration
              )}</span>
              
              <span class="item custom-stat-item" title="Likes">
                ${likeIconHtml} ${formatCount(episode.like_count)}
              </span>
              <span class="item custom-stat-item" title="Plays">
                ${playIconHtml} ${formatCount(episode.play_count)}
              </span>
              <span class="item custom-stat-item" title="Comments">
                ${commentIconHtml} ${formatCount(episode.comment_count)}
              </span>
            </p>
          </div>
          <div class="ep-item-ctrls">
            <a class="ctrlItem play" href="${episodeUrl}" target="_blank"></a>
          </div>
        </div>
      </section>
    `;
  });

  html += `</div>`; // Close the wrapper div

  // 3. Inject the new HTML
  customListContainer.innerHTML = html;

  // 4. Hide the original list and show ours
  hideOriginalList();

  console.log("Full custom list rendered.");
}

// --- Main Execution ---
const observer = new MutationObserver((mutations) => {
  // ✅ --- SPA Bug Fix:
  // Instead of checking here, we call injectControls on every mutation.
  // The injectControls function itself is smart enough to check
  // if (1) the injection point exists and (2) the controls haven't already been injected.
  // This prevents a "Race Condition" during SPA loading.
  injectControls();
});

observer.observe(document.body, {
  childList: true,
  subtree: true,
});
