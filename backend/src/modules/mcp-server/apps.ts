import { readFileSync } from "node:fs";
import { colors, darkColors } from "@orbyn/core";

/**
 * MCP Apps (optional, behind Admin → Agents → "Cards in agents"): three
 * small cards an agent that supports MCP Apps can show beside a tool's
 * answer, drawn from the answer it already has.
 *
 * - Today (get_today): what's planned, what's due and what's late.
 * - A plan preview (plan_schedule, plan_revision) with Apply, which calls
 *   schedule_sessions with the plan's plan_token through the agent (so the
 *   connection's own access and review rules apply).
 * - A proposal (propose_changes): what waits, and a button that opens it in
 *   Orbyn's Review inbox. Approving happens only in Orbyn.
 *
 * Each card is one self-contained HTML page (no outside scripts, styles,
 * fonts or requests), coloured with Orbyn's palette tokens and following
 * only the host's light or dark mode. Everything shown is set as text,
 * never as markup.
 */

export const MCP_APPS_EXTENSION = "io.modelcontextprotocol/ui";
export const APP_MIME = "text/html;profile=mcp-app";

type Card = {
  uri: string;
  name: string;
  description: string;
  tools: string[];
  body: string;
  script: string;
};

/** The palette as CSS variables, light by default and dark on request. */
function paletteCss(): string {
  const vars = (p: Record<string, string>) =>
    Object.entries(p)
      .map(([k, v]) => `--color-${k}:${v};`)
      .join("");
  return `:root{${vars(colors)}color-scheme:light}:root[data-theme="dark"]{${vars(darkColors)}color-scheme:dark}`;
}

const BASE_CSS = `
*{box-sizing:border-box}
body{margin:0;font:14px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--color-text);background:var(--color-surface)}
.card{padding:16px;border:1px solid var(--color-border);border-radius:12px;background:var(--color-surface)}
h1{font-size:15px;font-weight:600;margin:0 0 4px}
.sub{color:var(--color-muted);font-size:13px;margin:0 0 12px}
ul{list-style:none;margin:0 0 12px;padding:0}
li{display:flex;gap:10px;padding:6px 0;border-top:1px solid var(--color-divider)}
li:first-child{border-top:0}
.when{color:var(--color-textSoft);min-width:92px;font-variant-numeric:tabular-nums}
.late{color:var(--color-danger)}
.tag{font-size:11px;padding:1px 8px;border-radius:999px;background:var(--color-accentSoft);color:var(--color-accent);align-self:center}
.warn{font-size:11px;padding:1px 8px;border-radius:999px;background:var(--color-dangerSoft);color:var(--color-danger);align-self:center}
h2{font-size:13px;font-weight:600;color:var(--color-textSoft);margin:12px 0 4px}
.row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
button{font:inherit;font-weight:500;padding:8px 14px;border-radius:8px;border:1px solid var(--color-border);background:var(--color-surface);color:var(--color-text);cursor:pointer}
button.primary{background:var(--color-accent);border-color:var(--color-accent);color:var(--color-background)}
button:disabled{opacity:.6;cursor:default}
textarea{display:block;width:100%;min-height:55vh;max-height:75vh;resize:vertical;margin:12px 0;padding:14px;border:1px solid var(--color-border);border-radius:8px;background:var(--color-background);color:var(--color-text);font:12px/1.55 ui-monospace,SFMono-Regular,Consolas,monospace;overflow:auto;overflow-wrap:anywhere}
textarea:focus-visible,button:focus-visible{outline:2px solid var(--color-accent);outline-offset:2px}
textarea[readonly]{border-color:var(--color-divider)}
article{overflow-wrap:anywhere}article table{display:block;max-width:100%;overflow-x:auto}article pre,pre{white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.55 ui-monospace,monospace;max-height:50vh;overflow:auto}article h1{font-size:18px}article h2{font-size:16px}article li{display:list-item;border:0}select{max-width:100%;font:inherit;padding:8px;background:var(--color-surface);color:var(--color-text);border:1px solid var(--color-border);border-radius:8px}summary{cursor:pointer;padding:8px 0}
.note{font-size:13px;color:var(--color-textSoft);margin:8px 0 0}
.empty{color:var(--color-muted)}
`;

/**
 * The bridge to the host (MCP Apps, postMessage JSON-RPC): initialize,
 * follow its theme, hear the tool result, call a tool, open a link, and
 * say how tall the card is.
 */
const BRIDGE = `
const pending=new Map();let next=1;
const send=(m)=>window.parent.postMessage(m,"*");
const request=(method,params)=>new Promise((res,rej)=>{const id=next++;pending.set(id,{res,rej});send({jsonrpc:"2.0",id,method,params});});
const theme=(t)=>{document.documentElement.dataset.theme=t==="dark"?"dark":"light";};
const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=String(text);return n;};
const resize=()=>send({jsonrpc:"2.0",method:"ui/notifications/size-changed",params:{height:document.documentElement.scrollHeight}});
const openLink=(url)=>request("ui/open-link",{url}).catch(()=>{});
window.addEventListener("message",(e)=>{
  if(e.source!==window.parent)return;const m=e.data;if(!m||m.jsonrpc!=="2.0")return;
  if(m.id!==undefined&&pending.has(m.id)&&!m.method){const p=pending.get(m.id);pending.delete(m.id);m.error?p.rej(m.error):p.res(m.result);return;}
  if(m.method==="ui/notifications/tool-result"){render(m.params||{});resize();}
  if(m.method==="ui/notifications/tool-input"&&typeof onToolInput==="function")onToolInput(m.params||{});
  if(m.method==="notifications/resources/updated"&&typeof onResourceUpdated==="function")onResourceUpdated(m.params||{});
  if(m.method==="ui/notifications/host-context-changed"&&m.params&&m.params.theme)theme(m.params.theme);
});
request("ui/initialize",{protocolVersion:"2026-01-26",appInfo:{name:"orbyn",version:"1"},appCapabilities:{}})
  .then((r)=>{theme(r&&r.hostContext&&r.hostContext.theme);send({jsonrpc:"2.0",method:"ui/notifications/initialized"});})
  .catch(()=>{});
`;

const TODAY: Card = {
  uri: "ui://orbyn/today.html",
  name: "Today card",
  description: "The Today list as a card: planned, due and late.",
  tools: ["get_today"],
  body: `<div class="card"><h1 id="title">Today</h1><p class="sub" id="sub"></p><div id="list"></div><div class="row"><button id="load">Load today</button><button id="open" disabled>Open Today in Orbyn</button></div></div>`,
  script: `
let url=null;const open=document.getElementById("open");const load=document.getElementById("load");
open.onclick=()=>url&&openLink(url);
load.onclick=async()=>{load.disabled=true;
  try{const result=await request("tools/call",{name:"get_today",arguments:{}});render(result||{});resize();}
  catch{document.getElementById("sub").textContent="Today is unavailable. Try again.";load.disabled=false;}
};
function render(result){
  const s=result.structuredContent||{};if(s.kind==="plugin_home")return;
  if(result.isError){document.getElementById("sub").textContent="Today is unavailable. Try again.";load.disabled=false;return;}
  url=s.url||null;open.disabled=!url;load.hidden=true;
  document.getElementById("sub").textContent=s.day?("Your day, "+s.day):"";
  const list=document.getElementById("list");list.replaceChildren();
  const section=(title,rows)=>{list.append(el("h2",null,title));const ul=el("ul");
    if(!rows.length)ul.append(el("li","empty","Nothing here."));
    for(const r of rows)ul.append(r);list.append(ul);};
  section("Planned",(s.planned||[]).slice(0,12).map((p)=>{const li=el("li");
    li.append(el("span","when",p.all_day?"All day":(p.start&&p.start.local||"").slice(-5)),el("span",null,p.title));
    if(p.after_deadline)li.append(el("span","warn","After the deadline"));return li;}));
  section("Due today",(s.due||[]).slice(0,12).map((t)=>{const li=el("li");li.append(el("span",null,t.title));
    if(t.planned_minutes)li.append(el("span","tag",t.planned_minutes+" min planned"));return li;}));
  if(s.late_total){const p=el("p","note late",s.late_total+" late");list.append(p);}
}`,
};

const PLAN: Card = {
  uri: "ui://orbyn/plan.html",
  name: "Plan preview",
  description:
    "A plan's sessions before anything is on the calendar, with Apply.",
  tools: ["plan_schedule", "plan_revision"],
  body: `<div class="card"><h1>Plan preview</h1><p class="sub" id="sub"></p><div id="list"></div><div class="row"><button class="primary" id="apply" disabled>Apply</button></div><p class="note" id="note"></p></div>`,
  script: `
let token=null;const apply=document.getElementById("apply");const note=document.getElementById("note");
apply.onclick=async()=>{if(!token)return;apply.disabled=true;note.textContent="Adding the sessions…";
  try{const r=await request("tools/call",{name:"schedule_sessions",arguments:{plan_token:token}});
    const text=(r&&r.content&&r.content[0]&&r.content[0].text)||"";
    const s=(r&&r.structuredContent)||{};
    note.textContent=r&&r.isError?text:(s.status==="pending_review"?"Sent to your Review inbox in Orbyn.":"Added to your calendar.");
    if(r&&r.isError)apply.disabled=false;}
  catch(e){note.textContent="That didn't work. Ask the agent to apply the plan.";apply.disabled=false;}
  resize();};
function render(result){
  const s=result.structuredContent||{};token=s.plan_token||null;apply.disabled=!token||!!result.isError;
  document.getElementById("sub").textContent=s.summary||(s.exam?("Revision for "+s.exam):"");
  const list=document.getElementById("list");list.replaceChildren();
  const ul=el("ul");const sessions=(s.sessions||[]).slice(0,20);
  if(!sessions.length)ul.append(el("li","empty","No sessions fit."));
  for(const x of sessions){const li=el("li");li.append(el("span","when",x.local||""),el("span",null,x.title||"Session"));ul.append(li);}
  list.append(ul);
  const un=(s.unplaced||[]);if(un.length){list.append(el("h2",null,"Didn't fit"));const u=el("ul");
    for(const x of un.slice(0,10)){const li=el("li");li.append(el("span",null,x.title),el("span","warn",x.reason));u.append(li);}list.append(u);}
  note.textContent=token?"Nothing is on the calendar until you apply it.":"";
}`,
};

const REVIEW: Card = {
  uri: "ui://orbyn/review.html",
  name: "Proposal to review",
  description:
    "Changes waiting in Orbyn's Review inbox, with a button to open them there.",
  tools: ["propose_changes"],
  body: `<div class="card"><h1>Waiting for your review</h1><p class="sub" id="sub"></p><div class="row"><button class="primary" id="open" disabled>Review in Orbyn</button></div><p class="note">Changes are only made once you approve them in Orbyn.</p></div>`,
  script: `
let url=null;const open=document.getElementById("open");open.onclick=()=>url&&openLink(url);
function render(result){
  const s=result.structuredContent||{};const p=s.pending||s;url=p.review_url||null;open.disabled=!url;
  const n=p.changes||0;document.getElementById("sub").textContent=url?(n+" change"+(n===1?"":"s")+" in your Review inbox"):"Nothing is waiting.";
}`,
};

const MARKDOWN_FILE: Card = {
  uri: "ui://orbyn/markdown-file.html",
  name: "Markdown file",
  description: "View or edit a Markdown file opened in the host.",
  tools: ["open_markdown_file"],
  body: `<main class="card"><div class="row"><h1 id="file-name">Markdown file</h1><span class="tag" id="mode">Opening</span></div><p class="sub" id="file-status">Waiting for the file.</p><textarea id="source" aria-label="Markdown source" spellcheck="false" readonly></textarea><div class="row"><button id="save" class="primary" hidden disabled>Save</button><button id="reload" hidden>Reload</button></div></main>`,
  script: `
let fileUri=null,etag=null,original="",generation=0,dirty=false,canSave=false,discardPending=false,subscribedUri=null,saving=false;
const source=document.getElementById("source"),save=document.getElementById("save"),reload=document.getElementById("reload");
const status=document.getElementById("file-status"),mode=document.getElementById("mode"),title=document.getElementById("file-name");
const note=(value)=>{status.textContent=value;resize();};
function render(){/* The file is delivered as tool input, never tool output. */}
function onToolInput(params){
  const file=params&&params.arguments&&params.arguments.file;
  if(!file||typeof file.name!=="string"||typeof file.resourceUri!=="string"||file.name.includes("/")||file.name.includes("\\\\")||!/^.+\\.(md|markdown)$/i.test(file.name)||!file.resourceUri.trim()){
    note("This Markdown file is unavailable.");return;
  }
  if(fileUri===file.resourceUri&&(dirty||saving))return;
  if(subscribedUri&&subscribedUri!==file.resourceUri)request("resources/unsubscribe",{uri:subscribedUri}).catch(()=>{});
  subscribedUri=null;fileUri=file.resourceUri;source.value="";original="";title.textContent=file.name;dirty=false;discardPending=false;saving=false;loadFile();
}
async function loadFile(){
  if(!fileUri)return;const current=++generation;source.readOnly=true;canSave=false;etag=null;save.hidden=true;reload.hidden=true;reload.disabled=false;
  mode.textContent="Opening";note("Opening file…");
  try{
    const result=await request("resources/read",{uri:fileUri,_meta:{"openai/resource":{representation:"text"}}});
    if(current!==generation)return;
    const item=result&&result.contents&&result.contents[0];
    let value=typeof item?.text==="string"?item.text:null;
    if(value===null&&typeof item?.blob==="string"&&item.blob.length<=1400000){
      const bytes=Uint8Array.from(atob(item.blob),c=>c.charCodeAt(0));
      value=new TextDecoder("utf-8",{fatal:true}).decode(bytes);
    }
    if(value===null){reload.hidden=false;mode.textContent="Unavailable";note("The host could not provide Markdown text.");return;}
    const limited=value.length>500000;original=limited?value.slice(0,500000):value;
    source.value=original;dirty=false;
    const metadata=item&&item._meta&&item._meta["openai/resource"]||{};
    etag=typeof metadata.etag==="string"&&metadata.etag?metadata.etag:null;
    canSave=!limited&&metadata.writable===true&&!!etag;
    source.readOnly=!canSave;save.hidden=!canSave;save.disabled=true;reload.hidden=false;
    mode.textContent=canSave?"Editable":"Read only";
    note(limited?"Showing the first 500,000 characters. Editing is disabled.":canSave?"Edit the Markdown source, then save.":"Markdown source");
    if(subscribedUri!==fileUri){
      const subscribed=fileUri;
      request("resources/subscribe",{uri:subscribed}).then(()=>{
        if(fileUri===subscribed)subscribedUri=subscribed;
        else request("resources/unsubscribe",{uri:subscribed}).catch(()=>{});
      }).catch(()=>{});
    }
  }catch{if(current!==generation)return;mode.textContent="Unavailable";note("Could not open this file. Try again.");reload.hidden=false;}
}
source.addEventListener("input",()=>{dirty=source.value!==original;save.disabled=saving||!canSave||!dirty;discardPending=false;if(saving)return;note(dirty?"Unsaved changes":"All changes saved");});
save.onclick=async()=>{
  if(saving||!canSave||!dirty||!fileUri||!etag)return;
  const current=++generation,submitted=source.value;saving=true;save.disabled=true;reload.disabled=true;note("Saving…");
  try{
    const result=await request("openai/resources/write",{uri:fileUri,text:submitted,ifMatch:etag});
    if(current!==generation)return;
    if(result&&result.outcome==="saved"&&typeof result.etag==="string"){
      original=submitted;etag=result.etag;dirty=source.value!==original;note(dirty?"Unsaved changes":"Saved");return;
    }
    if(result&&result.outcome==="conflict"){canSave=false;mode.textContent="Conflict";note("This file changed elsewhere. Copy your edits before reloading.");return;}
    if(result&&result.outcome==="too-large"){note("This file exceeds the host's save limit.");return;}
    note("The host did not save this file.");
  }catch{if(current===generation)note("Save failed. Your edits are still here.");}
  finally{if(current===generation){saving=false;reload.disabled=false;save.disabled=!canSave||!dirty;}}
};
reload.onclick=()=>{
  if(saving)return;
  if(dirty&&!discardPending){discardPending=true;note("Unsaved changes. Press Reload again to discard them.");return;}
  dirty=false;discardPending=false;loadFile();
};
function onResourceUpdated(params){
  if(!fileUri||params.uri!==fileUri)return;
  if(saving)return;
  if(dirty){note("This file changed elsewhere. Copy your edits before reloading.");return;}
  loadFile();
}
window.addEventListener("pagehide",()=>{if(subscribedUri)request("resources/unsubscribe",{uri:subscribedUri}).catch(()=>{});});
`,
};

const RESULT: Card = {
  uri: "ui://orbyn/result.html",
  name: "Orbyn result",
  description: "Authorized results, document previews and change receipts.",
  tools: [],
  body: `<main class="card"><h1 id="result-title">Orbyn</h1><p id="result-state" class="sub" role="status"></p><article id="result-body"></article><div id="result-links" class="row"></div><details id="document-edit" hidden><summary>Edit a line</summary><label>Line <select id="document-line" aria-label="Document line"></select></label><textarea id="document-source" aria-label="Line Markdown" spellcheck="false"></textarea><button id="document-review">Review change</button><pre id="document-diff" hidden></pre><button id="document-save" class="primary" hidden>Submit change</button></details><details id="result-details"><summary>Details</summary><pre id="result-source"></pre></details></main>`,
  script: `
const body=document.getElementById("result-body"),state=document.getElementById("result-state"),links=document.getElementById("result-links"),sourceDetails=document.getElementById("result-source");
const editPanel=document.getElementById("document-edit"),line=document.getElementById("document-line"),draft=document.getElementById("document-source"),review=document.getElementById("document-review"),saveDoc=document.getElementById("document-save"),diff=document.getElementById("document-diff");
let doc=null,lines=[],savingDoc=false,operation=null,diagramGeneration=0;
const safeUrl=(value)=>{try{const url=new URL(value);return url.protocol==="https:"&&!url.username&&!url.password?url.href:null;}catch{return null;}};
function link(label,value){const url=safeUrl(value);if(!url)return;const button=el("button",null,label);button.onclick=()=>openLink(url);links.append(button);}
function safeHtml(value){
 const parsed=new DOMParser().parseFromString(value,"text/html");
 const allowed=new Set("P BR H1 H2 H3 H4 H5 H6 UL OL LI BLOCKQUOTE PRE CODE STRONG EM DEL MARK TABLE THEAD TBODY TR TH TD HR DETAILS SUMMARY A SPAN DIV SUP SUB".split(" "));
 for(const node of [...parsed.body.querySelectorAll("*")]){
  if(!allowed.has(node.tagName)){node.remove();continue;}
  for(const attr of [...node.attributes])if(!["href","class","data-orbyn-diagram"].includes(attr.name))node.removeAttribute(attr.name);
  if(node.tagName==="A"){const url=safeUrl(node.getAttribute("href"));node.removeAttribute("href");if(url){node.tabIndex=0;node.role="link";node.onclick=()=>openLink(url);node.onkeydown=e=>{if(e.key==="Enter")openLink(url);};}}
 }
 body.replaceChildren(...parsed.body.childNodes);renderDiagrams();
}
function renderDiagrams(){
 const generation=++diagramGeneration;
 for(const [index,pre] of [...body.querySelectorAll('pre[data-orbyn-diagram="mermaid"]')].entries()){
  if(index>=8)break;const text=pre.textContent||"";if(text.length>65536)continue;
  if(typeof diagramRuntime!=="string"||!diagramRuntime)continue;
  const frame=el("iframe");frame.title="Mermaid diagram";frame.setAttribute("sandbox","allow-scripts");frame.style.cssText="width:100%;height:240px;border:0";
  const id="preview-"+generation+"-"+index;
  frame.srcdoc=diagramRuntime;frame.onload=()=>frame.contentWindow.postMessage(JSON.stringify({type:"orbyn-diagram",id,source:text}),"*");
  pre.before(frame);
  setTimeout(()=>{if(generation===diagramGeneration&&!frame.dataset.ready){frame.remove();resize();}},5000);
  const receive=e=>{if(e.source!==frame.contentWindow)return;let message;try{message=JSON.parse(e.data);}catch{return;}
   if(message.id!==id)return;if(message.type==="orbyn-diagram-result"){if(message.error){frame.remove();}else{frame.dataset.ready="true";frame.style.height=Math.min(600,Math.max(100,Number(message.height)||240))+"px";}resize();}
  };window.addEventListener("message",receive);frame.addEventListener("load",()=>{setTimeout(()=>window.removeEventListener("message",receive),5500);},{once:true});
 }
}
function render(result){
 const value=result.structuredContent||{};const preview=result._meta&&result._meta["orbyn/document-preview"];
 links.replaceChildren();body.replaceChildren();
 state.textContent=result.isError?"Could not complete this action.":value.pending?"Waiting for review":value.done?"Changes recorded":value.status||"";
 document.getElementById("result-title").textContent=typeof value.title==="string"?value.title:"Orbyn";
 const text=typeof value.text==="string"?value.text:(result.content||[]).filter(c=>c.type==="text").map(c=>c.text).join("\n");
 sourceDetails.textContent=(text||JSON.stringify(value,null,2)).slice(0,60000);
 if(preview&&typeof preview.html==="string"&&preview.html.length<=500000)safeHtml(preview.html);
 else {
  const rows=[value.results,value.rows,value.items,value.changes,value.done].find(Array.isArray);
  if(rows){const list=el("ul");for(const item of rows.slice(0,10)){if(!item||typeof item!=="object")continue;const row=el("li",null,item.title||item.name||item.summary||item.change||item.id||"Item");if(item.status)row.append(el("span","tag",item.status));list.append(row);link(item.title||item.name||"Open item",item.url||item.uri);}body.append(list);if(rows.length>10)body.append(el("p","note",(rows.length-10)+" more in Details"));if(!rows.length)body.append(el("p","empty","No results."));}
  else {const pre=el("pre",null,typeof value.result==="string"?value.result.slice(0,16000):typeof value.text==="string"?value.text.slice(0,16000):text.length>600?"Result ready. Open Details for the full response.":text||"No results.");body.append(pre);}
 }
 if(value.state&&typeof value.id==="string"&&typeof value.operation_id==="string"){
  state.textContent=value.state+(typeof value.model==="string"?" · "+value.model:"");
  if(["queued","running"].includes(value.state)){const refresh=el("button",null,"Refresh status");refresh.onclick=async()=>{refresh.disabled=true;try{render(await request("tools/call",{name:"get_workspace_ai_status",arguments:{id:value.id}}));}catch{state.textContent="Could not load status. Try again.";}finally{refresh.disabled=false;}};links.append(refresh);}
 }
 const receipt=result._meta&&result._meta["orbyn/receipt"];
 if(receipt&&receipt.canUndo){const history=el("button",null,"Change history");history.onclick=async()=>{
  history.disabled=true;try{const response=await request("tools/call",{name:"list_agent_changes",arguments:{limit:10}});if(response.isError){state.textContent="Could not load changes.";return;}
   const changes=response.structuredContent?.changes||[];const list=el("ul");for(const change of changes){const row=el("li",null,change.summary);if(change.undo_until&&!change.undone_at&&Date.parse(change.undo_until)>Date.now()){
    const undo=el("button",null,"Undo");let confirmed=false,ref=null;undo.onclick=async()=>{if(!confirmed){confirmed=true;ref=crypto.randomUUID();undo.textContent="Confirm undo";return;}undo.disabled=true;try{const answer=await request("tools/call",{name:"undo",arguments:{change:change.id,client_ref:ref}});state.textContent=answer.isError?"Undo not accepted. Check Details or reopen the item.":"Undo recorded.";if(answer.isError)undo.disabled=false;}catch{state.textContent="Undo outcome unavailable. Retry the same action.";undo.disabled=false;}};row.append(undo);
   }list.append(row);}body.replaceChildren(list);resize();
  }catch{state.textContent="Could not load changes. Try again.";}finally{history.disabled=false;}
 };links.append(history);}

 link("Open in Orbyn",value.url);const pending=value.pending||{};link("Open review",pending.review_url||value.review_url);
 for(const item of (Array.isArray(value.done)?value.done:[]).slice(0,10))link(item.title||"Open item",item.url);
 // User drafts survive subsequent results and conflicts. No mutation happens on render.
 if(!doc&&preview&&preview.editable===true&&typeof preview.id==="string"&&Number.isInteger(preview.version)){
  doc={id:preview.id,version:preview.version};lines=Array.isArray(preview.lines)?preview.lines:[];
  for(const item of lines){const option=el("option",null,item.anchor);option.value=item.anchor;line.append(option);}
  editPanel.hidden=!lines.length;selectLine();
 }
 resize();
}
function selectLine(){if(savingDoc)return;const selected=lines.find(item=>item.anchor===line.value);draft.value=selected?.markdown||"";saveDoc.hidden=true;diff.hidden=true;operation=null;}
line.onchange=()=>{if(draft.dataset.dirty==="true"){state.textContent="Keep your draft before choosing another line.";line.value=draft.dataset.anchor;return;}selectLine();};
draft.oninput=()=>{draft.dataset.dirty="true";draft.dataset.anchor=line.value;saveDoc.hidden=true;diff.hidden=true;operation=null;};
review.onclick=()=>{if(!doc||savingDoc)return;const old=lines.find(item=>item.anchor===line.value)?.markdown||"";diff.textContent="Before\n"+old+"\n\nAfter\n"+draft.value;diff.hidden=false;saveDoc.hidden=false;operation=crypto.randomUUID();resize();};
saveDoc.onclick=async()=>{
 if(!doc||savingDoc||!operation||draft.value.length>60000)return;savingDoc=true;saveDoc.disabled=true;review.disabled=true;line.disabled=true;
 try{const result=await request("tools/call",{name:"edit_doc",arguments:{doc:doc.id,version:doc.version,edits:[{op:"replace",block:line.value,markdown:draft.value}],client_ref:operation}});
  if(result.isError){draft.readOnly=true;state.textContent="Change not saved. Your draft is kept; reopen the page to check its revision.";return;}
  const value=result.structuredContent||{};
  if(!value.pending&&!Array.isArray(value.done)){draft.readOnly=true;state.textContent="Save outcome unavailable. Retry this change with its retained operation ID.";return;}
  state.textContent=value.pending?"Sent for review. Your draft is kept.":"Change recorded. Reopen the page before editing again.";
  saveDoc.hidden=true;review.disabled=true;operation=null;link("Open review",value.pending?.review_url||value.review_url);
 }catch{draft.readOnly=true;state.textContent="Save outcome unavailable. Your draft and operation ID are kept; retry this change.";}
 finally{savingDoc=false;saveDoc.disabled=false;if(operation)review.disabled=false;resize();}
};
`,
};

let runtimeHtml: string | null | undefined;
function localDiagramRuntime(): string {
  if (runtimeHtml !== undefined) return runtimeHtml ?? "";
  try {
    const asset = JSON.parse(
      readFileSync(
        new URL("../../../assets/mermaid-runtime.json", import.meta.url),
        "utf8",
      ),
    );
    runtimeHtml =
      typeof asset.html === "string" && asset.html.length <= 5000000
        ? asset.html
        : null;
  } catch {
    runtimeHtml = null;
  }
  return runtimeHtml ?? "";
}

export const APP_CARDS: Card[] = [TODAY, PLAN, REVIEW, MARKDOWN_FILE, RESULT];

/** The card a tool's answer can be shown in, if any. */
export const cardFor = (tool: string) =>
  APP_CARDS.find((c) => c.tools.includes(tool)) ?? null;

/** A tool's _meta pointing at its card (both spellings hosts read). */
export function toolUiMeta(tool: string): Record<string, unknown> | null {
  const card = cardFor(tool);
  return card
    ? { ui: { resourceUri: card.uri }, "ui/resourceUri": card.uri }
    : null;
}

/** A card's HTML page. */
export function cardHtml(card: Card): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${card.name}</title><style>${paletteCss()}${BASE_CSS}</style></head><body>${card.body}<script>${card === RESULT ? `const diagramRuntime=${JSON.stringify(localDiagramRuntime()).replace(/</g, "\\u003c")};` : ""}${BRIDGE}${card.script}</script></body></html>`;
}

/** resources/list entries for the cards. */
export const cardResources = () =>
  APP_CARDS.map((c) => ({
    uri: c.uri,
    name: c.name,
    description: c.description,
    mimeType: APP_MIME,
  }));

/** resources/read for a card, or null for any other address. */
export function readCard(uri: string) {
  const card = APP_CARDS.find((c) => c.uri === uri);
  if (!card) return null;
  return {
    contents: [
      {
        uri,
        mimeType: APP_MIME,
        text: cardHtml(card),
        // No outside connections or resources, and a frame around it.
        _meta: {
          ui: {
            csp: { connectDomains: [], resourceDomains: [] },
            prefersBorder: true,
          },
        },
      },
    ],
  };
}

/** Generic result card for registered domain tools without a specialized presentation. */
export const resultUiMeta = () => ({
  ui: { resourceUri: RESULT.uri },
  "ui/resourceUri": RESULT.uri,
});
