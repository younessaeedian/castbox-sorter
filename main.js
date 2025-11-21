console.log("Main Script Loaded");

// --- Event Handlers for UI ---
function toggleDropdown(e) {
  e.stopPropagation();
  if (customDropdownMenu) customDropdownMenu.classList.toggle("is-open");

  // ✅ تغییر: اضافه/حذف کلاس فعال برای مدیریت استایل نارنجی و چرخش فلش
  e.currentTarget.classList.toggle("is-active");
}

function handleOptionClick(e) {
  const value = e.currentTarget.dataset.value; // Use currentTarget for safety
  const text = e.currentTarget.innerText;

  const allOptions = document.querySelectorAll(".sorter-option");
  allOptions.forEach((opt) => opt.classList.remove("is-selected"));
  e.currentTarget.classList.add("is-selected");

  if (customDropdownValue) customDropdownValue.innerText = text;

  if (customDropdownMenu) customDropdownMenu.classList.remove("is-open");

  // ✅ تغییر: حذف کلاس فعال از دکمه اصلی هنگام انتخاب گزینه
  const control = document.querySelector(".sorter-control");
  if (control) control.classList.remove("is-active");

  // Call logic function from api-logic.js
  currentSortType = value; // Update global state
  handleSortRequest(value);
}

// --- Close Dropdown on Outside Click ---
document.addEventListener("click", (e) => {
  const container = document.querySelector(".sorter-component-container");
  if (container && !container.contains(e.target)) {
    if (customDropdownMenu) customDropdownMenu.classList.remove("is-open");

    // ✅ تغییر: حذف کلاس فعال از دکمه اصلی هنگام کلیک بیرون
    const control = document.querySelector(".sorter-control");
    if (control) control.classList.remove("is-active");
  }
});

// --- Initialization ---
const observer = new MutationObserver((mutations) => {
  // injectControls is defined in ui-renderer.js
  injectControls();
});

observer.observe(document.body, {
  childList: true,
  subtree: true,
});
