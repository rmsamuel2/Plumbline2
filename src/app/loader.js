
    (function(){
      /* Phase 1: this file no longer routes. The router owns which screen is
         shown; loader.js is reduced to what only it can do - decoding the
         base64 editor document into a blob URL for the iframe, and relaying
         the two messages the editor document sends to its parent. */
      var editorLoaded = false;
      function loadEditor(){
        if(editorLoaded) return;
        var node = document.getElementById('workflowEditorHtmlB64');
        var frame = document.getElementById('workflowEditorFrame');
        if(!node || !frame) return;
        try{
          var raw = atob((node.textContent || '').trim());
          var bytes = new Uint8Array(raw.length);
          for(var i=0;i<raw.length;i++) bytes[i] = raw.charCodeAt(i);
          var url = URL.createObjectURL(new Blob([bytes], {type:'text/html;charset=utf-8'}));
          frame.src = url;
          frame.addEventListener('load', function(){
            if (typeof window.plumblineBroadcastAuth === 'function')
              setTimeout(window.plumblineBroadcastAuth, 120);
          });
          editorLoaded = true;
        }catch(err){
          frame.srcdoc = '<!doctype html><meta charset="utf-8"><body style="font:14px system-ui;padding:24px;color:#16243B"><h1>Workflow Editor failed to load</h1><p>'+String(err && err.message || err)+'</p></body>';
        }
      }
      window.addEventListener('message', function(ev){
        var d = ev && ev.data;
        if(!d) return;
        /* The editor document still sends {type:'plumbline-nav', page:'studio'}.
           Translate to a route rather than teaching the editor about hashes. */
        if(d.type === 'plumbline-nav' && d.page) {
          var map = { home:'/home', editor:'/editor', studio:'/analysis' };
          location.hash = '#' + (map[d.page] || '/home');
          return;
        }
        if(d.type === 'plumbline-library'){
          /* The editor asked for the workflow library. editor.ts owns the
             flush-then-open sequence; loader.js only relays. */
          var m = window.__PL && window.__PL.load('studio/modules/editor.ts');
          if (m && m.openLibraryFromEditor) m.openLibraryFromEditor();
          return;
        }
        if(d.type !== 'plumbline-auth') return;
        setTimeout(function(){
          if (typeof window.plumblineShowAuth === 'function') { window.plumblineShowAuth(true); return; }
          var b = document.getElementById('btnLogin');
          if(b) b.click();
        }, 60);
      });
      /* Kept for the editor document, which may call it by name. */
      window.plumblineShowPage = function(name){
        var map = { home:'/home', editor:'/editor', studio:'/analysis' };
        location.hash = '#' + (map[name] || '/home');
      };
      window.plumblineEnsureEditorLoaded = loadEditor;
      /* Pre-load at startup so the editor's active process is available to the
         Analysis screen even when the user never opens the Editor. */
      loadEditor();
    })();
