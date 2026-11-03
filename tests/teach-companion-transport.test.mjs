import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import {load} from './helpers/react-skill-console.mjs';
const {CompanionTransport,CompanionEventSchema}=load(path.resolve('lib/skills/companion-transport.ts'));
async function fixture(t,handler){const server=http.createServer(handler);await new Promise(r=>server.listen(0,'127.0.0.1',r));const transport=new CompanionTransport('OFFLINE',server.address().port,'a'.repeat(64));t.after(async()=>{transport.stopFrames();server.closeAllConnections();await new Promise(r=>server.close(r));});return transport;}
test('OFFLINE native transport decodes split multipart frames with original dimensions and capture time',async t=>{
 const at=Date.now(),transport=await fixture(t,(req,res)=>{assert.equal(req.headers.authorization,'Bearer '+'a'.repeat(64));res.writeHead(200,{'Content-Type':'multipart/x-mixed-replace; boundary=frame'});res.write('--frame\r\nContent-Length: 4\r\nX-Captured-At: '+at+'\r\nX-Source-Width: 1080\r\nX-Source-Height: 2340\r\n\r\n');setTimeout(()=>res.write(Buffer.from([255,216,255,217])),10);});
 const frame=await transport.frame();assert.equal(frame.transport,'MEDIAPROJECTION_MJPEG');assert.equal(frame.width,1080);assert.equal(frame.height,2340);assert.equal(frame.at,at);assert.equal(frame.image,'/9j/2Q==');
});
test('OFFLINE native transport rejects unbounded frame headers before accepting image data',async t=>{
 const transport=await fixture(t,(_req,res)=>{res.writeHead(200,{'Content-Type':'multipart/x-mixed-replace; boundary=frame'});res.end('--frame\r\nContent-Length: 1048577\r\n\r\n');});await assert.rejects(transport.frame(),/FRAME_LIMIT/);
});
test('OFFLINE native observer events cannot claim physical origin, verified receipt or arbitrary raw fields',()=>{
 const event={sequence:1,origin:'ANDROID_ACCESSIBILITY',inputOrigin:'UNDETERMINED',verification:'UNVERIFIED',eventType:1,deviceUptime:1,at:Date.now(),windowId:1,packageName:'com.google.android.youtube',target:{resourceId:'search',className:'Button',bounds:[0,0,100,100]},beforeTargetFingerprint:null,beforeObservedAt:0,afterTargetFingerprint:'observed-target'};
 assert.ok(CompanionEventSchema.safeParse(event).success);assert.equal(CompanionEventSchema.safeParse({...event,inputOrigin:'PHYSICAL_DEVICE'}).success,false);assert.equal(CompanionEventSchema.safeParse({...event,verification:'PASSED'}).success,false);assert.equal(CompanionEventSchema.safeParse({...event,rawTouch:[1,2]}).success,false);
});
test('OFFLINE native transport refuses a revoked pairing token',async t=>{const transport=await fixture(t,(_req,res)=>{res.writeHead(403);res.end();});await assert.rejects(transport.events(),/EVENTS_UNAVAILABLE/);});
