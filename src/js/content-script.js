async function delayAnimation(delay = 350) {
  return new Promise((resolve) => {
    setTimeout(resolve, delay);
  });
}

async function doAnimation(element, property, value) {
  return new Promise((resolve) => {
    const handler = () => {
      resolve();
      element.removeEventListener("transitionend", handler);
    };
    element.addEventListener("transitionend", handler);
    window.requestAnimationFrame(() => {
      element.style[property] = value;
    });
  });
}

async function addMessage(message) {
  const divElement = document.createElement("div");
  divElement.classList.add("container-notification");
  // Ideally we would use https://bugzilla.mozilla.org/show_bug.cgi?id=1340930 when this is available
  divElement.innerText = message.text;

  const imageElement = document.createElement("img");
  const imagePath = browser.runtime.getURL("/img/multiaccountcontainer-16.svg");
  const response = await fetch(imagePath);
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  imageElement.src = objectUrl;
  imageElement.width = imageElement.height = 24;
  divElement.prepend(imageElement);

  document.body.appendChild(divElement);

  await delayAnimation(100);
  await doAnimation(divElement, "transform", "translateY(0)");
  await delayAnimation(3000);
  await doAnimation(divElement, "transform", "translateY(-100%)");

  divElement.remove();
}

browser.runtime.onMessage.addListener((message) => {
  if (message && message.text) addMessage(message);
});

// Brave: Container indicator - adds a colored top bar showing container name (emulates Firefox's container tab underline)
(async () => {
  try {
    // Query current tab's container via background
    const response = await browser.runtime.sendMessage({ method: "queryIdentitiesState", message: { windowId: null } }).catch(() => null);
    // Alternatively request the current tab info via tabs API is not available in content, so we inject indicator based on storage
    // We'll use a lightweight approach: check if page was opened in a container tab by looking at URL params or storage
    // For now, we insert a minimal indicator if the extension sets a data attribute via background
    // Background will send container info via message if needed
  } catch (e) {}
})();

// Listen for container info broadcast to show indicator
browser.runtime.onMessage.addListener((message) => {
  if (message && message.braveContainerInfo) {
    showBraveContainerIndicator(message.braveContainerInfo);
  }
});

function showBraveContainerIndicator(info) {
  if (document.getElementById("brave-container-indicator")) return;
  if (!info || !info.name || info.cookieStoreId === "firefox-default") return;
  const bar = document.createElement("div");
  bar.id = "brave-container-indicator";
  bar.textContent = `▮ ${info.name}`;
  bar.style.cssText = `position:fixed;top:0;left:0;right:0;height:3px;z-index:2147483647;background:${info.colorCode || "#0060df"};color:${info.colorCode || "#0060df"};font-size:0;line-height:3px;pointer-events:none;`;
  bar.title = `Container: ${info.name}`;
  document.documentElement.appendChild(bar);
  // Also add left border for extra visibility
  document.documentElement.style.borderTop = `3px solid ${info.colorCode || "#0060df"}`;
}
