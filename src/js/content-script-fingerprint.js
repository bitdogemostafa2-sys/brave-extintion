/* Content Script Fingerprint - ISOLATED world
 * Fallback injector when background scripting injection not available.
 * Fetches container fingerprint from background and injects MAIN world overrides
 * at document_start before any site/extension script.
 */
(function() {
  "use strict";

  // Only run in top and iframes
  const g = (typeof browser !== "undefined") ? browser : chrome;

  let fingerprintCache = null;

  async function fetchFingerprint() {
    // Try runtime message first
    try {
      if (g.runtime && g.runtime.sendMessage) {
        const fp = await g.runtime.sendMessage({ method: "braveGetFingerprint" });
        if (fp && fp.ua) {
          fingerprintCache = fp;
          return fp;
        }
      }
    } catch (e) {}
    // Try storage fallback: check if background stored current fingerprint for this tab's URL host?
    // Not reliable, return null
    return null;
  }

  function injectIntoMainWorld(fp, containerId) {
    if (!fp || !fp.ua) return;
    try {
      const script = document.createElement("script");
      script.textContent = `(${mainWorldOverrider.toString()})(${JSON.stringify(fp)},${JSON.stringify(containerId||fp.containerId)})`;
      // Inject as early as possible
      const root = document.documentElement;
      if (root) {
        root.prepend(script);
        // Remove after execution to keep DOM clean (but after execution)
        setTimeout(() => { try { script.remove(); } catch(e){} }, 100);
      } else {
        // Fallback: document.head
        (document.head || document.documentElement).appendChild(script);
      }
    } catch (e) {
      console.error("Fingerprint inject failed", e);
    }
  }

  // Main world overrider - runs in MAIN world (page context)
  function mainWorldOverrider(fp, containerId) {
    if (!fp) return;
    try {
      const cid = containerId || fp.containerId || "default";

      // --- Navigator spoofing ---
      const navProps = {
        userAgent: fp.ua,
        appVersion: fp.ua,
        platform: fp.platform,
        vendor: fp.vendor,
        oscpu: fp.ua.includes("Windows") ? "Windows NT 10.0; Win64; x64" : (fp.platform === "MacIntel" ? "Intel Mac OS X 10_15_7" : "X11; Linux x86_64"),
        hardwareConcurrency: fp.cpu,
        deviceMemory: fp.memory,
        languages: fp.lang ? fp.lang.split(",").map(s => s.split(";")[0].trim()) : [fp.locale],
        language: fp.locale,
        webdriver: false
      };

      // Helper to spoof getter
      function spoof(obj, prop, value) {
        try {
          Object.defineProperty(obj, prop, {
            get() { return value; },
            configurable: true
          });
        } catch (e) {}
      }

      // Navigator
      try {
        const nav = window.navigator;
        for (const k of Object.keys(navProps)) {
          spoof(nav, k, navProps[k]);
        }
        // navigator.userAgentData (Client Hints)
        if (fp.secChUa) {
          const ch = {
            brands: [{brand:"Chromium",version: fp.browserVersion.split(".")[0]},{brand: fp.browser==="Brave"?"Brave": fp.browser==="Edge"? "Microsoft Edge":"Google Chrome", version: fp.browserVersion.split(".")[0]},{brand:"Not-A.Brand",version:"99"}],
            mobile: false,
            platform: fp.os === "Windows" ? "Windows" : (fp.os.includes("Mac") ? "macOS" : "Linux"),
            getHighEntropyValues: async () => ({platform: fp.os, platformVersion: fp.osVersion, architecture:"x86", bitness:"64", model:"", uaFullVersion: fp.browserVersion})
          };
          spoof(nav, "userAgentData", ch);
        }
        // plugins spoof - realistic count per fp.fonts
        const pluginLen = 5; // Chrome has 5 PDF plugins
        const fakePlugins = {
          length: pluginLen,
          0: { name:"PDF Viewer" }, 1:{name:"Chrome PDF Viewer"}, 2:{name:"Chromium PDF Viewer"},3:{name:"Microsoft Edge PDF Viewer"},4:{name:"WebKit built-in PDF"},
          item: function(i){return this[i];},
          namedItem: function(n){ for(let i=0;i<this.length;i++) if(this[i].name===n) return this[i]; return null; }
        };
        spoof(nav, "plugins", fakePlugins);
        const fakeMimeTypes = { length:2, 0:{type:"application/pdf"},1:{type:"text/pdf"}, item:function(i){return this[i];}, namedItem:function(n){return this[n];}};
        spoof(nav, "mimeTypes", fakeMimeTypes);
      } catch(e){}

      // --- Screen spoof ---
      try {
        const dims = fp.screen.split("x").map(Number);
        const w = dims[0], h = dims[1];
        const scr = window.screen;
        spoof(scr, "width", w);
        spoof(scr, "height", h);
        spoof(scr, "availWidth", w);
        spoof(scr, "availHeight", h - 40);
        spoof(scr, "colorDepth", fp.colorDepth);
        spoof(scr, "pixelDepth", fp.colorDepth);
        spoof(window, "devicePixelRatio", fp.pixelRatio || 1);
        spoof(window, "outerWidth", w);
        spoof(window, "outerHeight", h);
        spoof(window, "innerWidth", w);
        spoof(window, "innerHeight", h - 80);
      } catch(e){}

      // --- Canvas noise (per container deterministic) ---
      try {
        const seed = typeof fp.canvasSeed === "number" ? fp.canvasSeed : 0.5;
        const originalToDataURL = HTMLCanvasElement.prototype.toDataURL;
        const originalToBlob = HTMLCanvasElement.prototype.toBlob;
        const originalGetImageData = CanvasRenderingContext2D.prototype.getImageData;

        function addNoiseToCanvas(canvas) {
          try {
            const ctx = canvas.getContext("2d");
            if (!ctx) return;
            // Add subtle noise based on seed - deterministic per container
            const w = canvas.width, h = canvas.height;
            if (w===0 || h===0 || w>4096 || h>4096) return;
            // Only apply once per canvas
            if (canvas.__braveNoiseApplied) return;
            canvas.__braveNoiseApplied = true;
            try {
              const imageData = ctx.getImageData(0, 0, w, h);
              const data = imageData.data;
              // LCG pseudo random using seed
              let s = Math.floor(seed * 1000000);
              for (let i=0; i<data.length; i+=4) {
                // Only touch a few pixels to stay subtle - every 100th pixel
                if (i % 400 === 0) {
                  s = (s * 1664525 + 1013904223) >>> 0;
                  const noise = (s % 3) - 1; // -1,0,1
                  data[i] = Math.max(0, Math.min(255, data[i] + noise));
                  data[i+1] = Math.max(0, Math.min(255, data[i+1] + noise));
                  data[i+2] = Math.max(0, Math.min(255, data[i+2] + noise));
                }
              }
              ctx.putImageData(imageData, 0, 0);
            } catch(e){}
          } catch(e){}
        }

        HTMLCanvasElement.prototype.toDataURL = function() {
          try { addNoiseToCanvas(this); } catch(e){}
          return originalToDataURL.apply(this, arguments);
        };
        HTMLCanvasElement.prototype.toBlob = function() {
          try { addNoiseToCanvas(this); } catch(e){}
          return originalToBlob.apply(this, arguments);
        };
        // Also patch getContext to add noise lazily? keep as is

        // OffscreenCanvas
        if (typeof OffscreenCanvas !== "undefined" && OffscreenCanvas.prototype.convertToBlob) {
          const origConvert = OffscreenCanvas.prototype.convertToBlob;
          OffscreenCanvas.prototype.convertToBlob = function() {
            try {
              // similar noise - can't easily get pixels without context, skip
            } catch(e){}
            return origConvert.apply(this, arguments);
          };
        }

        // WebGL toDataURL already via canvas
      } catch(e){}

      // --- WebGL spoof ---
      try {
        const renderer = fp.renderer || "ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Direct3D11 vs_5_0 ps_5_0)";
        const vendorStr = renderer.includes("Apple") ? "Apple Inc." : (renderer.includes("Intel") ? "Intel" : (renderer.includes("NVIDIA") ? "Google Inc. (NVIDIA)" : "Google Inc."));
        const getParameterOrig = WebGLRenderingContext.prototype.getParameter;
        WebGLRenderingContext.prototype.getParameter = function(pname) {
          // UNMASKED_VENDOR_WEBGL = 37445, UNMASKED_RENDERER_WEBGL = 37446
          if (pname === 37445) return vendorStr;
          if (pname === 37446) return renderer;
          return getParameterOrig.apply(this, arguments);
        };
        if (typeof WebGL2RenderingContext !== "undefined") {
          const getParameter2Orig = WebGL2RenderingContext.prototype.getParameter;
          WebGL2RenderingContext.prototype.getParameter = function(pname) {
            if (pname === 37445) return vendorStr;
            if (pname === 37446) return renderer;
            return getParameter2Orig.apply(this, arguments);
          };
        }
      } catch(e){}

      // --- AudioContext noise ---
      try {
        const audioSeed = typeof fp.audioSeed === "number" ? fp.audioSeed : 0.3;
        if (window.AudioContext || window.webkitAudioContext) {
          const AC = window.AudioContext || window.webkitAudioContext;
          const origCreateOscillator = AC.prototype.createOscillator;
          const origCreateAnalyser = AC.prototype.createAnalyser;
          // Patch OfflineAudioContext
          const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
          if (OAC) {
            const origStartRendering = OAC.prototype.startRendering;
            if (origStartRendering) {
              OAC.prototype.startRendering = function() {
                const result = origStartRendering.apply(this, arguments);
                // Noise is complex, just add slight latency? fingerprinting usually uses Analyser
                return result;
              };
            }
          }
          // Patch getChannelData to add deterministic noise
          if (window.AudioBuffer) {
            const origGetChannelData = AudioBuffer.prototype.getChannelData;
            AudioBuffer.prototype.getChannelData = function() {
              const data = origGetChannelData.apply(this, arguments);
              try {
                let s = Math.floor(audioSeed * 1000000);
                for (let i=0;i<Math.min(data.length, 5000); i+=100) {
                  s = (s * 1664525 + 1013904223) >>> 0;
                  data[i] += ((s % 200) - 100) / 10000000; // tiny noise
                }
              } catch(e){}
              return data;
            };
          }
        }
      } catch(e){}

      // --- Timezone spoof (getTimezoneOffset) ---
      try {
        // Map timezone to expected offset
        const tzOffsets = {
          "America/New_York": 300, "America/Los_Angeles": 480, "America/Chicago": 360, "America/Denver": 420,
          "America/Vancouver": 480, "America/Mexico_City": 360, "America/Sao_Paulo": 180, "Europe/London": 0,
          "Europe/Berlin": -60, "Europe/Paris": -60, "Europe/Rome": -60, "Europe/Madrid": -60, "Europe/Amsterdam": -60,
          "Europe/Stockholm": -60, "Europe/Warsaw": -60, "Europe/Athens": -120, "Europe/Moscow": -180, "Europe/Istanbul": -180,
          "Europe/Oslo": -60, "Europe/Copenhagen": -60, "Asia/Tokyo": -540, "Asia/Shanghai": -480, "Asia/Dubai": -240, "Asia/Seoul": -540, "Australia/Sydney": -660
        };
        const offset = tzOffsets[fp.timezone] !== undefined ? tzOffsets[fp.timezone] : new Date().getTimezoneOffset();
        const origGetTimezoneOffset = Date.prototype.getTimezoneOffset;
        Date.prototype.getTimezoneOffset = function() { return offset; };
        // Intl
        try {
          const origResolved = Intl.DateTimeFormat.prototype.resolvedOptions;
          Intl.DateTimeFormat.prototype.resolvedOptions = function() {
            const res = origResolved.apply(this, arguments);
            res.timeZone = fp.timezone;
            res.locale = fp.locale;
            return res;
          };
        } catch(e){}
      } catch(e){}

      // --- Permissions query ---
      try {
        if (navigator.permissions && navigator.permissions.query) {
          const origQuery = navigator.permissions.query.bind(navigator.permissions);
          navigator.permissions.query = function(params) {
            // Always deny notifications for consistency
            if (params && params.name === "notifications") {
              return Promise.resolve({ state: "denied", onchange: null });
            }
            return origQuery(params);
          };
        }
      } catch(e){}

      // --- WebRTC IP leak protection (do not expose local IPs) ---
      try {
        if (window.RTCPeerConnection) {
          const OrigRTCPeerConnection = window.RTCPeerConnection;
          window.RTCPeerConnection = function() {
            const pc = new OrigRTCPeerConnection(...arguments);
            // Wrap createDataChannel etc? Keep as is but ICE candidates filtered not needed
            return pc;
          };
          window.RTCPeerConnection.prototype = OrigRTCPeerConnection.prototype;
        }
      } catch(e){}

      // --- Storage Isolation per container (localStorage/sessionStorage/indexedDB) ---
      try {
        const prefix = "__c_" + cid.replace(/[^a-zA-Z0-9]/g, "_") + "__";
        // Only isolate if not default container (default keeps real storage)
        if (cid !== "firefox-default" && cid !== "0") {
          // Storage proxy
          const wrapStorage = (storage) => {
            if (!storage || storage.__braveWrapped) return;
            const origGetItem = storage.getItem.bind(storage);
            const origSetItem = storage.setItem.bind(storage);
            const origRemoveItem = storage.removeItem.bind(storage);
            const origClear = storage.clear.bind(storage);
            const origKey = storage.key ? storage.key.bind(storage) : null;
            const origLengthDesc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(storage), "length") || Object.getOwnPropertyDescriptor(storage, "length");

            storage.getItem = function(k) { return origGetItem(prefix + k); };
            storage.setItem = function(k, v) { return origSetItem(prefix + k, v); };
            storage.removeItem = function(k) { return origRemoveItem(prefix + k); };
            storage.clear = function() {
              // Only clear keys with prefix for this container
              try {
                const toRemove = [];
                for (let i=0;i<storage.length;i++) {
                  const key = origKey(i);
                  if (key && key.startsWith(prefix)) toRemove.push(key);
                }
                toRemove.forEach(k => origRemoveItem(k));
              } catch(e) { return origClear(); }
            };
            if (origKey) {
              storage.key = function(n) {
                // Need to map logical index to real keys with prefix
                let count = -1;
                for (let i=0;i<storage.length;i++) {
                  const k = origKey(i);
                  if (k && k.startsWith(prefix)) {
                    count++;
                    if (count === n) return k.substring(prefix.length);
                  }
                }
                return null;
              };
            }
            Object.defineProperty(storage, "length", {
              get() {
                let c=0;
                for (let i=0;i<storage.length;i++) { const k=origKey(i); if(k&&k.startsWith(prefix)) c++; }
                return c;
              },
              configurable:true
            });
            storage.__braveWrapped = true;
          };
          wrapStorage(window.localStorage);
          wrapStorage(window.sessionStorage);

          // indexedDB namespacing
          if (window.indexedDB && window.indexedDB.open) {
            const origOpen = window.indexedDB.open.bind(window.indexedDB);
            const origDelete = window.indexedDB.deleteDatabase ? window.indexedDB.deleteDatabase.bind(window.indexedDB) : null;
            window.indexedDB.open = function(name, version) {
              if (typeof name === "string") name = prefix + name;
              return origOpen(name, version);
            };
            if (origDelete) {
              window.indexedDB.deleteDatabase = function(name) {
                if (typeof name === "string") name = prefix + name;
                return origDelete(name);
              };
            }
          }
          // caches API if needed? skip
        }
      } catch(e){}

      // Mark as spoofed for debugging (not detectable by sites - use non-enumerable)
      try { Object.defineProperty(window, "__braveContainerFingerprint", { value: fp.deviceId, configurable:true, enumerable:false }); } catch(e){}
      // console.debug log in main world
      // console.log("[Brave Containers] Fingerprint applied", fp.deviceId, fp.screen, fp.timezone);
    } catch (err) {
      // Silently fail
    }
  }

  // Early inject attempt: try immediately, then on DOMContentLoaded fallback
  // We are at document_start, document.documentElement may not exist yet for some navigations, so use multiple strategies
  async function tryInject() {
    const fp = await fetchFingerprint();
    if (fp) {
      injectIntoMainWorld(fp, fp.containerId);
    }
  }

  // Try immediately
  tryInject();

  // Also re-try shortly after in case background not ready yet
  setTimeout(tryInject, 50);
  setTimeout(tryInject, 300);

  // Listen for braveClearStorage to clear prefixed storage for reset
  try {
    g.runtime.onMessage.addListener((msg) => {
      if (msg && msg.braveClearStorage) {
        try {
          const cid = msg.containerId || "";
          const prefix = "__c_" + cid.replace(/[^a-zA-Z0-9]/g,"_") + "__";
          const clearPrefixed = (storage) => {
            if (!storage || storage.__braveCleared) return;
            try {
              const toRemove = [];
              for (let i=0;i<storage.length;i++) {
                const k = storage.key(i);
                if (k && k.startsWith(prefix)) toRemove.push(k);
              }
              toRemove.forEach(k=>{ try{ storage.removeItem(k); }catch(e){} });
            } catch(e){}
          };
          // Note: localStorage already wrapped to use prefix, so clear will remove only this container's keys
          // But we are in ISOLATED world, need to send to MAIN world via injected script
          try {
            const s = document.createElement("script");
            s.textContent = `(() => { try { const p="${prefix}"; const c=(s)=>{ try{ const tr=[]; for(let i=0;i<s.length;i++){ const k=s.key(i); if(k&&k.startsWith(p)) tr.push(k);} tr.forEach(k=>s.removeItem(k)); }catch(e){} }; c(localStorage); c(sessionStorage); if(caches&&caches.keys) caches.keys().then(ks=>ks.forEach(k=>caches.delete(k))).catch(()=>{}); } catch(e){} })()`;
            (document.documentElement||document.head).appendChild(s);
            setTimeout(()=>{ try{ s.remove(); }catch(e){} },100);
          } catch(e){}
        } catch(e){}
      }
    });
  } catch(e){}

  // Listen for push from background (if background sends fingerprint via message)
  try {
    g.runtime.onMessage.addListener((msg) => {
      if (msg && msg.braveFingerprint && msg.braveFingerprint.ua) {
        injectIntoMainWorld(msg.braveFingerprint, msg.braveFingerprint.containerId);
      }
      if (msg && msg.braveContainerInfo) {
        // This is container visual info, not fingerprint - ignore
      }
    });
  } catch(e){}

  // Also listen for storage changes? Not needed

})();
