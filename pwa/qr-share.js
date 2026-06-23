/* qr-share.js -- audience "scan to join" QR, shared across all PWA pages.
 *
 * Drop-in: include AFTER qrcode.min.js on any page. It injects
 *   1. a small always-visible QR badge in the corner ("qr on every page")
 *   2. a full-screen popup with a big QR + the join URL ("one that pops up")
 *
 * The QR is generated locally (qrcode-generator) so it works on a LAN-only
 * rig with no internet -- nothing is sent to a third-party image API.
 *
 * The encoded URL is always the AUDIENCE page (index.html) at the current
 * origin, with any ?admin=/query string stripped, so the performer token is
 * never baked into a QR that the audience scans.
 */
(function () {
  'use strict';

  if (typeof qrcode !== 'function') {
    console.warn('[qr-share] qrcode.min.js not loaded; QR disabled');
    return;
  }

  // Audience join URL: same origin, index.html, no query/hash.
  function joinUrl() {
    try {
      const u = new URL('index.html', location.href);
      u.search = '';
      u.hash = '';
      return u.href;
    } catch (e) {
      return location.origin + '/index.html';
    }
  }

  // Build a QR data URL for the given text at the given cell size.
  function qrDataUrl(text, cellSize) {
    const qr = qrcode(0, 'M');     // type 0 = auto-fit, 'M' = ~15% error correction
    qr.addData(text);
    qr.make();
    return qr.createDataURL(cellSize, 4 /* margin cells */);
  }

  // ---- styles -------------------------------------------------------------
  const css = `
  .qrs-badge {
    position: fixed;
    left: 12px; bottom: 12px;
    z-index: 1100;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    padding: 6px;
    background: var(--panel, #141418);
    border: 1px solid var(--line, #2a2a30);
    border-radius: 10px;
    cursor: pointer;
    box-shadow: 0 4px 16px rgba(0,0,0,0.5);
    transition: border-color 80ms, transform 80ms;
  }
  .qrs-badge:active { transform: scale(0.96); }
  .qrs-badge:hover { border-color: var(--accent, #ff3b30); }
  .qrs-badge img { width: 64px; height: 64px; display: block; image-rendering: pixelated; border-radius: 3px; }
  .qrs-badge .qrs-cap {
    font-family: var(--font-display, monospace);
    font-size: 8px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--text-dim, #8a8a92);
  }

  .qrs-modal {
    position: fixed;
    inset: 0;
    z-index: 2000;
    display: none;
    align-items: center;
    justify-content: center;
    background: rgba(0,0,0,0.92);
    padding: 20px;
  }
  .qrs-modal.open { display: flex; }

  .qrs-card {
    background: var(--panel, #141418);
    border: 1px solid var(--accent, #ff3b30);
    border-radius: 14px;
    padding: 22px 22px 18px;
    max-width: 92vw;
    text-align: center;
    box-shadow: 0 10px 40px rgba(0,0,0,0.6);
  }
  .qrs-card h3 {
    font-family: var(--font-display, monospace);
    font-size: 13px;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--text, #e8e8ec);
    margin: 0 0 14px 0;
  }
  .qrs-card h3 .qrs-bars { color: var(--accent, #ff3b30); }
  .qrs-card img {
    width: min(72vw, 320px);
    height: min(72vw, 320px);
    display: block;
    margin: 0 auto;
    background: #fff;
    padding: 10px;
    border-radius: 8px;
    image-rendering: pixelated;
  }
  .qrs-url {
    font-family: var(--font-display, monospace);
    font-size: 12px;
    color: var(--accent, #ff3b30);
    margin-top: 14px;
    word-break: break-all;
  }
  .qrs-steps {
    margin: 14px 0 0 0;
    padding: 0;
    list-style: none;
    text-align: left;
    font-family: var(--font-display, monospace);
    font-size: 11px;
    color: var(--text-dim, #8a8a92);
    line-height: 1.7;
  }
  .qrs-steps li::before {
    content: attr(data-n) ". ";
    color: var(--accent, #ff3b30);
    font-weight: bold;
  }

  .qrs-close {
    margin-top: 16px;
    background: var(--bg, #0a0a0c);
    border: 1px solid var(--line, #2a2a30);
    color: var(--text, #e8e8ec);
    font-family: var(--font-display, monospace);
    font-size: 11px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    padding: 11px 22px;
    border-radius: 6px;
    cursor: pointer;
  }
  .qrs-close:active { background: var(--accent-dim, #5a1512); border-color: var(--accent, #ff3b30); }
  `;

  function injectStyles() {
    const s = document.createElement('style');
    s.textContent = css;
    document.head.appendChild(s);
  }

  // ---- build DOM ----------------------------------------------------------
  function build() {
    injectStyles();
    const url = joinUrl();

    // Corner badge (small QR, always visible)
    const badge = document.createElement('div');
    badge.className = 'qrs-badge';
    badge.setAttribute('role', 'button');
    badge.setAttribute('aria-label', 'Show join QR code');
    badge.innerHTML =
      '<img alt="join QR" src="' + qrDataUrl(url, 2) + '">' +
      '<span class="qrs-cap">SCAN TO JOIN</span>';

    // Popup modal (big QR)
    const modal = document.createElement('div');
    modal.className = 'qrs-modal';
    modal.innerHTML =
      '<div class="qrs-card">' +
        '<h3><span class="qrs-bars">|||</span> SCAN TO JOIN <span class="qrs-bars">|||</span></h3>' +
        '<img alt="join QR" src="' + qrDataUrl(url, 8) + '">' +
        '<div class="qrs-url">' + url + '</div>' +
        '<ol class="qrs-steps">' +
          '<li data-n="1">Turn off mobile data / cellular service on your phone</li>' +
          '<li data-n="2">Connect to the <strong>1200</strong> Wi-Fi network</li>' +
          '<li data-n="3">Scan the QR code above or type the URL into your browser</li>' +
        '</ol>' +
        '<button class="qrs-close" type="button">CLOSE</button>' +
      '</div>';

    function open() { modal.classList.add('open'); }
    function close() { modal.classList.remove('open'); }

    badge.addEventListener('click', open);
    modal.addEventListener('click', function (e) {
      if (e.target === modal) close();              // tap backdrop to dismiss
    });
    modal.querySelector('.qrs-close').addEventListener('click', close);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') close();
    });

    document.body.appendChild(badge);
    document.body.appendChild(modal);

    // expose for nav links / other code, e.g. onclick="qrShareOpen()"
    window.qrShareOpen = open;
    window.qrShareClose = close;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', build);
  } else {
    build();
  }
})();
