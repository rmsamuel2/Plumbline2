/* ============================================================================
 * studio/modules/home.ts — Home screen
 * ----------------------------------------------------------------------------
 * Phase 1, step 5a. No declarations were moved into this file; the four
 * handlers below replace the [data-page] click delegate that loader.js used to
 * own, plus the three homeXxx button bindings that lived in init().
 *
 * Home's markup is static in shell.html (#homePage). This module shows and
 * hides it; it does not build it.
 *
 * VISIBILITY: toggles the "active" CLASS. studio.css:180-181 defines
 * .plPage{display:none} / .plPage.active{display:flex;flex-direction:column},
 * so setting style.display would either leave the page hidden or break the
 * flex column layout.
 *
 * Unlike analysis.ts, this module DOES unbind on unmount. It binds to a small,
 * fixed set of nodes and the symmetry costs nothing here; analysis binds ~30
 * listeners once because its nodes are equally permanent but re-binding them
 * per navigation would be wasteful. Both are correct for their case.
 * ==========================================================================*/
__PL.define("studio/modules/home.ts", function (require, exports, module) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });

var auth_1 = require("studio/shared/auth.ts");

function page() { return document.getElementById("homePage"); }

exports["default"] = {
  mount: function (outlet, params, ctx) {
    var self = this;
    this.bound = [];

    var on = function (id, fn) {
      var n = document.getElementById(id);
      if (!n) return;
      n.addEventListener("click", fn);
      self.bound.push([n, fn]);
    };

    var el = page();
    if (el) el.classList.add("active");

    on("homeLogin", function () { auth_1.showAuth(true); });

    /* Both intentionally inert - see the NOTATION comments in shell.html.
     * Preserved as no-ops so the buttons stay visibly present. */
    on("homeGuest", function () { });
    on("homeMaintenance", function () { });

    /* These two replace the [data-page] delegate deleted from loader.js. */
    on("btnOpenEditor", function () { ctx.navigate("/editor"); });
    on("btnOpenStudio", function () { ctx.navigate("/analysis"); });

    if (auth_1.renderUserBadge) auth_1.renderUserBadge();
  },

  unmount: function () {
    for (var i = 0; i < this.bound.length; i++)
      this.bound[i][0].removeEventListener("click", this.bound[i][1]);
    this.bound = [];
    var el = page();
    if (el) el.classList.remove("active");
  }
};

});
