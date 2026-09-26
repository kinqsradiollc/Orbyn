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
  body: `<div class="card"><h1 id="title">Today</h1><p class="sub" id="sub"></p><div id="list"></div><div class="row"><button id="open">Open Today in Orbyn</button></div></div>`,
  script: `
let url=null;
document.getElementById("open").onclick=()=>url&&openLink(url);
function render(result){
  const s=result.structuredContent||{};url=s.url||null;
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

export const APP_CARDS: Card[] = [TODAY, PLAN, REVIEW];

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
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${card.name}</title><style>${paletteCss()}${BASE_CSS}</style></head><body>${card.body}<script>${BRIDGE}${card.script}</script></body></html>`;
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
