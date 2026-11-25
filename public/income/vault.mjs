import { validateState } from './model.mjs';
export const encode = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
export function decode(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]*$/.test(value)) throw new Error('Invalid encrypted data.');
  return Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0));
}
function encodeLarge(bytes) {
  const arr = new Uint8Array(bytes);
  let text = '';
  for (let i = 0; i < arr.length; i += 8192) text += String.fromCharCode(...arr.subarray(i, i + 8192));
  return btoa(text).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}
export async function deriveKey(secret, salt) {
  const material = await crypto.subtle.importKey('raw', secret, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: decode(salt), info: new TextEncoder().encode('income/1') }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
export async function seal(state, key) {
  validateState(state);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const bytes = new TextEncoder().encode(JSON.stringify(state));
  const result = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode('income/1') }, key, bytes);
  bytes.fill(0);
  return { '0': 1, '1': encode(iv), '2': encodeLarge(result) };
}
export async function open(box, key) {
  if (!box || box['0'] !== 1 || Object.keys(box).length !== 3 || decode(box['1']).length !== 12 || box['2'].length > 3_000_000) throw new Error('Invalid encrypted data.');
  const bytes = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decode(box['1']), additionalData: new TextEncoder().encode('income/1') }, key, decode(box['2']));
  try { return validateState(JSON.parse(new TextDecoder().decode(bytes))); }
  finally { new Uint8Array(bytes).fill(0); }
}
export function passkeyJSON(credential) {
  const response = credential.response;
  const result = { id: credential.id, rawId: encode(credential.rawId), type: credential.type, authenticatorAttachment: credential.authenticatorAttachment, clientExtensionResults: {}, response: { clientDataJSON: encode(response.clientDataJSON) } };
  if (response.attestationObject) {
    result.response.attestationObject = encode(response.attestationObject);
    result.response.transports = response.getTransports();
  } else {
    result.response.authenticatorData = encode(response.authenticatorData);
    result.response.signature = encode(response.signature);
    result.response.userHandle = response.userHandle ? encode(response.userHandle) : null;
  }
  return result;
}
export function creationOptions(options, salt) {
  return { ...options, challenge: decode(options.challenge), user: { ...options.user, id: decode(options.user.id) }, excludeCredentials: (options.excludeCredentials || []).map(c => ({ ...c, id: decode(c.id) })), authenticatorSelection: { ...options.authenticatorSelection, residentKey: 'required', userVerification: 'required' }, extensions: { prf: { eval: { first: decode(salt) } } } };
}
export function requestOptions(options, salt) {
  return { ...options, challenge: decode(options.challenge), allowCredentials: (options.allowCredentials || []).map(c => ({ ...c, id: decode(c.id) })), userVerification: 'required', extensions: { prf: { eval: { first: decode(salt) } } } };
}
export async function api(origin, path, token, body, method) {
  const response = await fetch(`${origin}${path}`, { method: method || (body === undefined ? 'GET' : 'POST'), cache: 'no-store', credentials: 'omit', headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), redirect: 'error' });
  const result = await response.json();
  if (!response.ok) {
    const error = new Error(response.status === 409 ? 'Changes were published from another device. Reload before publishing.' : response.status === 401 ? 'Your session has expired. Sign in again.' : 'Request failed. Your changes have not been published.');
    error.status = response.status; throw error;
  }
  return result;
}
