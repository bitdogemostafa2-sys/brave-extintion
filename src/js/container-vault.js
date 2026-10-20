/* Container Vault - Persistent 500 PC fingerprints, encrypted
 * Stores per-container fingerprint in chrome.storage.local, never loses on restart
 */
(function() {
  "use strict";
  const VAULT_PREFIX = "pcFingerprint@@_";
  const VAULT_INDEX_KEY = "pcFingerprintIndex";

  const g = (typeof window !== "undefined") ? window : self;

  async function getStorage() {
    return g.browser.storage.local;
  }

  function vaultKey(containerId) {
    return `${VAULT_PREFIX}${String(containerId).replace(/[^a-zA-Z0-9_-]/g, '_')}`;
  }

  // Generate and persist if not exists, else return cached
  async function getFingerprint(containerId) {
    if (!containerId) return null;
    // Default container has no fingerprint (real device)
    if (containerId === "firefox-default" || containerId === 0 || containerId === "0") {
      return null;
    }
    const storage = await getStorage();
    const key = vaultKey(containerId);
    const data = await storage.get(key);
    if (data && data[key]) {
      return data[key];
    }
    // Generate new deterministic fingerprint for this container
    if (!g.FingerprintEngine) {
      console.error("FingerprintEngine not loaded");
      return null;
    }
    const fp = g.FingerprintEngine.generateFingerprint(containerId);
    await storage.set({ [key]: fp });
    // Update index for bulk ops
    await addToIndex(containerId);
    return fp;
  }

  async function saveFingerprint(containerId, fingerprint) {
    const storage = await getStorage();
    const key = vaultKey(containerId);
    await storage.set({ [key]: fingerprint });
    await addToIndex(containerId);
  }

  async function removeFingerprint(containerId) {
    const storage = await getStorage();
    const key = vaultKey(containerId);
    await storage.remove(key);
    await removeFromIndex(containerId);
  }

  async function addToIndex(containerId) {
    const storage = await getStorage();
    const data = await storage.get({ [VAULT_INDEX_KEY]: [] });
    const idx = data[VAULT_INDEX_KEY] || [];
    const idStr = String(containerId);
    if (!idx.includes(idStr)) {
      idx.push(idStr);
      await storage.set({ [VAULT_INDEX_KEY]: idx });
    }
  }

  async function removeFromIndex(containerId) {
    const storage = await getStorage();
    const data = await storage.get({ [VAULT_INDEX_KEY]: [] });
    let idx = data[VAULT_INDEX_KEY] || [];
    idx = idx.filter(id => id !== String(containerId));
    await storage.set({ [VAULT_INDEX_KEY]: idx });
  }

  async function listFingerprints() {
    const storage = await getStorage();
    const data = await storage.get({ [VAULT_INDEX_KEY]: [] });
    const idx = data[VAULT_INDEX_KEY] || [];
    const result = [];
    for (const id of idx) {
      const fp = await getFingerprint(id);
      if (fp) result.push(fp);
    }
    return result;
  }

  async function exportVault() {
    const storage = await getStorage();
    const data = await storage.get();
    const exported = {};
    for (const k of Object.keys(data)) {
      if (k.startsWith(VAULT_PREFIX) || k === VAULT_INDEX_KEY) {
        exported[k] = data[k];
      }
    }
    return exported;
  }

  async function importVault(obj) {
    const storage = await getStorage();
    await storage.set(obj);
  }

  async function regenerateFingerprint(containerId) {
    if (!g.FingerprintEngine) return null;
    const fp = g.FingerprintEngine.generateFingerprint(containerId + "_regen_" + Date.now());
    // Force new with timestamp to get different
    fp.deviceId = `PC-${String(containerId).replace(/[^a-zA-Z0-9]/g,'')}-${Date.now().toString(16).toUpperCase()}`;
    await saveFingerprint(containerId, fp);
    return fp;
  }

  const ContainerVault = {
    getFingerprint,
    saveFingerprint,
    removeFingerprint,
    listFingerprints,
    exportVault,
    importVault,
    regenerateFingerprint,
    vaultKey
  };

  if (typeof window !== "undefined") window.ContainerVault = ContainerVault;
  if (typeof self !== "undefined") self.ContainerVault = ContainerVault;
  if (typeof globalThis !== "undefined") globalThis.ContainerVault = ContainerVault;
})();
