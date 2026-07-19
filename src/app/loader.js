
    (function(){
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
      function showPage(name){
        if(!name) name='home';
        ['home','editor','studio'].forEach(function(p){
          var el = document.getElementById(p+'Page');
          if(el) el.classList.toggle('active', p===name);
        });
        if(name==='editor') loadEditor();
        if(name==='studio' && typeof window.plumblineRequestEditorSync === 'function'){
          try{ window.plumblineRequestEditorSync({openAnalysis:true}); }catch(e){}
        }
        try{ localStorage.setItem('plumbline_page', name); }catch(e){}
      }
      document.addEventListener('click', function(e){
        var t = e.target && e.target.closest ? e.target.closest('[data-page]') : null;
        if(!t) return;
        e.preventDefault();
        showPage(t.getAttribute('data-page'));
      });
      window.addEventListener('message', function(ev){
        var d = ev && ev.data;
        if(!d) return;
        if(d.type === 'plumbline-nav' && d.page) { showPage(d.page); return; }
        if(d.type !== 'plumbline-auth') return;
        setTimeout(function(){
          if (typeof window.plumblineShowAuth === 'function') { window.plumblineShowAuth(true); return; }
          var b = document.getElementById('btnLogin');
          if(b) b.click();
        }, 60);
      });
      window.plumblineShowPage = showPage;
      // Pre-load the Workflow Editor at startup so its active process is
      // always available to the Analysis Studio, even when the Studio page
      // is opened first (the editor pushes a snapshot after its first render).
      loadEditor();
      // Always boot to the home page (shell.html's homePage container).
      // The last-visited page is still saved by showPage() and available to
      // any code that wants it, but it is no longer restored on startup.
      showPage('home');
    })();
  