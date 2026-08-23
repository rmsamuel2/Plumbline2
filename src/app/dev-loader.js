/* Dev loader for plumbline-dev.html.
 *
 * Identical page-router logic to the production loader.js, with one change:
 * the Workflow Editor iframe is loaded from the RELATIVE FILE
 * (editor/Plumbline-editor.html) instead of being decoded from an embedded
 * base64 blob. The editor is also pre-loaded at startup so the Analysis
 * Studio can sync with it even if you open the Studio page first.
 *
 * Editor <-> Analysis sync works exactly as in the built single file:
 *   - the editor pushes debounced "plumbline-editor-data" snapshots to
 *     window.parent on every change;
 *   - entering the Studio page calls plumblineRequestEditorSync, which posts
 *     "plumbline-request-editor-data" into the iframe and the editor replies
 *     with a fresh snapshot (openAnalysis preserved).
 * Both paths are postMessage-based with "*" targeting, so they work from
 * file:// as well as from a local web server. (The additional same-origin
 * fast path — calling frame.contentWindow.plumblineExportForAnalysis()
 * directly — engages automatically when you serve over http, e.g.
 * `python3 -m http.server` in the src/ directory.)
 */

    (function(){
      var editorLoaded = false;
      function loadEditor(){
        if(editorLoaded) return;
        var frame = document.getElementById('workflowEditorFrame');
        if(!frame) return;
        frame.src = 'editor/workflow-editor.html?v=' + Date.now();
        frame.addEventListener('load', function(){
          if (typeof window.plumblineBroadcastAuth === 'function')
            setTimeout(window.plumblineBroadcastAuth, 120);
        });
        editorLoaded = true;
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
        if(d && d.type === 'plumbline-editor-ready') {
          if (typeof window.plumblineBroadcastAuth === 'function')
            setTimeout(window.plumblineBroadcastAuth, 0);
          return;
        }
        if(!d || d.type !== 'plumbline-auth') return;
        setTimeout(function(){
          if (typeof window.plumblineShowAuth === 'function') { window.plumblineShowAuth(true); return; }
          var b = document.getElementById('btnLogin');
          if(b) b.click();
        }, 60);
      });
      window.plumblineShowPage = showPage;
      loadEditor(); // dev: pre-load the editor so Studio can sync immediately
      // Always boot to the home page (mirrors the production loader).
      showPage('home');
    })();
