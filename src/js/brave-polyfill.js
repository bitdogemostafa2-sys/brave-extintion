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
  const DOMAIN_OWNER_KEY = "braveDomainOwner";
  let domainOwner = new Map(); // domain -> cookieStoreId that currently owns browser cookies for that domain
  let cookieIsolationEnabled = true;
  // Persist domainOwner so التاب الأصلي ما يخرجش بعد ما الـ service worker ينام ويصحى
  async function persistDomainOwner() {
    try {
      const obj = Object.fromEntries(domainOwner);
      await g.browser.storage.local.set({ [DOMAIN_OWNER_KEY]: obj });
    } catch(e){}
  }
  async function loadDomainOwner() {
    try {
      const data = await g.browser.storage.local.get({ [DOMAIN_OWNER_KEY]: {} });
      const obj = data[DOMAIN_OWNER_KEY] || {};
      domainOwner = new Map(Object.entries(obj));
      if (domainOwner.size) console.log(`Loaded domainOwner ${domainOwner.size} domains`, obj);
    } catch(e){}
  }
  // Load on startup
  try { loadDomainOwner(); } catch(e){}

  function getDomainFromUrl(url) {
    try { return new URL(url).hostname; } catch(e) { return null; }
  }

  function getBaseDomain(hostname) {
    if (!hostname) return null;
    // Simple eTLD+1: last 2 labels for most TLDs, handle co.* etc via heuristic
    const parts = hostname.split(".").filter(Boolean);
    if (parts.length <= 2) return hostname;
    // Known publicsuffix 2-level TLDs
    const twoLevel = ["co.uk","co.jp","com.au","co.nz","co.za","com.br","co.in"];
    const last2 = parts.slice(-2).join(".");
    const last3 = parts.slice(-3).join(".");
    if (twoLevel.includes(last2)) return parts.slice(-3).join(".");
    return parts.slice(-2).join(".");
  }

  function getCookieJarKey(containerId, domain) {
    const base = getBaseDomain(domain) || domain;
    return `${COOKIE_JAR_PREFIX}${containerId}@@${base}`;
  }

  async function getAllCookiesForDomain(domain) {
    try {
      if (!g.browser.cookies || !g.browser.cookies.getAll) return [];
      // Fetch all cookies and filter by domain matching (parent domain cookies like .dutchycorp.space)
      const all = await g.browser.cookies.getAll({});
      const base = domain.toLowerCase();
      return all.filter(c => {
        const cd = (c.domain || "").toLowerCase();
        // Exact or parent domain match
        if (cd === base) return true;
        if (cd.startsWith(".")) {
          const bare = cd.slice(1);
          return base === bare || base.endsWith("."+bare);
        }
        // Also check if cookie domain is subdomain of requested? e.g., request autofaucet.dutchycorp.space, cookie for autofaucet.dutchycorp.space
        return cd === base || base.endsWith("."+cd) || cd.endsWith("."+base);
      });
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

  // --- Reset container per-tab (كوكيز + History + localStorage/cache كأن المتصفح جديد) ---
  async function clearContainerAllData(containerId) {
    if (!containerId) return;
    try {
      const all = await g.browser.storage.local.get();
      const keysToRemove = [];
      for (const k of Object.keys(all)) {
        if (k.startsWith(COOKIE_JAR_PREFIX + containerId + "@@")) {
          keysToRemove.push(k);
        }
        // Keep pcFingerprint@@_ (بصمة PC ثابتة) - لا نمسحها في full_reset العادي
        // لو عايز مسح شامل مع بصمة، استخدم clearContainerWithFingerprint
      }
      if (keysToRemove.length) {
        await g.browser.storage.local.remove(keysToRemove);
        console.log(`Cleared ${keysToRemove.length} cookie jars for ${containerId}`);
      }
      // Clear domainOwner entries owned by this container
      for (const [domain, owner] of domainOwner.entries()) {
        if (owner === containerId) domainOwner.delete(domain);
      }
      // Also clear real browser cookies that currently belong to this container's domains
      // We can't know all domains, but we clear for domains we just removed
      for (const key of keysToRemove) {
        const domain = key.slice((COOKIE_JAR_PREFIX + containerId + "@@").length);
        try { await clearCookiesForDomain(domain); } catch(e){}
      }
    } catch(e) { console.error("clearContainerAllData failed", e); }
  }

  async function clearContainerWithFingerprint(containerId) {
    await clearContainerAllData(containerId);
    try {
      const fpKey = `pcFingerprint@@_${String(containerId).replace(/[^a-zA-Z0-9_-]/g,'_')}`;
      await g.browser.storage.local.remove(fpKey);
      // Remove from index
      const idxData = await g.browser.storage.local.get({ pcFingerprintIndex: [] });
      let idx = idxData.pcFingerprintIndex || [];
      idx = idx.filter(id => id !== String(containerId));
      await g.browser.storage.local.set({ pcFingerprintIndex: idx });
      console.log(`Cleared fingerprint for ${containerId}`);
    } catch(e){}
  }

  // Parse Set-Cookie string into object
  function parseSetCookie(str) {
    try {
      const parts = str.split(";").map(s => s.trim());
      const [nameValue, ...attrs] = parts;
      const eq = nameValue.indexOf("=");
      if (eq === -1) return null;
      const name = nameValue.slice(0, eq).trim();
      const value = nameValue.slice(eq+1).trim();
      let domain = null, path = "/", secure = false, httpOnly = false, sameSite = "lax", expires = null;
      for (const a of attrs) {
        const [k,v] = a.split("=").map(s=> s.trim().toLowerCase());
        if (k === "domain") domain = v;
        else if (k === "path") path = v || "/";
        else if (k === "secure") secure = true;
        else if (k === "httponly") httpOnly = true;
        else if (k === "samesite") sameSite = v || "lax";
        else if (k === "expires") { try{ expires = new Date(v).getTime()/1000; }catch(e){} }
        else if (k === "max-age") { try{ expires = Date.now()/1000 + parseInt(v,10); }catch(e){} }
      }
      return { name, value, domain, path, secure, httpOnly, sameSite, expirationDate: expires };
    } catch(e){ return null; }
  }

  function cookieMatchesDomain(cookieDomain, requestDomain) {
    if (!cookieDomain) return true;
    const cd = cookieDomain.startsWith(".") ? cookieDomain.slice(1).toLowerCase() : cookieDomain.toLowerCase();
    const rd = requestDomain.toLowerCase();
    return rd === cd || rd.endsWith("."+cd);
  }

  async function getCookieHeaderForContainer(requestDomain, containerId) {
    if (!requestDomain || !containerId) return null;
    const key = getCookieJarKey(containerId, requestDomain);
    let stored;
    try {
      const data = await g.browser.storage.local.get(key);
      stored = data[key];
    } catch(e){}
    if (!stored || !stored.length) {
      // Also try parent domain fallback .dutchycorp.space vs autofaucet.dutchycorp.space
      // Search for any jar that matches this requestDomain ending
      try {
        const all = await g.browser.storage.local.get();
        for (const k of Object.keys(all)) {
          if (k.startsWith(COOKIE_JAR_PREFIX + containerId + "@@")) {
            const jarDomain = k.slice((COOKIE_JAR_PREFIX + containerId + "@@").length);
            if (cookieMatchesDomain(jarDomain, requestDomain) || cookieMatchesDomain(requestDomain, jarDomain)) {
              stored = all[k];
              if (stored && stored.length) break;
            }
          }
        }
      } catch(e){}
    }
    if (!stored || !stored.length) return "";
    // Filter expired
    const now = Date.now()/1000;
    const valid = stored.filter(c => !c.expirationDate || c.expirationDate > now);
    // For request, Cookie header is just name=value; ...
    return valid.map(c => `${c.name}=${c.value}`).join("; ");
  }

  async function saveSetCookieToJar(setCookieValue, requestDomain, containerId) {
    if (!setCookieValue || !requestDomain || !containerId) return;
    const parsed = parseSetCookie(setCookieValue);
    if (!parsed) return;
    // If domain not in cookie, use requestDomain
    if (!parsed.domain) parsed.domain = requestDomain;
    const key = getCookieJarKey(containerId, parsed.domain);
    let stored;
    try {
      const data = await g.browser.storage.local.get({ [key]: [] });
      stored = data[key] || [];
    } catch(e){ stored = []; }
    // Remove existing same name+domain+path
    stored = stored.filter(c => !(c.name === parsed.name && c.domain === parsed.domain && c.path === parsed.path));
    // If value empty and expires in past, treat as deletion - don't add
    if (parsed.value === "" && parsed.expirationDate && parsed.expirationDate < Date.now()/1000) {
      // just removed
    } else {
      stored.push(parsed);
    }
    try { await g.browser.storage.local.set({ [key]: stored }); } catch(e){}
    // Also store under requestDomain for fallback lookup
    if (parsed.domain !== requestDomain) {
      const key2 = getCookieJarKey(containerId, requestDomain);
      try {
        const data2 = await g.browser.storage.local.get({ [key2]: [] });
        let stored2 = data2[key2] || [];
        stored2 = stored2.filter(c => !(c.name === parsed.name && c.domain === parsed.domain && c.path === parsed.path));
        if (!(parsed.value === "" && parsed.expirationDate && parsed.expirationDate < Date.now()/1000)) stored2.push(parsed);
        await g.browser.storage.local.set({ [key2]: stored2 });
      } catch(e){}
    }
  }

  function installHeaderCookieIsolation() {
    try {
      const wr = (g.browser.webRequest || g.chrome.webRequest);
      if (!wr || !wr.onHeadersReceived) return;
      // Observer only - saves Set-Cookie per container to virtual jar
      // No blocking needed, works in MV3
      try {
        wr.onHeadersReceived.addListener(async (details) => {
          try {
            if (details.tabId === -1) return;
            const url = details.url || details.initiator || details.documentUrl || "";
            let domain = getDomainFromUrl(url);
            if (!domain && details.url) {
              try { domain = new URL(details.url).hostname; } catch(e){}
            }
            if (!domain) return;
            const containerId = await getTabContainer(details.tabId);
            if (!containerId || containerId === DEFAULT_CONTAINER_COOKIE_ID) return;
            const headers = details.responseHeaders || [];
            if (!headers || !headers.length) return;
            for (const h of headers) {
              if (h.name && h.name.toLowerCase() === "set-cookie" && h.value) {
                await saveSetCookieToJar(h.value, domain, containerId);
              }
            }
          } catch(e){}
        }, { urls: ["<all_urls>"] }, ["responseHeaders", "extraHeaders"]);
        console.log("Header Cookie observer installed (Set-Cookie capture)");
      } catch(e) { console.log("Header observer not available", e.message); }
    } catch(e){}
  }

  async function swapCookiesForNavigation(tabId, url, targetContainerId) {
    if (!cookieIsolationEnabled) return;
    const domain = getDomainFromUrl(url);
    if (!domain) return;
    const base = getBaseDomain(domain) || domain;
    const currentOwner = domainOwner.get(base);
    if (currentOwner === targetContainerId) return; // already correct
    // Save current browser cookies to previous owner (or to default if first time)
    if (currentOwner) {
      await saveCurrentCookiesToJar(currentOwner, domain);
    } else {
      // No previous owner tracked (fresh worker or first visit) -> browser cookies belong to default (العادي)
      // Save them to default jar so المتصفح العادي لا يخرج من حسابه
      try {
        const existing = await getAllCookiesForDomain(domain);
        if (existing.length) {
          // Only save to default if we are moving away from default to a container
          // Avoid overwriting default jar with container cookies (already handled above)
          const defaultKey = getCookieJarKey(DEFAULT_CONTAINER_COOKIE_ID, domain);
          const data = await g.browser.storage.local.get({ [defaultKey]: null });
          if (!data[defaultKey] || data[defaultKey].length === 0) {
            await saveCurrentCookiesToJar(DEFAULT_CONTAINER_COOKIE_ID, domain);
            console.log(`Saved ${existing.length} cookies to default jar for ${base}`);
          }
        }
      } catch(e){}
    }
    // Restore target's jar — but for default, if its jar empty we keep browser as is (لا نمسح العادي)
    if (targetContainerId === DEFAULT_CONTAINER_COOKIE_ID) {
      const defaultKey = getCookieJarKey(DEFAULT_CONTAINER_COOKIE_ID, domain);
      let stored;
      try { const d = await g.browser.storage.local.get(defaultKey); stored = d[defaultKey]; } catch(e){}
      if (!stored || !stored.length) {
        // Default has no saved jar yet (أول مرة) -> لا نمسح، خلّي كوكيز المتصفح العادي كما هي
        domainOwner.set(base, targetContainerId);
        await persistDomainOwner();
        return;
      }
    }
    await restoreCookiesFromJar(targetContainerId, domain);
    domainOwner.set(base, targetContainerId);
    await persistDomainOwner();
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

    // On navigation committed/beforeNavigate, swap before page loads (earliest)
    const webNav = g.browser.webNavigation || g.chrome.webNavigation;
    if (webNav) {
      if (webNav.onBeforeNavigate) {
        webNav.onBeforeNavigate.addListener(async (details) => {
          if (details.frameId !== 0) return;
          try {
            const containerId = await getTabContainer(details.tabId);
            await swapCookiesForNavigation(details.tabId, details.url, containerId);
          } catch(e) {}
        });
      }
      if (webNav.onCommitted) {
        webNav.onCommitted.addListener(async (details) => {
          if (details.frameId !== 0) return;
          try {
            const containerId = await getTabContainer(details.tabId);
            await swapCookiesForNavigation(details.tabId, details.url, containerId);
          } catch(e) {}
        });
      }
    }
    if (!webNav || (!webNav.onCommitted && !webNav.onBeforeNavigate)) {
      // Fallback: use tabs.onUpdated if webNavigation not available
      if (tabsApi.onUpdated) {
      tabsApi.onUpdated.addListener(async (tabId, changeInfo, tab) => {
        if (!changeInfo.url) return;
        try {
          const containerId = await getTabContainer(tabId);
          await swapCookiesForNavigation(tabId, changeInfo.url, containerId);
        } catch(e){}
      });
      }
    }

    // On tab close, optionally persist its container's cookies for its domain
    if (tabsApi.onRemoved) {
      // No action needed, cookies already saved on swap
    }

    console.log("Brave Cookie Isolation installed");

    // Also install header-based isolation for simultaneous tabs (no global cookie swap needed)
    try { installHeaderCookieIsolation(); } catch(e) { console.error("Header isolation failed", e); }

    // Upgrade to fingerprint isolation on same hooks - delegate to fingerprint manager
    try { installFingerprintIsolation(); } catch(e) { console.error("Fingerprint isolation install failed", e); }
  }

  // --- Fingerprint Isolation (PC-only, persistent, strongest) ---
  // Each container gets a persistent desktop fingerprint (Windows/macOS/Linux only)
  // Injected into MAIN world before any site/extension script via scripting API
  function injectFingerprintInMainWorld(fp, containerId) {
    // This function is serialized and executed in MAIN world - must be self-contained
    // Duplicate of logic in content-script-fingerprint.js for scripting API path
    if (!fp) return;
    try {
      const cid = containerId || fp.containerId || "default";
      const navProps = {
        userAgent: fp.ua,
        appVersion: fp.ua,
        platform: fp.platform,
        vendor: fp.vendor,
        hardwareConcurrency: fp.cpu,
        deviceMemory: fp.memory,
        language: fp.locale,
        webdriver: false
      };
      // languages array
      try { navProps.languages = fp.lang ? fp.lang.split(",").map(s => s.split(";")[0].trim()) : [fp.locale]; } catch(e) {}
      function spoof(obj, prop, value) {
        try { Object.defineProperty(obj, prop, { get(){return value;}, configurable:true }); } catch(e){}
      }
      try {
        const nav = window.navigator;
        for (const k of Object.keys(navProps)) spoof(nav, k, navProps[k]);
        spoof(nav, "oscpu", fp.ua.includes("Windows") ? "Windows NT 10.0; Win64; x64" : (fp.platform==="MacIntel" ? "Intel Mac OS X 10_15_7" : "X11; Linux x86_64"));
        if (fp.secChUa) {
          const ch = { brands:[{brand:"Chromium",version:fp.browserVersion.split(".")[0]},{brand: fp.browser==="Brave"?"Brave":fp.browser==="Edge"?"Microsoft Edge":"Google Chrome",version:fp.browserVersion.split(".")[0]},{brand:"Not-A.Brand",version:"99"}], mobile:false, platform: fp.os==="Windows"?"Windows":(fp.os.includes("Mac")?"macOS":"Linux"), getHighEntropyValues: async()=>({platform:fp.os, platformVersion:fp.osVersion, architecture:"x86",bitness:"64",model:"",uaFullVersion:fp.browserVersion}) };
          spoof(nav, "userAgentData", ch);
        }
        const fakePlugins = { length:5, 0:{name:"PDF Viewer"},1:{name:"Chrome PDF Viewer"},2:{name:"Chromium PDF Viewer"},3:{name:"Microsoft Edge PDF Viewer"},4:{name:"WebKit built-in PDF"}, item:function(i){return this[i];}, namedItem:function(n){for(let i=0;i<this.length;i++) if(this[i].name===n) return this[i]; return null;} };
        spoof(nav, "plugins", fakePlugins);
        const fakeMimeTypes = { length:2, 0:{type:"application/pdf"},1:{type:"text/pdf"}, item:function(i){return this[i];}, namedItem:function(n){return this[n];}};
        spoof(nav, "mimeTypes", fakeMimeTypes);
      } catch(e){}
      try {
        const dims = fp.screen.split("x").map(Number);
        const w=dims[0],h=dims[1];
        const scr=window.screen;
        spoof(scr,"width",w); spoof(scr,"height",h); spoof(scr,"availWidth",w); spoof(scr,"availHeight",h-40); spoof(scr,"colorDepth",fp.colorDepth); spoof(scr,"pixelDepth",fp.colorDepth);
        spoof(window,"devicePixelRatio",fp.pixelRatio||1); spoof(window,"outerWidth",w); spoof(window,"outerHeight",h); spoof(window,"innerWidth",w); spoof(window,"innerHeight",h-80);
      } catch(e){}
      try {
        const seed = typeof fp.canvasSeed==="number" ? fp.canvasSeed : 0.5;
        const origToDataURL = HTMLCanvasElement.prototype.toDataURL;
        const origToBlob = HTMLCanvasElement.prototype.toBlob;
        function addNoiseToCanvas(canvas){ try{ const ctx=canvas.getContext("2d"); if(!ctx) return; const w=canvas.width,h=canvas.height; if(w===0||h===0||w>4096||h>4096) return; if(canvas.__braveNoiseApplied) return; canvas.__braveNoiseApplied=true; try{ const imageData=ctx.getImageData(0,0,w,h); const data=imageData.data; let s=Math.floor(seed*1000000); for(let i=0;i<data.length;i+=4){ if(i%400===0){ s=(s*1664525+1013904223)>>>0; const noise=(s%3)-1; data[i]=Math.max(0,Math.min(255,data[i]+noise)); data[i+1]=Math.max(0,Math.min(255,data[i+1]+noise)); data[i+2]=Math.max(0,Math.min(255,data[i+2]+noise)); } } ctx.putImageData(imageData,0,0);}catch(e){} }catch(e){} }
        HTMLCanvasElement.prototype.toDataURL=function(){ try{addNoiseToCanvas(this);}catch(e){} return origToDataURL.apply(this, arguments); };
        HTMLCanvasElement.prototype.toBlob=function(){ try{addNoiseToCanvas(this);}catch(e){} return origToBlob.apply(this, arguments); };
      } catch(e){}
      try {
        const renderer = fp.renderer || "ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Direct3D11 vs_5_0 ps_5_0)";
        const vendorStr = renderer.includes("Apple") ? "Apple Inc." : (renderer.includes("Intel") ? "Intel" : (renderer.includes("NVIDIA") ? "Google Inc. (NVIDIA)" : "Google Inc."));
        const origGetParam = WebGLRenderingContext.prototype.getParameter;
        WebGLRenderingContext.prototype.getParameter = function(pname){ if(pname===37445) return vendorStr; if(pname===37446) return renderer; return origGetParam.apply(this, arguments); };
        if(typeof WebGL2RenderingContext!=="undefined"){ const origGetParam2=WebGL2RenderingContext.prototype.getParameter; WebGL2RenderingContext.prototype.getParameter=function(pname){ if(pname===37445) return vendorStr; if(pname===37446) return renderer; return origGetParam2.apply(this, arguments); }; }
      } catch(e){}
      try {
        const audioSeed = typeof fp.audioSeed==="number" ? fp.audioSeed : 0.3;
        if(window.AudioBuffer){ const origGetChannelData=AudioBuffer.prototype.getChannelData; AudioBuffer.prototype.getChannelData=function(){ const data=origGetChannelData.apply(this, arguments); try{ let s=Math.floor(audioSeed*1000000); for(let i=0;i<Math.min(data.length,5000);i+=100){ s=(s*1664525+1013904223)>>>0; data[i]+=((s%200)-100)/10000000; } }catch(e){} return data; }; }
      } catch(e){}
      try {
        const tzOffsets={"America/New_York":300,"America/Los_Angeles":480,"America/Chicago":360,"America/Denver":420,"America/Vancouver":480,"America/Mexico_City":360,"America/Sao_Paulo":180,"Europe/London":0,"Europe/Berlin":-60,"Europe/Paris":-60,"Europe/Rome":-60,"Europe/Madrid":-60,"Europe/Amsterdam":-60,"Europe/Stockholm":-60,"Europe/Warsaw":-60,"Europe/Athens":-120,"Europe/Moscow":-180,"Europe/Istanbul":-180,"Europe/Oslo":-60,"Europe/Copenhagen":-60,"Asia/Tokyo":-540,"Asia/Shanghai":-480,"Asia/Dubai":-240,"Asia/Seoul":-540,"Australia/Sydney":-660};
        const offset = tzOffsets[fp.timezone]!==undefined ? tzOffsets[fp.timezone] : new Date().getTimezoneOffset();
        Date.prototype.getTimezoneOffset=function(){ return offset; };
        try{ const origResolved=Intl.DateTimeFormat.prototype.resolvedOptions; Intl.DateTimeFormat.prototype.resolvedOptions=function(){ const res=origResolved.apply(this, arguments); res.timeZone=fp.timezone; res.locale=fp.locale; return res; }; }catch(e){}
      } catch(e){}
      try{ if(navigator.permissions && navigator.permissions.query){ const origQuery=navigator.permissions.query.bind(navigator.permissions); navigator.permissions.query=function(params){ if(params && params.name==="notifications") return Promise.resolve({state:"denied",onchange:null}); return origQuery(params); }; } }catch(e){}
      try{
        const prefix="__c_"+cid.replace(/[^a-zA-Z0-9]/g,"_")+"__";
        if(cid!=="firefox-default" && cid!=="0"){
          const wrapStorage=(storage)=>{ if(!storage||storage.__braveWrapped) return; const origGetItem=storage.getItem.bind(storage); const origSetItem=storage.setItem.bind(storage); const origRemoveItem=storage.removeItem.bind(storage); const origClear=storage.clear.bind(storage); const origKey=storage.key?storage.key.bind(storage):null; storage.getItem=function(k){return origGetItem(prefix+k);}; storage.setItem=function(k,v){return origSetItem(prefix+k,v);}; storage.removeItem=function(k){return origRemoveItem(prefix+k);}; storage.clear=function(){ try{ const toRemove=[]; for(let i=0;i<storage.length;i++){ const key=origKey(i); if(key&&key.startsWith(prefix)) toRemove.push(key); } toRemove.forEach(k=>origRemoveItem(k)); }catch(e){ return origClear(); } }; if(origKey){ storage.key=function(n){ let count=-1; for(let i=0;i<storage.length;i++){ const k=origKey(i); if(k&&k.startsWith(prefix)){ count++; if(count===n) return k.substring(prefix.length); } } return null; }; } Object.defineProperty(storage,"length",{ get(){ let c=0; for(let i=0;i<storage.length;i++){ const k=origKey(i); if(k&&k.startsWith(prefix)) c++; } return c; }, configurable:true }); storage.__braveWrapped=true; };
          wrapStorage(window.localStorage); wrapStorage(window.sessionStorage);
          if(window.indexedDB && window.indexedDB.open){ const origOpen=window.indexedDB.open.bind(window.indexedDB); const origDelete=window.indexedDB.deleteDatabase?window.indexedDB.deleteDatabase.bind(window.indexedDB):null; window.indexedDB.open=function(name,version){ if(typeof name==="string") name=prefix+name; return origOpen(name,version); }; if(origDelete) window.indexedDB.deleteDatabase=function(name){ if(typeof name==="string") name=prefix+name; return origDelete(name); }; }
        }
      }catch(e){}
      try{ Object.defineProperty(window,"__braveContainerFingerprint",{value:fp.deviceId,configurable:true,enumerable:false}); }catch(e){}
    } catch(e) {}
  }

  async function getFingerprintForContainer(containerId) {
    if (!containerId || containerId==="firefox-default" || containerId==="0") return null;
    try {
      // Prefer ContainerVault if loaded
      if (g.ContainerVault && g.ContainerVault.getFingerprint) {
        return await g.ContainerVault.getFingerprint(containerId);
      }
      if (g.FingerprintEngine && g.FingerprintEngine.generateFingerprint) {
        return g.FingerprintEngine.generateFingerprint(containerId);
      }
    } catch(e){}
    return null;
  }

  async function injectFingerprintForTab(tabId, containerId, url) {
    if (!containerId || containerId==="firefox-default") return;
    // Avoid injecting into extension/internal pages
    if (!url || url.startsWith("chrome") || url.startsWith("brave") || url.startsWith("about") || url.startsWith("chrome-extension") || url.startsWith("moz-extension")) return;
    if (url.startsWith("chrome://") || url.startsWith("brave://") || url.startsWith("edge://") || url.startsWith("about:")) return;
    const fp = await getFingerprintForContainer(containerId);
    if (!fp) return;
    // Try chrome.scripting API (preferred - runs in MAIN world before page scripts with injectImmediately)
    try {
      if (g.chrome && g.chrome.scripting && g.chrome.scripting.executeScript) {
        await g.chrome.scripting.executeScript({
          target: { tabId: tabId },
          func: injectFingerprintInMainWorld,
          args: [fp, containerId],
          injectImmediately: true,
          world: "MAIN"
        });
        return;
      }
    } catch(e) {
      // Fallback to browser.scripting
      try {
        if (g.browser && g.browser.scripting && g.browser.scripting.executeScript) {
          await g.browser.scripting.executeScript({
            target: { tabId: tabId },
            func: injectFingerprintInMainWorld,
            args: [fp, containerId],
            injectImmediately: true,
            world: "MAIN"
          });
          return;
        }
      } catch(e2){}
    }
    // Final fallback: send message to content script to inject via DOM
    try {
      if (g.browser && g.browser.tabs && g.browser.tabs.sendMessage) {
        g.browser.tabs.sendMessage(tabId, { braveFingerprint: fp }).catch(()=>{});
      } else if (g.chrome && g.chrome.tabs && g.chrome.tabs.sendMessage) {
        g.chrome.tabs.sendMessage(tabId, { braveFingerprint: fp }, ()=>{});
      }
    } catch(e){}
  }

  function installFingerprintIsolation() {
    // Ensure fingerprints are created for existing containers
    (async () => {
      try {
        const containers = await loadContainers();
        for (const c of containers) {
          try { await getFingerprintForContainer(c.cookieStoreId); } catch(e){}
        }
      } catch(e){}
    })();

    // Hook container lifecycle to manage vault
    contextualIdentitiesPolyfill.onCreated && contextualIdentitiesPolyfill.onCreated.addListener && contextualIdentitiesPolyfill.onCreated.addListener(async (detail) => {
      try { const ci = detail.contextualIdentity || detail; if (ci && ci.cookieStoreId) await getFingerprintForContainer(ci.cookieStoreId); } catch(e){}
    });

    // On remove, clean vault
    const origRemove = contextualIdentitiesPolyfill.remove.bind(contextualIdentitiesPolyfill);
    contextualIdentitiesPolyfill.remove = async function(cookieStoreId) {
      const res = await origRemove(cookieStoreId);
      try {
        if (g.ContainerVault && g.ContainerVault.removeFingerprint) await g.ContainerVault.removeFingerprint(cookieStoreId);
        else if (g.browser && g.browser.storage && g.browser.storage.local) {
          const key = `pcFingerprint@@_${String(cookieStoreId).replace(/[^a-zA-Z0-9_-]/g,'_')}`;
          await g.browser.storage.local.remove(key);
        }
      } catch(e){}
      return res;
    };

    // Message handler for content script to fetch its container's fingerprint
    try {
      const runtime = g.browser.runtime || g.chrome.runtime;
      if (runtime && runtime.onMessage) {
        runtime.onMessage.addListener((message, sender, sendResponse) => {
          if (!message || !message.method) return false;
          if (message.method === "braveGetFingerprint") {
            (async () => {
              try {
                const tabId = sender && sender.tab ? sender.tab.id : null;
                if (tabId == null) { sendResponse(null); return; }
                const containerId = await getTabContainer(tabId);
                const fp = await getFingerprintForContainer(containerId);
                sendResponse(fp || null);
              } catch(e) { sendResponse(null); }
            })();
            return true; // async response
          }
          if (message.method === "braveGetContainerId") {
            (async () => {
              try {
                const tabId = sender && sender.tab ? sender.tab.id : null;
                if (tabId == null) { sendResponse(null); return; }
                const containerId = await getTabContainer(tabId);
                sendResponse({ containerId });
              } catch(e){ sendResponse(null); }
            })();
            return true;
          }
          return false;
        });
      }
    } catch(e){}

    // Inject on navigation - stronger isolation
    const webNav = g.browser.webNavigation || (g.chrome && g.chrome.webNavigation);
    if (webNav && webNav.onCommitted) {
      webNav.onCommitted.addListener(async (details) => {
        if (details.frameId !== 0) return;
        try {
          const containerId = await getTabContainer(details.tabId);
          await swapCookiesForNavigation(details.tabId, details.url, containerId);
          await injectFingerprintForTab(details.tabId, containerId, details.url);
        } catch(e){}
      });
    }
    // Also inject on tab activation (for bfcache / history)
    try {
      const tabsApi = g.browser.tabs || g.chrome.tabs;
      if (tabsApi && tabsApi.onActivated) {
        // Already has handler for cookies, add fingerprint re-inject
        // We patch by adding second listener
        tabsApi.onActivated.addListener(async (activeInfo) => {
          try {
            const tab = await tabsApi.get(activeInfo.tabId);
            if (!tab || !tab.url) return;
            const containerId = await getTabContainer(tab.id);
            await injectFingerprintForTab(tab.id, containerId, tab.url);
          } catch(e){}
        });
      }
    } catch(e){}

    console.log("Brave Fingerprint Isolation (PC 500 persistent) installed");
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
          // Per-container: مسح جرة الحاوية الخاصة (كأن المتصفح جديد)
          if (options && options.cookieStoreId) {
            try { await clearContainerAllData(options.cookieStoreId); } catch(e){}
            return {};
          }
          const clean = {};
          if (options) {
            for (const k of Object.keys(options)) {
              if (k !== "cookieStoreId") clean[k] = options[k];
            }
          }
          try {
            return await origRemoveCookies(clean);
          } catch (e) {
            return {};
          }
        };
      }
      if (origRemoveLocalStorage) {
        g.browser.browsingData.removeLocalStorage = async (options) => {
          if (options && options.cookieStoreId) {
            try {
              const tabs = await (g.browser.tabs.query({ cookieStoreId: options.cookieStoreId }).catch(()=>[]));
              for (const t of tabs || []) {
                try { g.browser.tabs.sendMessage(t.id, { braveClearStorage: true, containerId: options.cookieStoreId }).catch(()=>{}); } catch(e){}
              }
            } catch(e){}
            try { await clearContainerAllData(options.cookieStoreId); } catch(e){}
            return {};
          }
          const clean = {};
          if (options) {
            for (const k of Object.keys(options)) {
              if (k !== "cookieStoreId") clean[k] = options[k];
            }
          }
          try { return await origRemoveLocalStorage(clean); } catch (e) { return {}; }
        };
      } else {
        g.browser.browsingData.removeLocalStorage = async (options) => {
          if (options && options.cookieStoreId) {
            try {
              const tabs = await (g.browser.tabs.query({ cookieStoreId: options.cookieStoreId }).catch(()=>[]));
              for (const t of tabs || []) {
                try { g.browser.tabs.sendMessage(t.id, { braveClearStorage: true, containerId: options.cookieStoreId }).catch(()=>{}); } catch(e){}
              }
            } catch(e){}
            return {};
          }
          return {};
        };
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

  // Expose helpers globally for debugging + reset per-tab
  g.BravePolyfill = {
    installAll,
    loadContainers,
    saveContainers,
    getTabContainer,
    setTabContainer,
    FALLBACK_COLORS,
    FALLBACK_ICONS,
    clearTabContainer,
    clearContainerAllData,
    clearContainerWithFingerprint,
    getCookieJarKey,
    getBaseDomain
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
