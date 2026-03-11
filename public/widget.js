(function() {
  'use strict';
  const SAFETRADE_URL = 'http://localhost:3000';

  const style = document.createElement('style');
  style.textContent = `
    .unboxproof-btn{display:inline-flex;align-items:center;gap:8px;background:linear-gradient(135deg,#4f46e5,#7c3aed);color:white;border:none;padding:12px 24px;border-radius:10px;font-size:15px;font-weight:600;cursor:pointer;transition:all .2s;font-family:-apple-system,sans-serif;text-decoration:none}
    .unboxproof-btn:hover{transform:translateY(-2px);box-shadow:0 8px 20px rgba(79,70,229,0.4)}
    .unboxproof-badge{display:inline-flex;align-items:center;gap:6px;background:#f0fdf4;border:1px solid #bbf7d0;color:#059669;padding:4px 12px;border-radius:100px;font-size:13px;font-weight:500;font-family:-apple-system,sans-serif;margin-top:8px}
    .unboxproof-overlay{position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:99999;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(4px)}
    .unboxproof-modal{background:white;border-radius:20px;padding:40px;max-width:480px;width:90%;box-shadow:0 40px 80px rgba(0,0,0,0.3);animation:st-up .3s ease;position:relative}
    @keyframes st-up{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}
    .unboxproof-modal h2{font-size:22px;font-weight:800;color:#1e293b;margin:0 0 8px}
    .unboxproof-modal p{color:#64748b;font-size:14px;margin:0 0 24px;line-height:1.6}
    .unboxproof-code-box{background:#f0f0ff;border:2px dashed #4f46e5;border-radius:12px;padding:20px;text-align:center;margin:20px 0}
    .unboxproof-code{font-size:32px;font-weight:900;letter-spacing:8px;color:#4f46e5;font-family:monospace}
    .unboxproof-code-label{font-size:12px;color:#64748b;margin-top:6px}
    .unboxproof-close{position:absolute;top:14px;right:14px;background:#f1f5f9;border:none;width:32px;height:32px;border-radius:50%;cursor:pointer;font-size:16px;display:flex;align-items:center;justify-content:center}
    .unboxproof-open-btn{display:block;width:100%;background:linear-gradient(135deg,#4f46e5,#7c3aed);color:white;padding:14px;border-radius:10px;font-weight:600;font-size:15px;text-align:center;text-decoration:none;margin-top:16px;box-sizing:border-box}
    .unboxproof-powered{text-align:center;font-size:11px;color:#94a3b8;margin-top:16px}
  `;
  document.head.appendChild(style);

  window.UnboxProof = {
    apiKey: null,

    init(config) {
      this.apiKey = config.apiKey || '';
      document.querySelectorAll('[data-unboxproof-order]').forEach(el => this.attachButton(el));
    },

    attachButton(container) {
      const orderId = container.dataset.unboxproofOrder;
      const wrap = document.createElement('div');

      const btn = document.createElement('button');
      btn.className = 'unboxproof-btn';
      btn.innerHTML = '🛡️ Faire mon unboxing sécurisé';
      btn.onclick = () => this.openModal(orderId);

      const badge = document.createElement('div');
      badge.className = 'unboxproof-badge';
      badge.innerHTML = '✓ Achat protégé par UnboxProof';

      wrap.appendChild(btn);
      wrap.appendChild(document.createElement('br'));
      wrap.appendChild(badge);
      container.appendChild(wrap);
    },

    openModal(orderId) {
      const overlay = document.createElement('div');
      overlay.className = 'unboxproof-overlay';
      overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };

      overlay.innerHTML = `
        <div class="unboxproof-modal">
          <button class="unboxproof-close" onclick="this.closest('.unboxproof-overlay').remove()">×</button>
          <h2>🛡️ Unboxing UnboxProof</h2>
          <p>Filmez l'ouverture de votre colis avec le code visible pour valider votre réception.</p>
          <div id="st-content-${orderId}"><div style="text-align:center;padding:20px;color:#64748b">Chargement...</div></div>
          <div class="unboxproof-powered">Sécurisé par <strong>UnboxProof</strong></div>
        </div>`;
      document.body.appendChild(overlay);

      fetch(`${SAFETRADE_URL}/api/b2b/customer/${orderId}`)
        .then(r => r.json())
        .then(order => {
          document.getElementById(`st-content-${orderId}`).innerHTML = `
            <div class="unboxproof-code-box">
              <div class="unboxproof-code">${order.verification_code || '----'}</div>
              <div class="unboxproof-code-label">⚠️ Notez ce code — montrez-le dans votre vidéo</div>
            </div>
            <a href="${SAFETRADE_URL}/unboxing-customer.html?order=${orderId}" target="_blank" class="unboxproof-open-btn">🎥 Ouvrir la page d'unboxing →</a>`;
        })
        .catch(() => {
          document.getElementById(`st-content-${orderId}`).innerHTML = '<p style="color:#dc2626;text-align:center">Erreur de chargement</p>';
        });
    }
  };

  console.log('%c✅ UnboxProof Widget v1.0 chargé', 'color:#4f46e5;font-weight:bold');
})();
