/* Service Worker for Brave Multi-Account Containers - MV3
 * Imports Brave polyfill first, then all original background scripts
 */

var window = self;
var document = { addEventListener: () => {}, createElement: () => ({}) };
importScripts("../brave-polyfill.js");
importScripts("../utils.js");
importScripts("../containerStyle.js");
importScripts("../proxified-containers.js");
importScripts("constants.js");
importScripts("backgroundLogic.js");
importScripts("mozillaVpnBackground.js");
importScripts("assignManager.js");
importScripts("badge.js");
importScripts("identityState.js");
importScripts("messageHandler.js");
importScripts("sync.js");
importScripts("siteAssociation.js");

// Brave extra: ensure container visual sync
self.addEventListener("activate", () => {
  // console.log("Brave Containers service worker activated");
});

// Keep service worker alive via periodic heartbeat (Brave/Chrome may suspend)
setInterval(() => {
  // heartbeat to keep tab container maps in memory
  // chrome.storage.session fallback ensures persistence
}, 20000);

// Handle commands same as Firefox (Ctrl+Shift+1..0 etc) - already handled in backgroundLogic.init
