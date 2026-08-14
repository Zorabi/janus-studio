import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ConnectionProfile, QueryRequest } from "../../packages/domain/src/index.ts";
import { DataQualityService } from "../../apps/desktop/src/main/services/data-quality-service.ts";
import { BackgroundTaskRepository } from "../../apps/desktop/src/main/storage/background-task-repository.ts";
import { openApplicationDatabase } from "../../apps/desktop/src/main/storage/database.ts";
import { QualityRepository } from "../../apps/desktop/src/main/storage/quality-repository.ts";
import type { ConnectionService } from "../../apps/desktop/src/main/services/connection-service.ts";
import type { QueryService } from "../../apps/desktop/src/main/services/query-service.ts";
import type { FileService } from "../../apps/desktop/src/main/services/file-service.ts";

const delay = (ms:number)=>new Promise((resolve)=>setTimeout(resolve,ms));
async function terminal(repository:QualityRepository,id:string){for(let i=0;i<100;i++){const run=repository.getRun(id)!;if(!["running","cancel_requested"].includes(run.status))return run;await delay(10);}throw new Error("quality run did not finish");}

function profile(id:string, protocol:ConnectionProfile["protocol"]="ws", clientMode:ConnectionProfile["clientMode"]="sessioned", environment:ConnectionProfile["environment"]="dev"):ConnectionProfile { const now=new Date().toISOString(); return { id,name:"Docker",protocol,host:"127.0.0.1",port:8182,path:"gremlin",username:"",environment,connectionReadOnly:false,clientMode,traversalSource:"g",graphBinding:"graph",connectTimeoutMs:5000,queryTimeoutMs:30000,tlsRejectUnauthorized:true,tlsCaPath:"",tlsClientCertPath:"",tlsClientKeyPath:"",proxyMode:"direct",proxyUrl:"",proxyHost:"",proxyPort:8080,proxyBypass:"",proxyUsername:"",enableCompression:false,customHeaders:"{}",createdAt:now,updatedAt:now }; }

test("persists partial results and explicitly retries from the first incomplete rule", async()=>{
  const directory=mkdtempSync(join(tmpdir(),"janus-quality-service-"));const database=openApplicationDatabase(join(directory,"app.sqlite"));
  try{
    const repository=new QualityRepository(database);const stages:string[]=[];const updateRun=repository.updateRun.bind(repository);repository.updateRun=(id,patch)=>{if(patch.stage)stages.push(patch.stage);return updateRun(id,patch);};const tasks=new BackgroundTaskRepository(database);const connectionId=crypto.randomUUID();let calls=0;let fail=true;
    const queries={execute:async(_request:QueryRequest)=>{calls++;if(fail&&calls===2)throw new Error("planned failure");return {executionId:crypto.randomUUID(),durationMs:1,items:[{checkedCount:5,issueCount:0,samples:[]}],consoleText:"",truncated:false,totalCount:1};},cancel:async()=>true};
    const connections={profile:(id:string)=>profile(id)};
    const files={saveDataFile:async()=>null};
    const service=new DataQualityService(repository,tasks,connections as unknown as ConnectionService,queries as unknown as QueryService,files as unknown as FileService);
    const set=service.saveRuleSet({name:"baseline",description:"",connectionId,graphName:"graph",graphBinding:"graph",graphAccess:"binding",rules:[
      {id:crypto.randomUUID(),name:"one",kind:"distribution",enabled:true,severity:"info"},
      {id:crypto.randomUUID(),name:"two",kind:"distribution",enabled:true,severity:"info"},
    ]});
    const first=service.start({ruleSetId:set.id,mode:"bounded",scanLimit:1000,sampleLimit:10});
    assert.equal((await terminal(repository,first.id)).status,"failed");
    assert.equal(service.getRun(first.id).results.length,2);
    assert.equal(service.getRun(first.id).results[1]?.status,"failed");
    fail=false;
    const retried=service.retry(first.id);
    assert.equal((await terminal(repository,retried.id)).status,"succeeded");
    assert.equal(service.getRun(retried.id).results.length,2);
    assert.equal(calls,3,"completed rule must not execute again during retry");
    assert.equal(tasks.get(retried.id)?.kind,"quality");
    assert.ok(stages.includes("collecting-samples"));
    assert.ok(stages.includes("finalizing"));
  }finally{database.close();rmSync(directory,{recursive:true,force:true});}
});

test("full duplicate checks are visibly skipped for HTTP without executing an unbounded query",async()=>{
  const directory=mkdtempSync(join(tmpdir(),"janus-quality-http-"));const database=openApplicationDatabase(join(directory,"app.sqlite"));
  try{
    const repository=new QualityRepository(database);const tasks=new BackgroundTaskRepository(database);const connectionId=crypto.randomUUID();let calls=0;
    const queries={execute:async()=>{calls++;throw new Error("must not execute");},cancel:async()=>true};
    const service=new DataQualityService(repository,tasks,{profile:(id:string)=>profile(id,"http","sessionless")} as unknown as ConnectionService,queries as unknown as QueryService,{saveDataFile:async()=>null} as unknown as FileService);
    const set=service.saveRuleSet({name:"http duplicate",description:"",connectionId,graphName:"graph",graphBinding:"graph",graphAccess:"binding",rules:[
      {id:crypto.randomUUID(),name:"duplicate",kind:"duplicate-vertex",enabled:true,severity:"warning",vertexLabel:"person",propertyKeys:["email"]},
    ]});
    const run=service.start({ruleSetId:set.id,mode:"full",sampleLimit:25});
    assert.equal((await terminal(repository,run.id)).status,"succeeded");
    const detail=service.getRun(run.id);
    assert.equal(calls,0);
    assert.equal(detail.results[0]?.status,"skipped");
    assert.match(detail.results[0]?.message??"",/HTTP\/HTTPS/);
  }finally{database.close();rmSync(directory,{recursive:true,force:true});}
});

test("cancellation stops before the next rule and keeps the completed boundary",async()=>{
  const directory=mkdtempSync(join(tmpdir(),"janus-quality-cancel-"));const database=openApplicationDatabase(join(directory,"app.sqlite"));
  try{
    const repository=new QualityRepository(database);const tasks=new BackgroundTaskRepository(database);const connectionId=crypto.randomUUID();let calls=0;let cancellations=0;
    const queries={execute:async()=>{calls++;await delay(60);return {executionId:crypto.randomUUID(),durationMs:60,items:[{checkedCount:1,issueCount:0,samples:[]}],consoleText:"",truncated:false,totalCount:1};},cancel:async()=>{cancellations++;return true;}};
    const service=new DataQualityService(repository,tasks,{profile:(id:string)=>profile(id)} as unknown as ConnectionService,queries as unknown as QueryService,{saveDataFile:async()=>null} as unknown as FileService);
    const set=service.saveRuleSet({name:"cancel",description:"",connectionId,graphName:"graph",graphBinding:"graph",graphAccess:"binding",rules:[
      {id:crypto.randomUUID(),name:"one",kind:"distribution",enabled:true,severity:"info"},
      {id:crypto.randomUUID(),name:"two",kind:"distribution",enabled:true,severity:"info"},
    ]});
    const run=service.start({ruleSetId:set.id,mode:"bounded"});await delay(10);assert.equal(await service.cancel(run.id),true);
    assert.equal((await terminal(repository,run.id)).status,"interrupted");
    assert.equal(calls,1);assert.equal(cancellations,1);
  }finally{database.close();rmSync(directory,{recursive:true,force:true});}
});

test("production full audits require an exact graph-name confirmation",async()=>{
  const directory=mkdtempSync(join(tmpdir(),"janus-quality-prod-"));const database=openApplicationDatabase(join(directory,"app.sqlite"));
  try{
    const repository=new QualityRepository(database);const connectionId=crypto.randomUUID();
    const queries={execute:async()=>({executionId:crypto.randomUUID(),durationMs:1,items:[{checkedCount:0,issueCount:0,samples:[]}],consoleText:"",truncated:false,totalCount:1}),cancel:async()=>true};
    const service=new DataQualityService(repository,new BackgroundTaskRepository(database),{profile:(id:string)=>profile(id,"ws","sessioned","prod")} as unknown as ConnectionService,queries as unknown as QueryService,{saveDataFile:async()=>null} as unknown as FileService);
    const set=service.saveRuleSet({name:"production",description:"",connectionId,graphName:"graph-prod",graphBinding:"graph",graphAccess:"binding",rules:[{id:crypto.randomUUID(),name:"distribution",kind:"distribution",enabled:true,severity:"info"}]});
    assert.throws(()=>service.start({ruleSetId:set.id,mode:"full"}),/完整图名称/);
    assert.throws(()=>service.start({ruleSetId:set.id,mode:"full",productionConfirmed:true,confirmedGraphName:"graph"}),/完整图名称/);
    const run=service.start({ruleSetId:set.id,mode:"full",productionConfirmed:true,confirmedGraphName:"graph-prod"});
    assert.equal((await terminal(repository,run.id)).status,"succeeded");
  }finally{database.close();rmSync(directory,{recursive:true,force:true});}
});

test("quality execution enforces one full run per connection and two runs globally",async()=>{
  const directory=mkdtempSync(join(tmpdir(),"janus-quality-concurrency-"));const database=openApplicationDatabase(join(directory,"app.sqlite"));
  try{
    const repository=new QualityRepository(database);const connections={profile:(id:string)=>profile(id)};
    const queries={execute:async()=>{await delay(80);return {executionId:crypto.randomUUID(),durationMs:80,items:[{checkedCount:0,issueCount:0,samples:[]}],consoleText:"",truncated:false,totalCount:1};},cancel:async()=>true};
    const service=new DataQualityService(repository,new BackgroundTaskRepository(database),connections as unknown as ConnectionService,queries as unknown as QueryService,{saveDataFile:async()=>null} as unknown as FileService);
    const makeSet=(connectionId:string,name:string)=>service.saveRuleSet({name,description:"",connectionId,graphName:"graph",graphBinding:"graph",graphAccess:"binding",rules:[{id:crypto.randomUUID(),name:"distribution",kind:"distribution",enabled:true,severity:"info"}]});
    const firstSet=makeSet(crypto.randomUUID(),"first"),secondSet=makeSet(crypto.randomUUID(),"second"),thirdSet=makeSet(crypto.randomUUID(),"third");
    const first=service.start({ruleSetId:firstSet.id,mode:"bounded"});
    assert.throws(()=>service.start({ruleSetId:firstSet.id,mode:"full"}),/同一连接/);
    const second=service.start({ruleSetId:secondSet.id,mode:"bounded"});
    assert.throws(()=>service.start({ruleSetId:thirdSet.id,mode:"bounded"}),/全局最多/);
    assert.equal((await terminal(repository,first.id)).status,"succeeded");
    assert.equal((await terminal(repository,second.id)).status,"succeeded");
  }finally{database.close();rmSync(directory,{recursive:true,force:true});}
});
