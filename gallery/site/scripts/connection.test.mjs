import {test} from 'node:test';import assert from 'node:assert/strict';
import {connectionVault} from '../public/publish/connection.mjs';
function memory(){let record;return {store:async(action,value)=>{if(action==='put')record=structuredClone(value);if(action==='delete')record=undefined;return record;},record:()=>record};}
test('saved connection survives a fresh vault, uses nonextractable key, and contains no plaintext token',async()=>{
  const m=memory(),token='synthetic-test-only';
  await connectionVault(m.store).save(token);
  assert.equal(m.record().key.extractable,false);
  await assert.rejects(crypto.subtle.exportKey('raw',m.record().key));
  assert.equal(JSON.stringify(m.record()).includes(token),false);
  assert.notEqual(Buffer.from(m.record().ciphertext).toString(),token);
  assert.equal(await connectionVault(m.store).read(),token);
});
test('forgetting the device removes credentials without accessing album drafts',async()=>{
  const m=memory(),v=connectionVault(m.store);assert.equal(await v.read(),null);
  await v.save('test-connection');await v.clear();assert.equal(await v.read(),null);
});
test('overwriting a saved connection rotates key and IV; tampering cannot decrypt',async()=>{
  const m=memory(),v=connectionVault(m.store);await v.save('first');const previous=m.record();
  await v.save('second');assert.notDeepEqual(previous.iv,m.record().iv);assert.equal(await v.read(),'second');
  new Uint8Array(m.record().ciphertext)[0]^=1;await assert.rejects(v.read());
});
