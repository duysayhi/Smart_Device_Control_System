/* eslint-disable @typescript-eslint/no-require-imports */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript');
const React=require('react'),{renderToStaticMarkup}=require('react-dom/server'),{randomUUID,createHash}=require('node:crypto');
const root=path.resolve(__dirname,'..');
for(const ext of ['.ts','.tsx'])require.extensions[ext]=(m,f)=>{const original=m.require.bind(m);m.require=id=>original(id.startsWith('@/')?path.join(root,id.slice(2)):id);m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true},fileName:f}).outputText,f);};
const text=node=>node==null||typeof node==='boolean'?'':Array.isArray(node)?node.map(text).join(''):typeof node==='object'?text(node.props?.children):String(node);
const nodes=node=>!node||typeof node!=='object'?[]:Array.isArray(node)?node.flatMap(nodes):[node,...nodes(node.props?.children)];
function harness(props,relative='components/skills/LiveTeachRecorder.tsx',exportName='LiveTeachRecorder'){
  const slots=[],effects=new Map();let cursor=0,output;
  const changed=(a,b)=>!a||!b||a.length!==b.length||a.some((v,i)=>!Object.is(v,b[i]));
  const hooks={...React,useState(initial){const i=cursor++;slots[i]??={value:typeof initial==='function'?initial():initial};return [slots[i].value,v=>{slots[i].value=typeof v==='function'?v(slots[i].value):v;}];},
    useRef(initial){const i=cursor++;slots[i]??={value:{current:initial}};return slots[i].value;},
    useEffect(effect,deps){const i=cursor++;if(changed(slots[i]?.deps,deps))effects.set(i,{effect,deps});},
    useCallback(callback,deps){const i=cursor++;if(changed(slots[i]?.deps,deps))slots[i]={value:callback,deps};return slots[i].value;}};
  const file=path.join(root,relative),original=Module._load;delete require.cache[file];
  Module._load=function(name,parent,main){return name==='react'&&parent?.filename===file?hooks:original.call(this,name,parent,main);};
  let Component;try{Component=require(file)[exportName];}finally{Module._load=original;}
  function render(){cursor=0;output=Component(props);for(const [i,e]of effects){slots[i]?.cleanup?.();slots[i]={deps:e.deps,cleanup:e.effect()};}effects.clear();return output;}
  const find=pred=>{const n=nodes(output).find(pred);assert.ok(n,'Expected UI element');return n;};
  return {render,get output(){return output;},find,button:label=>find(n=>n.type==='button'&&text(n)===label),async settle(){for(let i=0;i<7;i++){await new Promise(setImmediate);render();}},close(){for(const slot of slots)slot?.cleanup?.();}};
}
function fixture(options={}){
  const oldFetch=global.fetch,oldStorage=global.sessionStorage,cache=new Map(),requests=[],busy=[];let savedCalls=0;
  const id=randomUUID(),leaseId=randomUUID(),token='a'.repeat(64),sid='offline-ui-session';
  let view={id,query:options.boundQuery??'marine biology',name:'G3 search',appAlias:'youtube',revision:1,mode:'LIVE_RECORDER',database:{status:'RECORDING',ownership:'HELD'},receipts:[],worker:{leaseId,recordingRef:id,deviceId:'A',physicalId:'android:'+'b'.repeat(64),executionId:randomUUID(),sessionId:sid,status:'RECORDING',cleanup:'PENDING',receipts:[],modelCalls:0,metrics:{rpcCount:0,adbCount:0,elapsedMs:1}}};
  const frame=()=>({id:randomUUID(),recordingRef:id,deviceId:'A',physicalId:view.worker.physicalId,sessionId:sid,snapshotId:randomUUID(),at:Date.now(),expiresAt:Date.now()+5000,width:400,height:900,orientation:'PORTRAIT',transport:'SCREENSHOT_POLLING',minimumIntervalMs:2000,controls:[{id:'query-input',operation:'INPUT_TEXT',label:'Search'}],imageOmittedReason:'CAPTURE_SAFETY_UNKNOWN'});
  global.sessionStorage={getItem:key=>cache.get(key)??null,setItem:(key,value)=>cache.set(key,value),removeItem:key=>cache.delete(key)};
  if(options.restore)cache.set('phoneCommanderTeachG3Lease',JSON.stringify({id,leaseId,ownerToken:token}));
  global.fetch=async(url,init={})=>{
    const body=init.body?JSON.parse(init.body):undefined;requests.push({url:String(url),method:init.method,body});
    assert.ok(String(url).startsWith('/api/teach-recorder')||String(url).startsWith('/api/teach-sessions'),'Only recorder or existing Save route');
    if(url==='/api/teach-recorder'&&!body)return Response.json({mode:'LIVE_RECORDER',devices:[{id:'A',label:'Fixture …A',state:'ONLINE'}]});
    if(url==='/api/teach-recorder'&&body)return Response.json({...view,ownerToken:token});
    if(url.endsWith('/stream')){const frame={image:'AA==',width:400,height:900,at:Date.now(),status:'RECORDING'},body=new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('data:'+JSON.stringify(frame)+'\n\n'));}});return new Response(body,{headers:{'Content-Type':'text/event-stream'}});}
    if(url.endsWith('/state'))return options.memoryLost?Response.json({code:'RECORDER_MEMORY_LOST'},{status:410}):Response.json(view);
    if(url.endsWith('/frame'))return Response.json(frame());
    if(url.endsWith('/annotate')){view={...view,annotations:[{id:body.requestId,choice:body.choice,source:'PHYSICAL_DEVICE',provenance:'HUMAN_ANNOTATED',verification:'UNVERIFIED'}]};return Response.json(view);}
    if(url.endsWith('/step')){view={...view,revision:view.revision+1,receipts:[...view.receipts,{id:randomUUID(),sessionId:sid,operation:body.operation,dispatch:'NOT_SENT',verification:'PASSED',persistence:'PERSISTED',reason:'ALREADY_FOREGROUND_NOT_DISPATCHED'}]};return Response.json(view);}
    if(url.endsWith('/stop')){view={...view,revision:view.revision+1,database:{status:'REVIEWING',ownership:'RELEASED'},worker:{...view.worker,status:'REVIEWING',cleanup:'PROVEN'}};return Response.json(view);}
    if(url.endsWith('/compile')){view={...view,revision:view.revision+1,database:{status:'COMPILED',ownership:'RELEASED'},review:{saveSessionId:randomUUID(),reference:randomUUID(),origin:'RECORDED',compilation:{draft:{appScope:{alias:'youtube'},parameters:{query:{type:'string'}},steps:[{id:'s1',operation:'OPEN_APPLICATION',verify:{kind:'FOREGROUND_IS'}}]},limitations:[]}}};return Response.json(view);}
    if(url.endsWith('/save-draft')){savedCalls++;if(options.saveUnknown)throw Error('Synthetic transport loss');return Response.json({storageMode:'POSTGRESQL_STORAGE',status:'DRAFT',version:1,skillId:randomUUID()});}
    assert.fail('Unexpected UI request '+url);
  };
  const h=harness({onBusy:value=>busy.push(value),onSaved:()=>undefined});
  const begin=()=>h.find(n=>n.type==='form').props.onSubmit({preventDefault(){}});
  return {h,requests,busy,begin,get savedCalls(){return savedCalls;},close(){h.close();global.fetch=oldFetch;if(oldStorage===undefined)delete global.sessionStorage;else global.sessionStorage=oldStorage;}};
}
test('G3 initial unified SSR preserves the original control Dashboard byte-for-byte below the new tabs',()=>{
  const old=global.fetch;global.fetch=()=>assert.fail('No SSR provider or Worker');
  try{const html=renderToStaticMarkup(React.createElement(require('../app/page.tsx').default));
    assert.match(html,/Dạy kỹ năng/);const control=html.replace(/<nav aria-label="Chế độ Dashboard"[\s\S]*?<\/nav>/,'');
    assert.equal(createHash('sha256').update(control).digest('hex'),'270d9f325288d05c9dbdb1f305fc8b733e95ef1c97bd5c1101939f08c3602e84');
  }finally{global.fetch=old;}
});
test('G3 mode integration keeps the original declaration panel and locks mode changes during recording',()=>{
  const h=harness({onBusy:()=>undefined},'components/skills/TeachWorkspace.tsx','TeachWorkspace');
  try{h.render();h.find(n=>n.type===require('../components/skills/LiveTeachRecorder.tsx').LiveTeachRecorder).props.onBusy(true);h.render();
    assert.equal(h.button('Khai báo bằng form — chưa dispatch').props.disabled,true);
    h.find(n=>n.type===require('../components/skills/LiveTeachRecorder.tsx').LiveTeachRecorder).props.onBusy(false);h.render();h.button('Khai báo bằng form — chưa dispatch').props.onClick();h.render();
    assert.ok(nodes(h.output).some(n=>n.type===require('../components/skills/TeachModePanel.tsx').TeachModePanel));assert.ok(!nodes(h.output).some(n=>n.type===require('../components/skills/LiveTeachRecorder.tsx').LiveTeachRecorder));
  }finally{h.close();}
});
test('G3 live UI uses an explicit screen stream and does not claim physical-touch capture',async()=>{
  const f=fixture();try{f.h.render();await f.h.settle();assert.match(text(f.h.output),/luồng ảnh cục bộ/);assert.match(text(f.h.output),/Cú chạm trực tiếp trên điện thoại chưa được ghi nhận/);assert.equal(f.requests.filter(r=>r.method==='POST').length,0);
    f.begin();await f.h.settle();assert.equal(f.h.button('Home').props.disabled,true);assert.equal(f.h.button('Long press').props.disabled,true);assert.match(text(f.h.output),/FPS thực/);assert.equal(f.h.button('Ngắt Live View').props.disabled,false);
    assert.ok(f.requests.some(r=>r.url.endsWith('/stream')));
  }finally{f.close();}
});
test('G3 one Start/step click, even double-invoked before render, sends exactly one app fetch',async()=>{
  const f=fixture();try{f.h.render();await f.h.settle();f.begin();f.begin();await f.h.settle();assert.equal(f.requests.filter(r=>r.url==='/api/teach-recorder'&&r.method==='POST').length,1);
    const button=f.h.button('Mở ứng dụng');assert.equal(button.props.disabled,false);button.props.onClick();button.props.onClick();await f.h.settle();assert.equal(f.requests.filter(r=>r.url.endsWith('/step')).length,1);assert.match(text(f.h.output),/OBSERVED \/ NOT_DISPATCHED/);assert.match(text(f.h.output),/PERSISTED/);assert.ok(f.busy.includes(true));
  }finally{f.close();}
});
test('G3 INPUT_TEXT uses the query bound at Start and does not accept a freeform replacement',async()=>{
  const f=fixture();try{f.h.render();await f.h.settle();f.begin();await f.h.settle();
    const queryInput=nodes(f.h.output).find(n=>n.type==='input'&&n.props?.readOnly===true);assert.ok(queryInput);
    f.h.button('Nhập nội dung').props.onClick();await f.h.settle();const step=f.requests.find(r=>r.url.endsWith('/step'));
    assert.equal(step.body.operation,'INPUT_TEXT');assert.equal(step.body.value,'marine biology');
  }finally{f.close();}
});
test('G3 review confirmation gates the reused Save endpoint, UNKNOWN response never retries',async()=>{
  const f=fixture({saveUnknown:true});try{f.h.render();await f.h.settle();f.begin();await f.h.settle();f.h.button('Kết thúc ghi').props.onClick();await f.h.settle();
    f.h.button('Compile và Review').props.onClick();await f.h.settle();const save=f.h.button('Lưu DRAFT đúng một lần');assert.equal(save.props.disabled,true);assert.equal(f.savedCalls,0);
    f.h.find(n=>n.props?.['aria-label']==='Xác nhận lưu kỹ năng live').props.onChange({target:{checked:true}});f.h.render();
    const enabled=f.h.button('Lưu DRAFT đúng một lần');assert.equal(enabled.props.disabled,false);enabled.props.onClick();enabled.props.onClick();await f.h.settle();assert.equal(f.savedCalls,1);assert.equal(f.h.button('Lưu DRAFT đúng một lần').props.disabled,true);assert.match(text(f.h.output),/NETWORK_OUTCOME_UNKNOWN/);
    assert.ok(f.requests.find(r=>r.url.endsWith('/save-draft')).url.startsWith('/api/teach-sessions/'));
  }finally{f.close();}
});
test('G3 refresh restores original ownership via GET; Next memory loss never auto-replays OPEN or STEP',async()=>{
  for(const memoryLost of [false,true]){const f=fixture({restore:true,memoryLost});try{f.h.render();await f.h.settle();assert.equal(f.requests.filter(r=>r.method==='POST').length,0);assert.ok(f.requests.some(r=>r.url.endsWith('/state')));if(memoryLost){assert.match(text(f.h.output),/Không phát lại thao tác/);assert.equal(f.h.button('Kiểm tra và kết thúc phiên cũ').props.disabled,false);assert.ok(f.busy.includes(true));}}finally{f.close();}}
});

test('G3 restored owner tab uses the backend-bound query rather than the form default',async()=>{
 const f=fixture({restore:true,boundQuery:'OpenAI G36 Test A'});try{f.h.render();await f.h.settle();f.h.button('Nhập nội dung').props.onClick();await f.h.settle();assert.equal(f.requests.find(r=>r.url.endsWith('/step')).body.value,'OpenAI G36 Test A');}finally{f.close();}
});
test('G3 manual physical clarification records annotation without redispatching the user action',async()=>{
 const f=fixture();try{f.h.render();await f.h.settle();f.begin();await f.h.settle();f.h.find(n=>n.type==='button'&&text(n).startsWith('\u0110\u00e1nh')).props.onClick();f.h.render();assert.ok(nodes(f.h.output).some(n=>n.type==='h3'));f.h.find(n=>n.type==='button'&&text(n).startsWith('X\u00e1c nh\u1eadn ch\u00fa')).props.onClick();await f.h.settle();assert.equal(f.requests.filter(r=>r.url.endsWith('/step')).length,0);assert.equal(f.requests.find(r=>r.url.endsWith('/annotate')).body.choice,'SEARCH_BUTTON');assert.match(text(f.h.output),/HUMAN_ANNOTATED/);}finally{f.close();}
});
