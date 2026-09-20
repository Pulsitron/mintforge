import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Wallet } from 'ethers';
import { env } from 'cloudflare:workers';
const sqlite=new DatabaseSync(':memory:');sqlite.exec(fs.readFileSync('drizzle/0000_peaceful_avengers.sql','utf8').replaceAll('--> statement-breakpoint',''));
function prepared(sql,args=[]){return {bind(...values){return prepared(sql,values);},async first(){return sqlite.prepare(sql).get(...args)||null;},async run(){return {success:true,meta:sqlite.prepare(sql).run(...args)};}};}
env.DB={prepare:prepared,async batch(statements){return Promise.all(statements.map(s=>s.run()));}};
env.PINATA_JWT='local-test-only';
const {default:worker}=await import('../dist/server/index.js');
const ctx={waitUntil(){},passThroughOnException(){}};
function post(body,origin='https://mintforge.example'){return worker.fetch(new Request('https://mintforge.example/api/upload-auth',{method:'POST',headers:{'Content-Type':'application/json',Origin:origin},body:JSON.stringify(body)}),{ASSETS:{fetch:()=>new Response('',{status:404})}},ctx);}
await test('upload authentication rejects cross-origin and oversized requests',async()=>{
 let response=await post({wallet:Wallet.createRandom().address},'https://attacker.example');assert.equal(response.status,400);assert.match((await response.json()).error,/origin/i);
 response=await post({wallet:'x'.repeat(6000)});assert.equal(response.status,400);assert.match((await response.json()).error,/large/i);
});
await test('signature must match the requested wallet and nonce is one-use',async()=>{
 const wallet=Wallet.createRandom(),other=Wallet.createRandom();const first=await post({wallet:wallet.address});assert.equal(first.status,200);const challenge=await first.json();
 const wrong=await post({wallet:wallet.address,nonce:challenge.nonce,signature:await other.signMessage(challenge.message)});assert.equal(wrong.status,400);
 const signature=await wallet.signMessage(challenge.message);const ok=await post({wallet:wallet.address,nonce:challenge.nonce,signature});assert.equal(ok.status,200);const cookie=ok.headers.get('set-cookie');assert.match(cookie,/HttpOnly/);assert.match(cookie,/SameSite=Strict/);assert.match(cookie,/Secure/);
 const again=await post({wallet:wallet.address,nonce:challenge.nonce,signature});assert.equal(again.status,400);assert.equal(sqlite.prepare('SELECT count(*) AS count FROM upload_sessions').get().count,1);
});
await test('closed creator testing honors the configured wallet allowlist',async()=>{
 env.UPLOAD_ALLOWED_WALLETS=Wallet.createRandom().address;const response=await post({wallet:Wallet.createRandom().address});assert.equal(response.status,400);assert.match((await response.json()).error,/not enabled/);delete env.UPLOAD_ALLOWED_WALLETS;
});
await test('quota upserts enforce the byte ceiling without read-then-write races',async()=>{
 const sql='INSERT INTO upload_quota(bucket,used) SELECT ?,? WHERE ? <= ? ON CONFLICT(bucket) DO UPDATE SET used=upload_quota.used+excluded.used WHERE upload_quota.used+excluded.used<=? RETURNING used';
 assert.equal(sqlite.prepare(sql).get('quota-test',70,70,100,100).used,70);assert.equal(sqlite.prepare(sql).get('quota-test',31,31,100,100),undefined);assert.equal(sqlite.prepare(sql).get('quota-test',30,30,100,100).used,100);assert.equal(sqlite.prepare(sql).get('quota-test',1,1,100,100),undefined);
});
sqlite.close();
