import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../app.js',import.meta.url),'utf8');
const functions=source.slice(source.indexOf('function totalMedicosFromPayload'),source.indexOf('function renderMedicosHabitantesKPI'));
const density=source.slice(source.indexOf('function medDensity('),source.indexOf('function medMapByCbo'));
function context(getJSON) {const c=vm.createContext({getJSON});vm.runInContext(functions+density,c);return c;}
test('real snapshots have unique totals independent of overlapping CBOs and correct densities',async()=>{
 const c=context(async path=>JSON.parse(fs.readFileSync(new URL('..'+path,import.meta.url))));
 for(const [id,total,pop] of [['4316808',1179,133230],['4305108',2618,463501],['4314902',14794,1332845]]){
   const d=await c.fetchMedicosByIbgeWithFallback(id);
   assert.equal(d.comp,'202609');assert.equal(c.totalMedicosFromPayload(d),total);
   assert.ok(d.especialidades.reduce((s,r)=>s+r.medicos,0)>total);
   assert.equal(c.medDensity(total,pop),total/pop*10000);
 }
 assert.equal(c.totalMedicosFromPayload({especialidades:[{medicos:3},{medicos:4}]}),null);
 assert.equal(c.medDensity(null,100),null);
 assert.equal(c.medDensity(0,100),0);
 assert.equal(c.medDensity(3,0),null);
 assert.ok(await c.fetchMedicosByIbgeWithFallback('4205407'));
 assert.equal(await c.fetchMedicosByIbgeWithFallback('3550308'),null);
});
test('concurrent fetches share snapshot and unavailable data is retriable, never zero',async()=>{
 let calls=0;
 const c=context(async()=>{calls++;throw Error('offline');});
 const values=await Promise.all([c.fetchMedicosByIbgeWithFallback('4316808'),c.fetchMedicosByIbgeWithFallback('4314902')]);
 assert.deepEqual(values,[null,null]);assert.equal(calls,1);
 await c.fetchMedicosByIbgeWithFallback('4316808');assert.equal(calls,2);
});
