/* Report identifiers a module references but never declares or imports. */
const acorn = require("acorn"); const fs = require("fs");
const BROWSER = new Set(("window document console location history navigator setTimeout clearTimeout " +
  "setInterval clearInterval requestAnimationFrame cancelAnimationFrame localStorage sessionStorage " +
  "fetch URL Blob File FileReader FormData Image Event CustomEvent MouseEvent KeyboardEvent Promise " +
  "Set Map WeakMap WeakSet Array Object String Number Boolean Math JSON Date RegExp Error TypeError " +
  "RangeError Symbol Proxy Reflect parseInt parseFloat isNaN isFinite encodeURIComponent atob btoa " +
  "decodeURIComponent Uint8Array ArrayBuffer TextEncoder TextDecoder AbortController structuredClone " +
  "__PL require exports module globalThis undefined NaN Infinity alert confirm prompt getComputedStyle " +
  "DOMParser XMLSerializer SVGElement HTMLElement Node NodeList performance crypto queueMicrotask").split(/\s+/));

function undeclared(src) {
  const ast = acorn.parse(src, { ecmaVersion: 2022, sourceType: "script", allowReturnOutsideFunction: true });
  const found = new Map();
  const G = { vars: new Set(), parent: null };
  const decl = (s,n)=>{ if(n) s.vars.add(n); };
  const pat=(s,n)=>{ if(!n)return; switch(n.type){
    case "Identifier": decl(s,n.name); break;
    case "ObjectPattern": n.properties.forEach(p=>pat(s,p.type==="RestElement"?p.argument:p.value)); break;
    case "ArrayPattern": n.elements.forEach(e=>pat(s,e)); break;
    case "AssignmentPattern": pat(s,n.left); break;
    case "RestElement": pat(s,n.argument); break; } };
  function hoist(s, body){ const st=Array.isArray(body)?body.slice():[body];
    while(st.length){ const n=st.pop(); if(!n||!n.type) continue;
      if(n.type==="FunctionDeclaration"||n.type==="ClassDeclaration"){decl(s,n.id&&n.id.name);continue;}
      if(n.type==="VariableDeclaration"){n.declarations.forEach(d=>pat(s,d.id));continue;}
      for(const k in n){ if(["type","start","end"].includes(k))continue; const v=n[k];
        if(Array.isArray(v)) v.forEach(x=>x&&x.type&&st.push(x));
        else if(v&&v.type&&v.type!=="FunctionExpression"&&v.type!=="ArrowFunctionExpression") st.push(v);} } }
  const res=(s,n)=>{ for(let x=s;x;x=x.parent) if(x.vars.has(n)) return true; return false; };
  function walk(n, s){ if(!n||!n.type) return;
    switch(n.type){
      case "Program": hoist(s,n.body); n.body.forEach(c=>walk(c,s)); return;
      case "FunctionDeclaration": case "FunctionExpression": case "ArrowFunctionExpression": {
        const i={vars:new Set(),parent:s}; if(n.id&&n.type==="FunctionExpression")decl(i,n.id.name);
        n.params.forEach(p=>pat(i,p)); decl(i,"arguments");
        if(n.body.type==="BlockStatement"){hoist(i,n.body.body); n.body.body.forEach(c=>walk(c,i));}
        else walk(n.body,i); return; }
      case "BlockStatement": { const i={vars:new Set(),parent:s}; hoist(i,n.body); n.body.forEach(c=>walk(c,i)); return; }
      case "CatchClause": { const i={vars:new Set(),parent:s}; pat(i,n.param); hoist(i,n.body.body); n.body.body.forEach(c=>walk(c,i)); return; }
      case "MemberExpression": walk(n.object,s); if(n.computed) walk(n.property,s); return;
      case "Property": if(n.computed) walk(n.key,s); walk(n.value,s); return;
      case "VariableDeclarator": walk(n.init,s); return;
      case "BreakStatement": case "ContinueStatement": case "LabeledStatement": if(n.body) walk(n.body,s); return;
      case "Identifier":
        if(!res(s,n.name)&&!BROWSER.has(n.name)) found.set(n.name,(found.get(n.name)||0)+1);
        return; }
    for(const k in n){ if(["type","start","end"].includes(k))continue; const v=n[k];
      if(Array.isArray(v)) v.forEach(x=>x&&x.type&&walk(x,s)); else if(v&&v.type) walk(v,s); } }
  walk(ast,G); return found;
}
for (const f of process.argv.slice(2)) {
  const m = undeclared(fs.readFileSync(f,"utf8"));
  const list=[...m.entries()].sort((a,b)=>b[1]-a[1]);
  console.log(f.padEnd(16), list.length? list.map(([k,v])=>k+"("+v+")").join(" ") : "clean");
}
