// The saved connection is device-local, separate from album drafts and shell caches.
// Encryption at rest does not protect against malicious code running on this origin.
export function deviceStore(index = indexedDB) {
  return async (action, value) => {
    const database = await new Promise((resolve, reject) => {
      const request = index.open('hyper-gallery-connection', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('connection');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise((resolve, reject) => {
        const tx = database.transaction('connection', action === 'get' ? 'readonly' : 'readwrite');
        const store = tx.objectStore('connection');
        const request = action === 'get' ? store.get('current') : action === 'put' ? store.put(value, 'current') : store.delete('current');
        let result;
        request.onsuccess = () => result = request.result;
        tx.oncomplete = () => resolve(result);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || Error('无法保存此设备的连接'));
      });
    } finally { database.close(); }
  };
}
export function connectionVault(store = deviceStore(), webCrypto = crypto) {
  return {
    async save(token) {
      const key = await webCrypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
      const iv = webCrypto.getRandomValues(new Uint8Array(12));
      const ciphertext = await webCrypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(token));
      await store('put', { key, iv, ciphertext });
    },
    async read() {
      const record = await store('get');
      if (!record) return null;
      const plaintext = await webCrypto.subtle.decrypt({ name: 'AES-GCM', iv: record.iv }, record.key, record.ciphertext);
      return new TextDecoder().decode(plaintext);
    },
    clear() { return store('delete'); },
  };
}
