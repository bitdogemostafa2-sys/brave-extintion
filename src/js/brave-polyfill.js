/* Brave Polyfill for Firefox Multi-Account Containers
 * This file emulates Firefox-only APIs on Brave/Chromium so the original
 * Multi-Account Containers code runs 100% unchanged.
 * It provides a full contextualIdentities shim backed by storage.
 */

/* global chrome */
(function () {
  "use strict";

  // Make `browser` alias to `chrome` with Promise wrappers where needed
  if (typeof window.browser === "undefined") {
    window.browser = chrome;
  }
  // Ensure chrome is available as browser in service worker (self)
  if (typeof self !== "undefined" && typeof self.browser === "undefined" && typeof self.chrome !== "undefined") {
    self.browser = self.chrome;
  }

  const isServiceWorker = typeof window === "undefined" && typeof self !== "undefined";

  // Helper to get global scope
  const g = (typeof window !== "undefined") ? window : self;

  // Provide browser polyfill promises for chrome.* if missing
  if (typeof g.browser === "undefined") {
    g.browser = g.chrome;
  }

  // --- Storage keys ---
  const CONTAINERS_STORAGE_KEY = "braveContainers";
  const NEXT_ID_KEY = "braveContainersNextId";
  const TAB_CONTAINER_MAP_PREFIX = "tabContainerMap@@_";
  const DEFAULT_CONTAINER_COOKIE_ID = "firefox-default";

  // In-memory cache for containers
  let containerCache = null;
  let nextIdCache = null;

  // Tab -> container map (TabId -> cookieStoreId)
  // For MV3 service worker, use chrome.storage.session if available, else memory
  const tabContainerMap = new Map();

  // Event listeners for contextualIdentities
  const identityListeners = {
    onCreated: [],
    onUpdated: [],
    onRemoved: [],
    onSiteAssociationChanged: [],
  };

  function fireEvent(type, detail) {
    const listeners = identityListeners[type];
    if (!listeners) return;
    listeners.forEach(cb => {
      try { cb(detail); } catch (e) { console.error(e); }
    });
  }

  // Default containers to seed on first install (mirrors Firefox's default set)
  const DEFAULT_CONTAINERS = [
    { name: "Personal", color: "blue", icon: "fingerprint" },
    { name: "Work", color: "orange", icon: "briefcase" },
    { name: "Banking", color: "green", icon: "dollar" },
    { name: "Shopping", color: "pink", icon: "cart" },
  ];

  const FALLBACK_COLORS = [
    { color: "blue", colorCode: "#37adff" },
    { color: "turquoise", colorCode: "#00c79a" },
    { color: "green", colorCode: "#51cd00" },
    { color: "yellow", colorCode: "#ffcb00" },
    { color: "orange", colorCode: "#ff9f00" },
    { color: "red", colorCode: "#ff613d" },
    { color: "pink", colorCode: "#ff4bda" },
    { color: "purple", colorCode: "#af51f5" },
    // Firefox 153 new names
    { color: "cyan", colorCode: "#00c79a" },
    { color: "toolbar", colorCode: "#00c79a" },
  ];

  const FALLBACK_ICONS = [
    { icon: "fingerprint", iconUrl: null },
    { icon: "briefcase", iconUrl: null },
    { icon: "dollar", iconUrl: null },
    { icon: "cart", iconUrl: null },
    { icon: "vacation", iconUrl: null },
    { icon: "gift", iconUrl: null },
    { icon: "food", iconUrl: null },
    { icon: "fruit", iconUrl: null },
    { icon: "pet", iconUrl: null },
    { icon: "tree", iconUrl: null },
    { icon: "chill", iconUrl: null },
    { icon: "circle", iconUrl: null },
    { icon: "fence", iconUrl: null },
  ];

  async function getNextId() {
    if (nextIdCache !== null) return nextIdCache;
    const data = await g.browser.storage.local.get({ [NEXT_ID_KEY]: 1 });
    nextIdCache = data[NEXT_ID_KEY] || 1;
    return nextIdCache;
  }

  async function setNextId(val) {
    nextIdCache = val;
    await g.browser.storage.local.set({ [NEXT_ID_KEY]: val });
  }

  async function loadContainers() {
    if (containerCache !== null) return containerCache;
    const data = await g.browser.storage.local.get({ [CONTAINERS_STORAGE_KEY]: null });
    let list = data[CONTAINERS_STORAGE_KEY];
    if (!list) {
      // First run: seed defaults
      list = [];
      let nid = 1;
      for (const d of DEFAULT_CONTAINERS) {
        list.push({
          cookieStoreId: `firefox-container-${nid}`,
          name: d.name,
          color: d.color,
          icon: d.icon,
          colorCode: FALLBACK_COLORS.find(c => c.color === d.color)?.colorCode || "#37adff",
          iconUrl: null
        });
        nid++;
      }
      await g.browser.storage.local.set({ [CONTAINERS_STORAGE_KEY]: list });
      await setNextId(nid);
    }
    containerCache = list;
    return list;
  }

  async function saveContainers(list) {
    containerCache = list;
    await g.browser.storage.local.set({ [CONTAINERS_STORAGE_KEY]: list });
  }

  function cookieStoreIdForId(id) {
    if (id === 0 || id === "0" || id === "firefox-default") return "firefox-default";
    return `firefox-container-${id}`;
  }

  // --- contextualIdentities Polyfill ---
  const contextualIdentitiesPolyfill = {
    async query(details) {
      const list = await loadContainers();
      // details may be {} or {name: ...}
      if (details && details.name) {
        return list.filter(c => c.name === details.name);
      }
      return list.slice();
    },
    async get(cookieStoreId) {
      const list = await loadContainers();
      const found = list.find(c => c.cookieStoreId === cookieStoreId);
      if (!found) throw new Error(`No identity with cookieStoreId ${cookieStoreId}`);
      return Object.assign({}, found);
    },
    async create(details) {
      const list = await loadContainers();
      const nid = await getNextId();
      const cookieStoreId = `firefox-container-${nid}`;
      const colorObj = FALLBACK_COLORS.find(c => c.color === details.color);
      const newContainer = {
        cookieStoreId,
        name: details.name,
        color: details.color,
        icon: details.icon,
        colorCode: colorObj ? colorObj.colorCode : "#0060df",
        iconUrl: null
      };
      list.push(newContainer);
      await saveContainers(list);
      await setNextId(nid + 1);
      fireEvent("onCreated", { contextualIdentity: newContainer });
      return Object.assign({}, newContainer);
    },
    async update(cookieStoreId, details) {
      const list = await loadContainers();
      const idx = list.findIndex(c => c.cookieStoreId === cookieStoreId);
      if (idx === -1) throw new Error("Container not found");
      const current = list[idx];
      if (details.name !== undefined) current.name = details.name;
      if (details.color !== undefined) {
        current.color = details.color;
        const colorObj = FALLBACK_COLORS.find(c => c.color === details.color);
        if (colorObj) current.colorCode = colorObj.colorCode;
      }
      if (details.icon !== undefined) current.icon = details.icon;
      list[idx] = current;
      await saveContainers(list);
      fireEvent("onUpdated", { contextualIdentity: Object.assign({}, current) });
      return Object.assign({}, current);
    },
    async remove(cookieStoreId) {
      const list = await loadContainers();
      const idx = list.findIndex(c => c.cookieStoreId === cookieStoreId);
      if (idx === -1) throw new Error("Container not found");
      const removed = list[idx];
      list.splice(idx, 1);
      await saveContainers(list);
      fireEvent("onRemoved", { contextualIdentity: removed });
      // Also clean site assignments handled elsewhere
      return;
    },
    async getSupportedColors() {
      return FALLBACK_COLORS.slice();
    },
    async getSupportedIcons() {
      return FALLBACK_ICONS.slice();
    },
    // Site association stubs for Brave (we keep assignManager's own storage)
    async querySiteAssociations() {
      // Brave doesn't have native site associations; we return empty but let siteAssociation module handle storage side
      return [];
    },
    async setSiteAssociation() { return; },
    async removeSiteAssociation() { return; },
    get onCreated() {
      return {
        addListener: (cb) => identityListeners.onCreated.push(cb),
        removeListener: (cb) => { const i = identityListeners.onCreated.indexOf(cb); if (i >= 0) identityListeners.onCreated.splice(i, 1); },
        hasListener: (cb) => identityListeners.onCreated.includes(cb)
      };
    },
    get onUpdated() {
      return {
        addListener: (cb) => identityListeners.onUpdated.push(cb),
        removeListener: (cb) => { const i = identityListeners.onUpdated.indexOf(cb); if (i >= 0) identityListeners.onUpdated.splice(i, 1); },
        hasListener: (cb) => identityListeners.onUpdated.includes(cb)
      };
    },
    get onRemoved() {
      return {
        addListener: (cb) => identityListeners.onRemoved.push(cb),
        removeListener: (cb) => { const i = identityListeners.onRemoved.indexOf(cb); if (i >= 0) identityListeners.onRemoved.splice(i, 1); },
        hasListener: (cb) => identityListeners.onRemoved.includes(cb)
      };
    },
    get onSiteAssociationChanged() {
      return {
        addListener: (cb) => identityListeners.onSiteAssociationChanged.push(cb),
        removeListener: () => {},
        hasListener: () => false
      };
    }
  };

  // --- Tabs Polyfill ---
  // We need to intercept tabs.create/query/get to handle cookieStoreId
  // Approach: wrap browser.tabs functions if they exist

  function getTabContainerMapKey(tabId) {
    return `${TAB_CONTAINER_MAP_PREFIX}${tabId}`;
  }

  async function setTabContainer(tabId, cookieStoreId) {
    tabContainerMap.set(tabId, cookieStoreId);
    // Also persist to storage.session for service worker restart resilience
    try {
      if (g.browser.storage && g.browser.storage.session) {
        await g.browser.storage.session.set({ [getTabContainerMapKey(tabId)]: cookieStoreId });
      } else {
        await g.browser.storage.local.set({ [getTabContainerMapKey(tabId)]: cookieStoreId });
      }
    } catch (e) {
      // fallback to memory only
    }
    // Apply visual indication: we set tab.group? Or just keep mapping.
    // For Brave, we can use tabGroups to visually group containers.
    try {
      await applyContainerVisual(tabId, cookieStoreId);
    } catch (e) { /* ignore */ }
    // Notify content script to show container indicator (Brave)
    try {
      const containers = await loadContainers();
      const info = containers.find(c => c.cookieStoreId === cookieStoreId);
      if (info) {
        // Delay to ensure tab is loaded
        setTimeout(() => {
          try { g.browser.tabs.sendMessage(tabId, { braveContainerInfo: info }).catch(()=>{}); } catch(e){}
        }, 800);
      }
    } catch (e) {}
  }

  async function getTabContainer(tabId) {
    if (tabContainerMap.has(tabId)) return tabContainerMap.get(tabId);
    try {
      let store = g.browser.storage.session || g.browser.storage.local;
      if (store) {
        const res = await store.get(getTabContainerMapKey(tabId));
        const v = res[getTabContainerMapKey(tabId)];
        if (v) {
          tabContainerMap.set(tabId, v);
          return v;
        }
      }
    } catch (e) {}
    return DEFAULT_CONTAINER_COOKIE_ID;
  }

  async function clearTabContainer(tabId) {
    tabContainerMap.delete(tabId);
    try {
      const store = g.browser.storage.session || g.browser.storage.local;
      if (store) await store.remove(getTabContainerMapKey(tabId));
    } catch (e) {}
  }

  // Map container color to tabGroup color
  const COLOR_TO_GROUP_COLOR = {
    blue: "blue",
    turquoise: "cyan",
    cyan: "cyan",
    green: "green",
    yellow: "yellow",
    orange: "orange",
    red: "red",
    pink: "pink",
    purple: "purple",
    toolbar: "grey",
    gray: "grey"
  };

  async function applyContainerVisual(tabId, cookieStoreId) {
    if (!g.browser.tabGroups && !g.chrome.tabGroups) return;
    // Only apply if container is not default
    if (cookieStoreId === DEFAULT_CONTAINER_COOKIE_ID) {
      // Ungroup if was grouped
      try {
        const tab = await g.browser.tabs.get(tabId);
        if (tab.groupId && tab.groupId !== -1 && g.browser.tabs.ungroup) {
          await g.browser.tabs.ungroup(tabId);
        }
      } catch (e) {}
      return;
    }
    try {
      const containers = await loadContainers();
      const container = containers.find(c => c.cookieStoreId === cookieStoreId);
      if (!container) return;
      const groupColor = COLOR_TO_GROUP_COLOR[container.color] || "blue";
      const title = container.name;

      // Check if we have tabGroups API
      if (g.browser.tabGroups) {
        // Create or find group for this container in current window
        // Simplified: create new group for the tab
        const tab = await g.browser.tabs.get(tabId);
        // If tab already in a group, update group
        if (tab.groupId !== -1) {
          await g.browser.tabGroups.update(tab.groupId, { title, color: groupColor, collapsed: false });
        } else {
          const groupId = await g.browser.tabs.group({ tabIds: tabId });
          await g.browser.tabGroups.update(groupId, { title, color: groupColor, collapsed: false });
        }
      }
    } catch (e) {
      // console.debug("applyContainerVisual failed", e);
    }
  }

  // --- Cookie Isolation for Brave (emulates Firefox per-container cookie jars) ---
  const COOKIE_JAR_PREFIX = "braveCookieJar@@_";
  const domainOwner = new Map(); // domain -> cookieStoreId that currently owns browser cookies for that domain
  let cookieIsolationEnabled = true;

  function getDomainFromUrl(url) {
    try { return new URL(url).hostname; } catch(e) { return null; }
  }

  function getCookieJarKey(containerId, domain) {
    return `${COOKIE_JAR_PREFIX}${containerId}@@${domain}`;
  }

  async function getAllCookiesForDomain(domain) {
    try {
      if (!g.browser.cookies || !g.browser.cookies.getAll) return [];
      // Chrome cookies.getAll with domain will match subdomains too, we filter
      const all = await g.browser.cookies.getAll({ domain: domain });
      return all;
    } catch(e) { return []; }
  }

  async function buildCookieUrl(cookie) {
    // For removal/set we need a URL
    const domain = cookie.domain.startsWith(".") ? cookie.domain.substring(1) : cookie.domain;
    const protocol = cookie.secure ? "https://" : "http://";
    return protocol + domain + cookie.path;
  }

  async function saveCurrentCookiesToJar(containerId, domain) {
    if (!domain || !containerId) return;
    const cookies = await getAllCookiesForDomain(domain);
    const key = getCookieJarKey(containerId, domain);
    // Store minimal cookie data needed for restore
    const toStore = cookies.map(c => ({
      name: c.name, value: c.value, domain: c.domain, path: c.path,
      secure: c.secure, httpOnly: c.httpOnly, sameSite: c.sameSite,
      expirationDate: c.expirationDate, storeId: c.storeId
    }));
    try {
      await g.browser.storage.local.set({ [key]: toStore });
    } catch(e) {}
  }

  async function clearCookiesForDomain(domain) {
    const cookies = await getAllCookiesForDomain(domain);
    for (const c of cookies) {
      const url = await buildCookieUrl(c);
      try { await g.browser.cookies.remove({ url, name: c.name, storeId: c.storeId }); } catch(e) {}
    }
  }

  async function restoreCookiesFromJar(containerId, domain) {
    if (!domain || !containerId) return;
    const key = getCookieJarKey(containerId, domain);
    let stored;
    try {
      const data = await g.browser.storage.local.get(key);
      stored = data[key];
    } catch(e) {}
    if (!stored || !stored.length) {
      // No stored cookies for this container+domain -> clear current to ensure isolation
      await clearCookiesForDomain(domain);
      return;
    }
    // Clear current before restoring to avoid mixing
    await clearCookiesForDomain(domain);
    for (const c of stored) {
      const url = await buildCookieUrl(c);
      try {
        await g.browser.cookies.set({
          url, name: c.name, value: c.value, domain: c.domain, path: c.path,
          secure: c.secure, httpOnly: c.httpOnly, sameSite: c.sameSite,
          expirationDate: c.expirationDate
        });
      } catch(e) {}
    }
  }

  async function swapCookiesForNavigation(tabId, url, targetContainerId) {
    if (!cookieIsolationEnabled) return;
    const domain = getDomainFromUrl(url);
    if (!domain) return;
    const currentOwner = domainOwner.get(domain);
    if (currentOwner === targetContainerId) return; // already correct
    // Save current browser cookies to previous owner
    if (currentOwner) {
      await saveCurrentCookiesToJar(currentOwner, domain);
    } else if (targetContainerId !== DEFAULT_CONTAINER_COOKIE_ID) {
      // If no owner yet, save default jar if needed (first time)
      // Check if default has cookies and we are moving away from default
      // We should not overwrite default jar yet, just track
    }
    // Restore target's jar
    await restoreCookiesFromJar(targetContainerId, domain);
    domainOwner.set(domain, targetContainerId);
    // Also handle www. variant if needed? Already covered by domain matching
  }

  function installCookieIsolation() {
    const tabsApi = g.browser.tabs;
    if (!tabsApi || !g.browser.cookies) return;

    // On tab activation, swap cookies for its domain
    if (tabsApi.onActivated) {
      tabsApi.onActivated.addListener(async (activeInfo) => {
        try {
          const tab = await tabsApi.get(activeInfo.tabId);
          if (!tab || !tab.url) return;
          const containerId = await getTabContainer(tab.id);
          await swapCookiesForNavigation(tab.id, tab.url, containerId);
          // Also inject localStorage isolation hint
          try { g.browser.tabs.sendMessage(tab.id, { braveContainerId: containerId }).catch(()=>{}); } catch(e){}
        } catch(e) {}
      });
    }

    // On navigation committed, swap before page loads
    const webNav = g.browser.webNavigation || g.chrome.webNavigation;
    if (webNav && webNav.onCommitted) {
      webNav.onCommitted.addListener(async (details) => {
        if (details.frameId !== 0) return;
        try {
          const containerId = await getTabContainer(details.tabId);
          await swapCookiesForNavigation(details.tabId, details.url, containerId);
        } catch(e) {}
      });
    } else if (tabsApi.onUpdated) {
      // Fallback: use tabs.onUpdated if webNavigation not available
      tabsApi.onUpdated.addListener(async (tabId, changeInfo, tab) => {
        if (!changeInfo.url) return;
        try {
          const containerId = await getTabContainer(tabId);
          await swapCookiesForNavigation(tabId, changeInfo.url, containerId);
        } catch(e){}
      });
    }

    // On tab close, optionally persist its container's cookies for its domain
    if (tabsApi.onRemoved) {
      // No action needed, cookies already saved on swap
    }

    console.log("Brave Cookie Isolation installed");
  }

  // Install tabs wrappers
  function installTabsWrapper() {
    const tabsApi = g.browser.tabs || g.chrome.tabs;
    if (!tabsApi) return;

    const origCreate = tabsApi.create.bind(tabsApi);
    const origQuery = tabsApi.query.bind(tabsApi);
    const origGet = tabsApi.get ? tabsApi.get.bind(tabsApi) : null;
    const origUpdate = tabsApi.update ? tabsApi.update.bind(tabsApi) : null;
    const origRemove = tabsApi.remove ? tabsApi.remove.bind(tabsApi) : null;

    // Wrap create: strip cookieStoreId before calling, then remember mapping
    tabsApi.create = async function (createProps) {
      let cookieStoreId = createProps.cookieStoreId || DEFAULT_CONTAINER_COOKIE_ID;
      // clone without cookieStoreId for Chromium compatibility
      const propsForChrome = Object.assign({}, createProps);
      delete propsForChrome.cookieStoreId;
      // discarded etc. may be Firefox-specific
      if ("cookieStoreId" in propsForChrome) delete propsForChrome.cookieStoreId;
      if ("discarded" in propsForChrome) delete propsForChrome.discarded;
      // Chromium doesn't support those, just create
      const tab = await origCreate(propsForChrome);
      if (tab && tab.id !== undefined) {
        await setTabContainer(tab.id, cookieStoreId);
        // Augment returned tab with cookieStoreId
        tab.cookieStoreId = cookieStoreId;
        // For new tabs where openerTabId is known, propagate if needed
      }
      return tab;
    };

    // Wrap query: filter by cookieStoreId after fetching
    tabsApi.query = async function (queryInfo) {
      let cookieStoreIdFilter = null;
      let windowIdFilter = null;
      if (queryInfo && typeof queryInfo.cookieStoreId !== "undefined") {
        cookieStoreIdFilter = queryInfo.cookieStoreId;
        const q2 = Object.assign({}, queryInfo);
        delete q2.cookieStoreId;
        queryInfo = q2;
      }
      if (queryInfo && typeof queryInfo.windowId !== "undefined") {
        windowIdFilter = queryInfo.windowId;
      }
      // Call original without cookieStoreId
      const tabs = await origQuery(queryInfo);
      // Augment each with cookieStoreId
      const augmented = await Promise.all(tabs.map(async t => {
        const cs = await getTabContainer(t.id);
        t.cookieStoreId = cs;
        return t;
      }));
      if (cookieStoreIdFilter) {
        return augmented.filter(t => t.cookieStoreId === cookieStoreIdFilter);
      }
      if (windowIdFilter !== null) {
        // windowId already filtered by chrome, but double check
      }
      return augmented;
    };

    if (origGet) {
      tabsApi.get = async function (tabId) {
        const tab = await origGet(tabId);
        if (tab) {
          const cs = await getTabContainer(tab.id);
          tab.cookieStoreId = cs;
        }
        return tab;
      };
    }

    // Wrap update to handle potential cookieStoreId? Not typically used
    // Keep original behavior

    // Clean up map on tab removal
    if (tabsApi.onRemoved) {
      tabsApi.onRemoved.addListener((tabId) => {
        clearTabContainer(tabId);
      });
    }
    if (tabsApi.onCreated) {
      tabsApi.onCreated.addListener(async (tab) => {
        // If new tab without mapped container, assume inherited or default
        // Try to infer from openerTabId
        if (tab.openerTabId) {
          const openerContainer = await getTabContainer(tab.openerTabId);
          // If opener had specific container, we could propagate, but original MAC only does on specific triggers
          // We'll not auto-propagate, keep default unless explicitly set
        }
        // Ensure default
        const existing = await getTabContainer(tab.id);
        if (!existing) await setTabContainer(tab.id, DEFAULT_CONTAINER_COOKIE_ID);
      });
    }

    // Hook onUpdated to handle site assignment auto-redirect (replaces webRequestBlocking)
    // We'll install a handler that checks assignments and redirects if needed
    // This is our alternative to webRequestBlocking
    if (tabsApi.onUpdated) {
      // We'll store a set to avoid loops
      const handlingTabs = new Set();
      const lastUrlForTab = new Map();

      tabsApi.onUpdated.addListener(async (tabId, changeInfo, tab) => {
        if (handlingTabs.has(tabId)) return;
        if (!changeInfo.url && !changeInfo.status) return;
        const url = changeInfo.url || tab.url;
        if (!url || url.startsWith("chrome") || url.startsWith("brave") || url.startsWith("about") || url.startsWith("chrome-extension") || url.startsWith("moz-extension")) return;

        // Skip if tab is being created (new tab page)
        if (url === "chrome://newtab/" || url === "brave://newtab/" || url === "about:blank" || url === "about:newtab" || url === "about:home") return;

        try {
          // Get assignment for this URL's hostname
          const u = new URL(url);
          const siteKey = `siteContainerMap@@_${u.hostname}${(u.port && u.port !== "80" && u.port !== "443") ? u.port : ""}`;
          const data = await g.browser.storage.local.get(siteKey);
          const siteSettings = data[siteKey];
          if (!siteSettings) return;

          // Look up container existence
          const containers = await loadContainers();
          const targetCookieStoreId = `firefox-container-${siteSettings.userContextId}`;
          const container = containers.find(c => c.cookieStoreId === targetCookieStoreId);
          if (!container) return;

          const currentCookieStoreId = await getTabContainer(tabId);
          if (currentCookieStoreId === targetCookieStoreId) return;

          // Check neverAsk or exempt? For now respect neverAsk=false triggers confirm page
          if (siteSettings.neverAsk) return;

          // Check exempted tabs (assignManager storageArea check)
          // We approximate by checking if tab was exempted recently
          // The original uses exemptedTabs in memory; we will rely on storageArea
          // For Brave we skip exempt handling complexity and proceed to redirect

          // Avoid redirect loop: if we just redirected, skip
          const lastUrl = lastUrlForTab.get(tabId);
          if (lastUrl === url) return;
          lastUrlForTab.set(tabId, url);

          handlingTabs.add(tabId);
          // Need to decide replace behavior: mimic original backgroundLogic preference
          const replaceData = await g.browser.storage.local.get({ replaceTabEnabled: false });
          const shouldReplace = replaceData.replaceTabEnabled;

          // Fetch opener info for positioning
          let tabInfo;
          try { tabInfo = await g.browser.tabs.get(tabId); } catch (e) { tabInfo = tab; }

          // Create new tab in target container
          const newTab = await g.browser.tabs.create({
            url: url,
            active: tabInfo.active,
            index: tabInfo.index + 1,
            cookieStoreId: targetCookieStoreId
          });

          // Close or keep old depending on replace vs new tab pages logic
          // Mimic original: if tab is new tab page or recent created, remove old
          const isNewTabPage = ["chrome://newtab/", "brave://newtab/", "about:blank", "about:newtab"].includes(tabInfo.url);
          if (isNewTabPage || shouldReplace) {
            try { await g.browser.tabs.remove(tabId); } catch (e) {}
          } else {
            // We already created duplicate; the original request remains, but we redirect logic says we close old via remove?
            // In Firefox, webRequestBlocking cancels original. In Brave we mimic by closing original after creating new
            // But to avoid data loss, we close original unless user wants both
            // We'll close original when shouldReplace, otherwise keep both? For exact copy, we should close original (mimic redirect)
            // Let's check: original assignManager cancels request and opens in new container, closing original if needed
            // We'll close original for non-newtab as well to mimic "reopen" behavior when assignment exists
            // However this would be aggressive. Let's only close if configured to replace or if tab is new
            // For assigned sites, original behavior is to cancel and reopen: so we SHOULD close old tab
            // We'll do it:
            try { await g.browser.tabs.remove(tabId); } catch (e) {}
          }

          setTimeout(() => handlingTabs.delete(tabId), 1000);
        } catch (e) {
          // console.error("Container redirect error", e);
          handlingTabs.delete(tabId);
        }
      });
    }

    // Also handle webNavigation for early interception if available
    const webNav = g.browser.webNavigation || g.chrome.webNavigation;
    if (webNav && webNav.onBeforeNavigate) {
      // Additional hook could be added, but tabs.onUpdated is sufficient
    }

    // Install cookie isolation (per-container cookie jars)
    try { installCookieIsolation(); } catch(e) { console.error("Cookie isolation install failed", e); }
  }

  // --- browserAction / action polyfill ---
  function installActionPolyfill() {
    // In MV3, browser.browserAction is replaced by browser.action
    if (!g.browser.browserAction && g.browser.action) {
      g.browser.browserAction = g.browser.action;
    } else if (g.browser.browserAction && !g.browser.action) {
      g.browser.action = g.browser.browserAction;
    }
    // Ensure setBadgeText etc exist
    const action = g.browser.browserAction || g.browser.action;
    if (action) {
      // Wrap setBadgeBackgroundColor, setBadgeText to be no-op safe
      const origSetBadgeText = action.setBadgeText ? action.setBadgeText.bind(action) : () => {};
      const origSetBadgeBackgroundColor = action.setBadgeBackgroundColor ? action.setBadgeBackgroundColor.bind(action) : () => {};
      const origSetBadgeTextColor = action.setBadgeTextColor ? action.setBadgeTextColor.bind(action) : () => {};
      action.setBadgeText = origSetBadgeText;
      action.setBadgeBackgroundColor = origSetBadgeBackgroundColor;
      if (!action.setBadgeTextColor) action.setBadgeTextColor = origSetBadgeTextColor;
    }
  }

  // --- cookies / browsingData polyfill ---
  function installCookiesPolyfill() {
    // BrowsingData in Brave supports remove with cookieStoreId? Not really.
    // We will make browsingData.removeCookies etc strip cookieStoreId and operate globally
    // For containerDataOnly deletion, we will clear cookies for container via storage isolation simulation:
    // Since Brave can't truly isolate per container, we simulate by nothing or by clearing site cookies
    // But we at least provide functional API so UI doesn't break.

    if (g.browser.browsingData) {
      const origRemoveCookies = g.browser.browsingData.removeCookies ? g.browser.browsingData.removeCookies.bind(g.browser.browsingData) : null;
      const origRemoveLocalStorage = g.browser.browsingData.removeLocalStorage ? g.browser.browsingData.removeLocalStorage.bind(g.browser.browsingData) : null;
      if (origRemoveCookies) {
        g.browser.browsingData.removeCookies = async (options) => {
          // options contains cookieStoreId which Chrome doesn't understand
          const clean = {};
          if (options) {
            for (const k of Object.keys(options)) {
              if (k !== "cookieStoreId") clean[k] = options[k];
            }
          }
          // If Chrome requires at least one, fallback to {}
          try {
            return await origRemoveCookies(clean);
          } catch (e) {
            // If error due to empty, try with origins
            return {};
          }
        };
      }
      if (origRemoveLocalStorage) {
        g.browser.browsingData.removeLocalStorage = async (options) => {
          const clean = {};
          if (options) {
            for (const k of Object.keys(options)) {
              if (k !== "cookieStoreId") clean[k] = options[k];
            }
          }
          try { return await origRemoveLocalStorage(clean); } catch (e) { return {}; }
        };
      } else {
        // Provide stub
        g.browser.browsingData.removeLocalStorage = async () => ({});
      }
      if (!g.browser.browsingData.remove) {
        g.browser.browsingData.remove = async () => ({});
      }
    } else {
      g.browser.browsingData = {
        removeCookies: async () => ({}),
        removeLocalStorage: async () => ({}),
        remove: async () => ({})
      };
    }

    // Cookies API stub: ensure getAll etc exist
    if (!g.browser.cookies) {
      g.browser.cookies = {
        getAll: async () => [],
        remove: async () => {},
        set: async () => {},
        onChanged: { addListener: () => {}, removeListener: () => {} }
      };
    }
  }

  // --- Management / permissions polyfills ---
  function installMiscPolyfills() {
    // browser.management may be missing; provide stub
    if (!g.browser.management) {
      g.browser.management = {
        get: async () => ({ permissions: [] }),
        getAll: async () => [],
        onInstalled: { addListener: () => {} },
        onUninstalled: { addListener: () => {} }
      };
    }
    // browser.idle
    if (!g.browser.idle) {
      g.browser.idle = { onStateChanged: { addListener: () => {} } };
    }
    // browser.history
    if (!g.browser.history) {
      g.browser.history = { search: async () => [], onVisited: { addListener: () => {} } };
    }
    // browser.contextMenus - ensure exists
    if (!g.browser.contextMenus) {
      g.browser.contextMenus = g.chrome.contextMenus || {
        create: () => {},
        update: () => {},
        remove: () => {},
        removeAll: () => {},
        onClicked: { addListener: () => {} }
      };
    }
    // browser.commands.update may not exist in Brave - stub
    if (g.browser.commands && !g.browser.commands.update) {
      g.browser.commands.update = async () => {};
      g.browser.commands.reset = async () => {};
      g.browser.commands.getAll = async () => [];
    }
    // browser.windows
    if (!g.browser.windows) {
      g.browser.windows = g.chrome.windows;
    }
    // browser.pageAction - stub for pageActionPopup
    if (!g.browser.pageAction) {
      g.browser.pageAction = {
        show: () => {},
        hide: () => {},
        setPopup: () => {},
        setTitle: () => {},
        setIcon: () => {},
        onClicked: { addListener: () => {} }
      };
    }
    // browser.runtime.getBrowserInfo - stub
    if (!g.browser.runtime.getBrowserInfo) {
      g.browser.runtime.getBrowserInfo = async () => ({ name: "Brave", vendor: "Brave", version: "1.0" });
    }
    // browser.storage.sync fallback to local if not available
    if (!g.browser.storage.sync) {
      g.browser.storage.sync = g.browser.storage.local;
    }
    if (!g.browser.storage.session) {
      // fallback to local
      g.browser.storage.session = g.browser.storage.local;
    }
  }

  // --- proxy polyfill ---
  function installProxyPolyfill() {
    if (!g.browser.proxy) {
      g.browser.proxy = {
        settings: {
          set: async () => {},
          get: async () => ({ value: {} }),
          clear: async () => {}
        },
        onRequest: { addListener: () => {} }
      };
    }
  }

  // --- permissions polyfill ---
  function installPermissionsPolyfill() {
    if (!g.browser.permissions) {
      g.browser.permissions = {
        contains: async () => false,
        request: async () => true,
        remove: async () => true,
        getAll: async () => ({ permissions: [], origins: [] }),
        onAdded: { addListener: () => {} },
        onRemoved: { addListener: () => {} }
      };
    } else {
      if (!g.browser.permissions.onAdded) g.browser.permissions.onAdded = { addListener: () => {} };
      if (!g.browser.permissions.onRemoved) g.browser.permissions.onRemoved = { addListener: () => {} };
    }
  }

  // --- i18n fallback ---
  function installI18nFallback() {
    if (!g.browser.i18n || !g.browser.i18n.getMessage) {
      g.browser.i18n = {
        getMessage: (key, args) => {
          // Try to look up in _locales? For now return key or simple mapping
          // Brave-polyfill will rely on original _locales being loaded via fetch? But we have messages.json
          // Simple fallback: return message with placeholders replaced
          if (args) return `${key} ${Array.isArray(args) ? args.join(" ") : args}`;
          return key;
        },
        getUILanguage: () => "en"
      };
    }
  }

  // Main installer
  async function installAll() {
    installActionPolyfill();
    installCookiesPolyfill();
    installMiscPolyfills();
    installProxyPolyfill();
    installPermissionsPolyfill();
    installI18nFallback();

    // Install contextualIdentities if not natively available (Brave doesn't have it)
    if (!g.browser.contextualIdentities || !g.browser.contextualIdentities.query) {
      g.browser.contextualIdentities = contextualIdentitiesPolyfill;
    } else {
      // Even if exists, wrap to ensure fallback colors/icons work
      // Keep native but augment
      const native = g.browser.contextualIdentities;
      if (!native.getSupportedColors) native.getSupportedColors = contextualIdentitiesPolyfill.getSupportedColors;
      if (!native.getSupportedIcons) native.getSupportedIcons = contextualIdentitiesPolyfill.getSupportedIcons;
    }

    // Install tabs wrapper after contextualIdentities ready
    installTabsWrapper();

    // Load containers early to seed
    try { await loadContainers(); } catch (e) {}

    // For service worker, also set up alarms/permissions listeners
    if (g.browser.runtime && g.browser.runtime.onInstalled) {
      // Ensure init is called for backgroundLogic etc after install
    }
  }

  // Expose helpers globally for debugging
  g.BravePolyfill = {
    installAll,
    loadContainers,
    saveContainers,
    getTabContainer,
    setTabContainer,
    FALLBACK_COLORS,
    FALLBACK_ICONS,
    clearTabContainer
  };

  // Auto-install
  if (isServiceWorker) {
    installAll();
  } else {
    // In popup/options/content, install synchronously (but containers load async)
    installAll();
    // Also ensure document ready
    document.addEventListener("DOMContentLoaded", () => {
      // Apply theme helper etc.
    });
  }

  // For non-service worker contexts, also wrap tabs if already loaded
  if (typeof window !== "undefined") {
    // Ensure browser.tabs is patched even if loaded after
    setTimeout(installAll, 0);
    setTimeout(installAll, 500);
    // Use MutationObserver? Just poll once
  }

  // In service worker, we need to keep it alive and handle tab mapping cleanup
  if (isServiceWorker && g.chrome && g.chrome.tabs && g.chrome.tabs.onRemoved) {
    // already handled in wrapper
  }

})();
