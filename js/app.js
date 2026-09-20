/* =========================================================
   IA ACADEMY — logique de l'application
   ========================================================= */

const content = document.getElementById("content");
const sidebarLinks = document.querySelectorAll(".sidebar a");

/* ---------- Thème clair/sombre ---------- */
const themeToggle = document.getElementById("themeToggle");
function applyTheme(t){
  document.documentElement.setAttribute("data-theme", t);
  themeToggle.textContent = t === "dark" ? "☀️" : "🌙";
  try{ localStorage.setItem("ia-academy-theme", t); }catch(e){}
}
(function initTheme(){
  let saved = "light";
  try{ saved = localStorage.getItem("ia-academy-theme") || "light"; }catch(e){}
  applyTheme(saved);
})();
themeToggle.addEventListener("click", ()=>{
  const current = document.documentElement.getAttribute("data-theme");
  applyTheme(current === "dark" ? "light" : "dark");
});

/* ---------- Menu mobile ---------- */
const menuToggle = document.getElementById("menuToggle");
const sidebar = document.getElementById("sidebar");
menuToggle.addEventListener("click", ()=> sidebar.classList.toggle("open"));
sidebar.addEventListener("click", (e)=>{
  if(e.target.tagName === "A") sidebar.classList.remove("open");
});

/* ---------- Progression (localStorage) ---------- */
function getProgress(){
  try{ return JSON.parse(localStorage.getItem("ia-academy-progress")) || {}; }
  catch(e){ return {}; }
}
function saveProgress(p){
  try{ localStorage.setItem("ia-academy-progress", JSON.stringify(p)); }catch(e){}
}

/* ---------- Routeur ---------- */
const ROUTES = {
  accueil: renderAccueil,
  actu: renderActu,
  concepts: renderConcepts,
  comparatif: renderComparatif,
  prompting: renderPrompting,
  usages: renderUsages,
  local: renderLocal,
  exercices: renderExercices,
  glossaire: renderGlossaire,
  formation: renderFormation
};

function navigate(){
  const hash = (location.hash || "#accueil").replace("#","");
  const route = ROUTES[hash] ? hash : "accueil";
  sidebarLinks.forEach(a=> a.classList.toggle("active", a.dataset.nav === route));
  content.innerHTML = "";
  ROUTES[route]();
  window.scrollTo({top:0, behavior:"instant"});
}
window.addEventListener("hashchange", navigate);
window.addEventListener("DOMContentLoaded", navigate);

/* ---------- Helpers ---------- */
function el(html){
  const div = document.createElement("div");
  div.innerHTML = html.trim();
  return div.firstElementChild;
}
function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}

/* =========================================================
   1. ACCUEIL
   ========================================================= */
function renderAccueil(){
  content.appendChild(el(`
    <div>
      <div class="home-hero">
        <h1>Bienvenue sur IA Academy 🤖</h1>
        <p>Une appli pour tout comprendre sur l'intelligence artificielle : les actus, les concepts expliqués simplement,
        le comparatif des outils (gratuit/payant), comment écrire un bon prompt, où l'IA est déjà utilisée,
        comment en faire tourner une chez toi, et des exercices pour t'entraîner vraiment.<br><br>
        Dernière mise à jour du contenu : <b>${APP_META.lastUpdate}</b>. ${APP_META.note}</p>
      </div>
      <div class="grid grid-3" id="homeCards"></div>
    </div>
  `));

  const cards = [
    {href:"#actu", emoji:"📰", titre:"Actualités & frise", desc:"Où en est l'IA aujourd'hui, repères historiques, et où suivre les vraies nouveautés."},
    {href:"#concepts", emoji:"📚", titre:"Comprendre l'IA", desc:"Tous les concepts et mots compliqués expliqués simplement, avec des analogies."},
    {href:"#comparatif", emoji:"⚖️", titre:"Comparatif des IA", desc:"ChatGPT, Claude, Gemini, Mistral... gratuit ou payant, pour quoi faire ?"},
    {href:"#prompting", emoji:"🎯", titre:"Prompt Engineering", desc:"Les techniques + un générateur de prompt interactif (Prompt Canvas)."},
    {href:"#usages", emoji:"🛠️", titre:"Cas d'usage", desc:"Tout ce que l'IA fait déjà, secteur par secteur, avec des exemples concrets."},
    {href:"#local", emoji:"💻", titre:"IA en local", desc:"Le tuto pas-à-pas pour faire tourner une IA gratuitement sur ton ordinateur."},
    {href:"#exercices", emoji:"🏋️", titre:"Exercices & quiz", desc:"Teste tes connaissances et entraîne-toi à écrire de bons prompts."},
    {href:"#glossaire", emoji:"📖", titre:"Glossaire", desc:"Tous les termes techniques, cherchables, expliqués en une phrase."},
    {href:"#formation", emoji:"🚀", titre:"Se former / Carrière", desc:"Un parcours débutant → avancé, les métiers de l'IA, les ressources pour aller loin."}
  ];
  const grid = document.getElementById("homeCards");
  cards.forEach(c=>{
    grid.appendChild(el(`
      <a class="nav-card" href="${c.href}">
        <span class="emoji">${c.emoji}</span>
        <h3>${c.titre}</h3>
        <p>${c.desc}</p>
      </a>
    `));
  });
}

/* =========================================================
   2. ACTUALITÉS & FRISE HISTORIQUE
   ========================================================= */
function renderActu(){
  content.appendChild(el(`<h2 class="section-title">📰 Actualités & repères historiques</h2>`));
  content.appendChild(el(`<p class="section-sub">Dernière vraie recherche web effectuée le <b>${APP_META.lastLiveSearch}</b>. L'IA évolue vite : utilise le bouton ci-dessous pour tenter un rafraîchissement en direct, ou le prompt fourni pour demander une mise à jour complète.</p>`));

  /* --- Actus récentes (issues d'une vraie recherche web) --- */
  content.appendChild(el(`<div class="card"><h3>🗞️ Actus récentes <span class="tag">màj ${APP_META.lastLiveSearch}</span></h3><div id="actusRecentes"></div></div>`));
  const actusDiv = document.getElementById("actusRecentes");
  ACTUS_RECENTES.slice().sort((a,b)=> b.date.localeCompare(a.date)).forEach(a=>{
    actusDiv.appendChild(el(`
      <details class="concept-item" style="border-bottom:1px solid var(--border); padding-bottom:10px;">
        <summary>${a.titre} <span class="badge">${a.date}</span></summary>
        <div class="concept-body">
          <p>${a.resume}</p>
          <p><b>💡 Pourquoi c'est important :</b> ${a.explication}</p>
          <p style="font-size:.85rem;">Source : <a href="${a.url}" target="_blank" rel="noopener noreferrer" style="color:var(--accent);">${a.source} →</a></p>
        </div>
      </details>
    `));
  });

  /* --- Bouton "chercher les toutes dernières actus" (fetch live best-effort) --- */
  content.appendChild(el(`
    <div class="card">
      <h3>🔄 Chercher les toutes dernières actus</h3>
      <p class="section-sub" style="margin-bottom:14px;">
        Cette appli est un simple site statique (pas de serveur), donc elle ne peut pas interroger une IA toute seule.
        Le bouton ci-dessous tente de récupérer en direct, depuis ton navigateur, les derniers titres publiés sur les blogs officiels.
        Si ton navigateur bloque la requête (protection de sécurité normale), utilise le prompt copiable juste en dessous :
        colle-le dans une session Claude (par ex. Claude Code sur ce projet) pour obtenir une vraie mise à jour, sourcée et expliquée,
        écrite directement dans l'appli — exactement comme pour la liste ci-dessus.
      </p>
      <div style="display:flex; gap:10px; flex-wrap:wrap; margin-bottom:10px;">
        <button class="btn" id="liveFetchBtn">🔄 Chercher maintenant (en direct)</button>
        <button class="btn secondary" id="copyPromptBtn">📋 Copier le prompt de mise à jour pour Claude</button>
      </div>
      <div id="liveFetchStatus" style="color:var(--text-muted); font-size:.85rem; margin-bottom:6px;"></div>
      <div id="liveFetchResults"></div>
      <details style="margin-top:10px;">
        <summary style="cursor:pointer; color:var(--accent); font-weight:600; font-size:.85rem;">Voir le prompt de mise à jour</summary>
        <div class="output-box">${escapeHtml(PROMPT_MAJ_ACTUS)}</div>
      </details>
    </div>
  `));

  document.getElementById("copyPromptBtn").addEventListener("click", (e)=>{
    navigator.clipboard.writeText(PROMPT_MAJ_ACTUS).then(()=>{
      const old = e.target.textContent;
      e.target.textContent = "✅ Prompt copié !";
      setTimeout(()=> e.target.textContent = old, 1800);
    }).catch(()=>{});
  });

  document.getElementById("liveFetchBtn").addEventListener("click", async (e)=>{
    const btn = e.target;
    const status = document.getElementById("liveFetchStatus");
    const results = document.getElementById("liveFetchResults");
    btn.disabled = true;
    btn.textContent = "⏳ Recherche en cours...";
    status.textContent = "Interrogation des blogs officiels depuis ton navigateur...";
    results.innerHTML = "";

    const found = await fetchLiveHeadlines();

    btn.disabled = false;
    btn.textContent = "🔄 Chercher maintenant (en direct)";

    if(found.length === 0){
      status.innerHTML = `⚠️ Ton navigateur a bloqué toutes les requêtes (protection CORS/vie privée, courant en navigation privée ou avec un bloqueur de pub). Utilise le bouton « Copier le prompt » ci-dessus à la place : c'est la méthode fiable.`;
      return;
    }
    status.textContent = `${found.length} titre(s) récupéré(s) en direct à l'instant (aperçu brut, non résumé par une IA) :`;
    found.forEach(h=>{
      results.appendChild(el(`
        <div class="card" style="margin-bottom:8px; padding:12px 16px;">
          <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:10px; flex-wrap:wrap;">
            <a href="${h.url}" target="_blank" rel="noopener noreferrer" style="font-weight:600; color:var(--text);">${escapeHtml(h.titre)}</a>
            <button class="btn small secondary" data-explain="${encodeURIComponent(h.titre)}" data-url="${encodeURIComponent(h.url)}">🧠 Demande une explication</button>
          </div>
          <p style="margin:6px 0 0; font-size:.78rem; color:var(--text-muted);">Source : ${h.source}</p>
        </div>
      `));
    });
    results.querySelectorAll("[data-explain]").forEach(b=>{
      b.addEventListener("click", ()=>{
        const titre = decodeURIComponent(b.dataset.explain);
        const url = decodeURIComponent(b.dataset.url);
        const prompt = `Explique-moi cette actualité IA : "${titre}" (source : ${url}).\nDonne le contexte, pourquoi c'est important, et ce que ça change concrètement, en français simple, en moins de 150 mots.`;
        navigator.clipboard.writeText(prompt).then(()=>{
          const old = b.textContent;
          b.textContent = "✅ Copié !";
          setTimeout(()=> b.textContent = old, 1800);
        }).catch(()=>{});
      });
    });
  });

  /* --- Frise historique --- */
  content.appendChild(el(`<div class="card"><h3>🕰️ Frise historique</h3><div class="timeline" id="frise"></div></div>`));
  const frise = document.getElementById("frise");
  FRISE_HISTORIQUE.forEach(item=>{
    frise.appendChild(el(`
      <div class="timeline-item">
        <div class="date">${item.date}</div>
        <p>${item.texte}</p>
      </div>
    `));
  });

  content.appendChild(el(`<div class="card"><h3>🔔 Rester à jour en continu</h3><p class="section-sub" style="margin-bottom:14px;">Ajoute ces pages à tes favoris ou dans un lecteur RSS pour suivre les vraies annonces au fur et à mesure qu'elles sortent.</p><div id="sources" class="grid grid-2"></div></div>`));
  const sources = document.getElementById("sources");
  SOURCES_ACTU.forEach(s=>{
    sources.appendChild(el(`
      <div class="card tool-links" style="margin-bottom:0;">
        <h4 style="margin:0 0 6px;">${s.nom}</h4>
        <p style="margin:0 0 8px; color:var(--text-muted); font-size:.88rem;">${s.desc}</p>
        <a href="${s.url}" target="_blank" rel="noopener noreferrer">${s.url} →</a>
      </div>
    `));
  });

  content.appendChild(el(`
    <div class="card">
      <h3>💡 Autres façons de suivre l'actu IA</h3>
      <ul style="line-height:1.8; color:var(--text-muted);">
        <li>Newsletters spécialisées IA (cherche "newsletter intelligence artificielle" pour trouver celles en français les plus suivies du moment).</li>
        <li>Chaînes YouTube et podcasts tech qui couvrent l'actu IA chaque semaine.</li>
        <li>Les pages "Nouveautés" / "Changelog" de chaque outil que tu utilises (ChatGPT, Claude, etc.) — souvent accessibles directement depuis leur site.</li>
        <li>Demander directement à une IA récente : « Quelles sont les dernières annonces majeures en IA ce mois-ci ? » (via un outil qui a accès à la recherche web, comme Perplexity).</li>
      </ul>
    </div>
  `));
}

/* --- Récupération best-effort de titres en direct via un lecteur web CORS-friendly ---
   Les blogs officiels n'autorisent généralement pas les requêtes cross-origin
   depuis un navigateur (protection CORS). On passe donc par r.jina.ai, un
   service public qui renvoie le contenu texte d'une page. Si ce service est
   indisponible ou bloqué, on renvoie simplement un tableau vide : l'appli
   affiche alors le message de repli (voir liveFetchBtn ci-dessus). */
async function fetchLiveHeadlines(){
  const linkRegex = /\[([^\[\]]{15,140})\]\((https?:\/\/[^\s)]+)\)/g;
  const skipWords = /cookie|privacy|se connecter|sign in|log in|subscribe|s'abonner|twitter|linkedin|facebook|instagram|youtube|accueil|home|about|à propos|contact|careers|carrière|terms|mentions légales/i;

  const perSource = await Promise.allSettled(SOURCES_ACTU.map(async (source)=>{
    const controller = new AbortController();
    const timeout = setTimeout(()=> controller.abort(), 8000);
    try{
      const res = await fetch("https://r.jina.ai/" + source.url, { signal: controller.signal });
      clearTimeout(timeout);
      if(!res.ok) return [];
      const text = await res.text();
      const seen = new Set();
      const items = [];
      let m;
      while((m = linkRegex.exec(text)) !== null && items.length < 3){
        const titre = m[1].trim();
        const url = m[2].trim();
        if(skipWords.test(titre)) continue;
        if(seen.has(titre)) continue;
        seen.add(titre);
        items.push({ titre, url, source: source.nom });
      }
      return items;
    }catch(err){
      clearTimeout(timeout);
      return [];
    }
  }));

  return perSource.flatMap(r => r.status === "fulfilled" ? r.value : []);
}

/* =========================================================
   3. CONCEPTS
   ========================================================= */
function renderConcepts(){
  content.appendChild(el(`<h2 class="section-title">📚 Comprendre l'IA</h2>`));
  content.appendChild(el(`<p class="section-sub">Chaque concept est expliqué en langage simple, avec une analogie et un exemple concret. Clique pour déplier.</p>`));
  content.appendChild(el(`<input type="text" class="search-box" id="conceptSearch" placeholder="🔍 Rechercher un concept (ex : token, hallucination, agent...)">`));
  content.appendChild(el(`<div id="conceptList"></div>`));

  function draw(filter=""){
    const list = document.getElementById("conceptList");
    list.innerHTML = "";
    const f = filter.toLowerCase();
    const filtered = CONCEPTS.filter(c => c.titre.toLowerCase().includes(f) || c.def.toLowerCase().includes(f));
    if(filtered.length === 0){
      list.appendChild(el(`<p class="section-sub">Aucun résultat.</p>`));
      return;
    }
    filtered.forEach(c=>{
      list.appendChild(el(`
        <details class="card concept-item">
          <summary>${c.titre} <span class="badge ${c.niveau}">${c.niveau}</span></summary>
          <div class="concept-body">
            <p><b>Définition simple :</b> ${c.def}</p>
            <p><b>Analogie :</b> ${c.analogie}</p>
            <p><b>Exemple :</b> ${c.exemple}</p>
          </div>
        </details>
      `));
    });
  }
  draw();
  document.getElementById("conceptSearch").addEventListener("input", (e)=> draw(e.target.value));
}

/* =========================================================
   4. COMPARATIF DES IA
   ========================================================= */
function renderComparatif(){
  content.appendChild(el(`<h2 class="section-title">⚖️ Comparatif des IA</h2>`));
  content.appendChild(el(`<p class="section-sub">Quelle IA utiliser, pour quoi, gratuite ou payante ? Filtre par catégorie pour comparer.</p>`));

  const cats = ["tout","texte","image","audio","video","code","recherche","tout-en-un"];
  const filtersDiv = el(`<div class="filters" id="filters"></div>`);
  content.appendChild(filtersDiv);
  cats.forEach(c=>{
    filtersDiv.appendChild(el(`<button class="filter-btn ${c==='tout'?'active':''}" data-cat="${c}">${c}</button>`));
  });

  content.appendChild(el(`<div class="card" style="overflow-x:auto;"><table id="compTable"></table></div>`));

  function draw(cat="tout"){
    const table = document.getElementById("compTable");
    const rows = OUTILS_IA.filter(o => cat === "tout" || o.categorie === cat);
    table.innerHTML = `
      <thead><tr>
        <th>Nom</th><th>Entreprise</th><th>Catégorie</th><th>Gratuit</th><th>Payant</th><th>Points forts</th><th>Idéal pour</th>
      </tr></thead>
      <tbody>
        ${rows.map(o=>`
          <tr>
            <td><b>${o.nom}</b></td>
            <td>${o.entreprise}</td>
            <td><span class="tag">${o.categorie}</span></td>
            <td>${o.gratuit ? "✅" : "❌"}</td>
            <td>${o.payant}</td>
            <td>${o.forces}</td>
            <td>${o.idealPour}</td>
          </tr>
        `).join("")}
      </tbody>
    `;
  }
  draw();
  filtersDiv.addEventListener("click", (e)=>{
    if(e.target.tagName !== "BUTTON") return;
    filtersDiv.querySelectorAll(".filter-btn").forEach(b=>b.classList.remove("active"));
    e.target.classList.add("active");
    draw(e.target.dataset.cat);
  });
}

/* =========================================================
   5. PROMPT ENGINEERING + PROMPT CANVAS
   ========================================================= */
function renderPrompting(){
  content.appendChild(el(`<h2 class="section-title">🎯 Prompt Engineering</h2>`));
  content.appendChild(el(`<p class="section-sub">Bien écrire un prompt change radicalement la qualité des réponses. Voici les techniques clés, une bibliothèque de gabarits, et un générateur interactif : le <b>Prompt Canvas</b>.</p>`));

  // Techniques
  const techGrid = el(`<div class="grid grid-2" id="techGrid"></div>`);
  content.appendChild(el(`<h3>🧠 Les techniques essentielles</h3>`));
  content.appendChild(techGrid);
  TECHNIQUES_PROMPT.forEach(t=>{
    techGrid.appendChild(el(`<div class="card" style="margin-bottom:0;"><h4 style="margin:0 0 6px;">${t.titre}</h4><p style="margin:0; color:var(--text-muted); font-size:.9rem;">${t.desc}</p></div>`));
  });

  // Prompt Canvas
  content.appendChild(el(`
    <div class="card" style="margin-top:24px;">
      <h3>🧩 Prompt Canvas — construis ton prompt parfait</h3>
      <p class="section-sub" style="margin-bottom:16px;">Réponds aux champs ci-dessous (tous facultatifs, remplis ce que tu sais), et un prompt structuré sera généré automatiquement.</p>
      <form id="canvasForm">
        <label>🎯 Objectif — que veux-tu obtenir ?</label>
        <textarea id="pc-objectif" placeholder="Ex : écrire un post LinkedIn pour annoncer un nouveau produit"></textarea>

        <label>🗂️ Contexte — infos utiles sur ta situation</label>
        <textarea id="pc-contexte" placeholder="Ex : je suis freelance, mon produit est une app de méditation"></textarea>

        <label>🎭 Rôle à donner à l'IA</label>
        <input type="text" id="pc-role" placeholder="Ex : expert en marketing digital">

        <label>📐 Format de sortie souhaité</label>
        <input type="text" id="pc-format" placeholder="Ex : liste à puces, tableau, 150 mots max, code Python...">

        <label>🎨 Ton souhaité</label>
        <select id="pc-ton">
          <option value="">— aucune préférence —</option>
          <option>Professionnel</option>
          <option>Amical et décontracté</option>
          <option>Humoristique</option>
          <option>Pédagogique / simple</option>
          <option>Direct et concis</option>
        </select>

        <label>👥 Public cible</label>
        <input type="text" id="pc-public" placeholder="Ex : des entrepreneurs débutants">

        <label>🚫 Contraintes / à éviter</label>
        <textarea id="pc-contraintes" placeholder="Ex : pas de jargon technique, pas d'emoji, rester factuel"></textarea>

        <label>💬 Exemple à imiter (few-shot, facultatif)</label>
        <textarea id="pc-exemple" placeholder="Colle ici un exemple du style/format que tu veux reproduire"></textarea>

        <label style="display:flex; align-items:center; gap:8px; font-weight:400;">
          <input type="checkbox" id="pc-questions" style="width:auto; margin:0;">
          Demander à l'IA de me poser des questions avant de répondre si quelque chose n'est pas clair
        </label>
        <label style="display:flex; align-items:center; gap:8px; font-weight:400; margin-top:6px;">
          <input type="checkbox" id="pc-cot" style="width:auto; margin:0;">
          Demander un raisonnement étape par étape
        </label>

        <div style="margin-top:14px; display:flex; gap:10px;">
          <button type="button" class="btn" id="pc-generate">✨ Générer le prompt</button>
          <button type="button" class="btn secondary" id="pc-copy">📋 Copier</button>
          <button type="button" class="btn secondary" id="pc-reset">↺ Réinitialiser</button>
        </div>
      </form>
      <div class="output-box" id="pc-output" style="display:none;"></div>
    </div>
  `));

  function generatePrompt(){
    const v = id => document.getElementById(id).value.trim();
    const objectif = v("pc-objectif");
    const contexte = v("pc-contexte");
    const role = v("pc-role");
    const format = v("pc-format");
    const ton = document.getElementById("pc-ton").value;
    const publicCible = v("pc-public");
    const contraintes = v("pc-contraintes");
    const exemple = v("pc-exemple");
    const wantsQuestions = document.getElementById("pc-questions").checked;
    const wantsCot = document.getElementById("pc-cot").checked;

    let parts = [];
    if(role) parts.push(`Tu es ${role}.`);
    if(objectif) parts.push(`TÂCHE : ${objectif}`);
    if(contexte) parts.push(`CONTEXTE : ${contexte}`);
    if(publicCible) parts.push(`PUBLIC CIBLE : ${publicCible}`);
    if(format) parts.push(`FORMAT ATTENDU : ${format}`);
    if(ton) parts.push(`TON À ADOPTER : ${ton}`);
    if(contraintes) parts.push(`CONTRAINTES / À ÉVITER : ${contraintes}`);
    if(exemple) parts.push(`EXEMPLE À T'INSPIRER DU STYLE/FORMAT :\n"""\n${exemple}\n"""`);
    if(wantsCot) parts.push(`Réfléchis étape par étape avant de donner ta réponse finale.`);
    if(wantsQuestions) parts.push(`Avant de répondre, si un élément de ma demande n'est pas clair ou manque d'information essentielle, pose-moi d'abord les questions nécessaires plutôt que de faire des suppositions.`);

    const output = document.getElementById("pc-output");
    if(parts.length === 0){
      output.style.display = "block";
      output.textContent = "Remplis au moins un champ (objectif de préférence) pour générer un prompt.";
      return;
    }
    output.style.display = "block";
    output.textContent = parts.join("\n\n");
  }

  document.getElementById("pc-generate").addEventListener("click", generatePrompt);
  document.getElementById("pc-copy").addEventListener("click", ()=>{
    const output = document.getElementById("pc-output");
    if(!output.textContent) return;
    navigator.clipboard.writeText(output.textContent).then(()=>{
      const btn = document.getElementById("pc-copy");
      const old = btn.textContent;
      btn.textContent = "✅ Copié !";
      setTimeout(()=> btn.textContent = old, 1500);
    }).catch(()=>{});
  });
  document.getElementById("pc-reset").addEventListener("click", ()=>{
    document.getElementById("canvasForm").reset();
    document.getElementById("pc-output").style.display = "none";
  });

  // Gabarits
  content.appendChild(el(`<h3 style="margin-top:28px;">📦 Bibliothèque de gabarits prêts à l'emploi</h3>`));
  const gabaritsDiv = el(`<div class="grid grid-2" id="gabaritsGrid"></div>`);
  content.appendChild(gabaritsDiv);
  GABARITS_PROMPT.forEach((g,i)=>{
    gabaritsDiv.appendChild(el(`
      <div class="card" style="margin-bottom:0;">
        <h4 style="margin:0 0 8px;">${g.nom}</h4>
        <div class="output-box" style="margin-top:0;">${escapeHtml(g.prompt)}</div>
        <button class="btn small secondary" style="margin-top:10px;" data-copy-idx="${i}">📋 Copier ce gabarit</button>
      </div>
    `));
  });
  gabaritsDiv.addEventListener("click", (e)=>{
    if(!e.target.dataset.copyIdx) return;
    const g = GABARITS_PROMPT[e.target.dataset.copyIdx];
    navigator.clipboard.writeText(g.prompt).then(()=>{
      const old = e.target.textContent;
      e.target.textContent = "✅ Copié !";
      setTimeout(()=> e.target.textContent = old, 1500);
    }).catch(()=>{});
  });
}

/* =========================================================
   6. CAS D'USAGE
   ========================================================= */
function renderUsages(){
  content.appendChild(el(`<h2 class="section-title">🛠️ Où l'IA est déjà utilisée</h2>`));
  content.appendChild(el(`<p class="section-sub">Un tour d'horizon, secteur par secteur, de ce que l'IA fait concrètement aujourd'hui.</p>`));
  const grid = el(`<div class="grid grid-2" id="usageGrid"></div>`);
  content.appendChild(grid);
  CAS_USAGE.forEach(u=>{
    grid.appendChild(el(`
      <div class="card" style="margin-bottom:0;">
        <h3 style="margin:0 0 10px;">${u.icone} ${u.domaine}</h3>
        <ul style="margin:0; padding-left:18px; color:var(--text-muted); line-height:1.7;">
          ${u.exemples.map(e=>`<li>${e}</li>`).join("")}
        </ul>
      </div>
    `));
  });
}

/* =========================================================
   7. IA EN LOCAL
   ========================================================= */
function renderLocal(){
  content.appendChild(el(`<h2 class="section-title">💻 Faire tourner une IA en local</h2>`));
  content.appendChild(el(`<p class="section-sub">Le tuto pas à pas pour installer et utiliser une IA gratuitement, en privé, directement sur ton ordinateur.</p>`));
  TUTO_LOCAL.forEach((step,i)=>{
    content.appendChild(el(`
      <div class="card">
        <h3 style="margin:0 0 10px;"><span class="step-num">${i+1}</span>${step.titre.replace(/^\d+\.\s*/, "")}</h3>
        <p style="white-space:pre-line; color:var(--text-muted); margin:0; line-height:1.65;">${escapeHtml(step.contenu)}</p>
      </div>
    `));
  });
  content.appendChild(el(`
    <div class="card">
      <h3>🧰 Récap des outils cités</h3>
      <ul class="tool-links" style="line-height:2;">
        <li><a href="https://ollama.com" target="_blank" rel="noopener noreferrer">Ollama</a> — la façon la plus simple de lancer un LLM en local via le terminal.</li>
        <li><a href="https://lmstudio.ai" target="_blank" rel="noopener noreferrer">LM Studio</a> — interface graphique, sans ligne de commande.</li>
        <li><a href="https://github.com/open-webui/open-webui" target="_blank" rel="noopener noreferrer">Open WebUI</a> — interface de chat façon ChatGPT branchée sur Ollama.</li>
        <li><a href="https://huggingface.co" target="_blank" rel="noopener noreferrer">Hugging Face</a> — catalogue de modèles open-weight à explorer.</li>
      </ul>
    </div>
  `));
}

/* =========================================================
   8. EXERCICES & QUIZ
   ========================================================= */
function renderExercices(){
  content.appendChild(el(`<h2 class="section-title">🏋️ Exercices & quiz</h2>`));
  content.appendChild(el(`<p class="section-sub">Teste tes connaissances avec le quiz, puis entraîne-toi à écrire de vrais prompts avec les exercices pratiques (utilise le Prompt Canvas si besoin).</p>`));

  // Quiz
  content.appendChild(el(`<div class="card"><h3>❓ Quiz de connaissances</h3><div id="quizScore" class="quiz-score"></div><div id="quizContainer"></div></div>`));
  let score = 0;
  let answered = 0;
  const quizContainer = document.getElementById("quizContainer");
  const scoreDiv = document.getElementById("quizScore");
  function updateScore(){
    scoreDiv.textContent = `Score : ${score} / ${QUIZ.length} (${answered} question${answered>1?"s":""} répondue${answered>1?"s":""})`;
  }
  updateScore();

  QUIZ.forEach((q, qi)=>{
    const block = el(`
      <div class="card" style="margin-bottom:14px;">
        <div class="quiz-q">${qi+1}. ${q.q}</div>
        <div class="quiz-options"></div>
        <div class="quiz-exp" style="display:none;"></div>
      </div>
    `);
    const optsDiv = block.querySelector(".quiz-options");
    const expDiv = block.querySelector(".quiz-exp");
    let done = false;
    q.options.forEach((opt, oi)=>{
      const optEl = el(`<div class="quiz-option">${opt}</div>`);
      optEl.addEventListener("click", ()=>{
        if(done) return;
        done = true;
        answered++;
        const isCorrect = oi === q.r;
        if(isCorrect) score++;
        optEl.classList.add(isCorrect ? "correct" : "wrong");
        if(!isCorrect){
          optsDiv.children[q.r].classList.add("correct");
        }
        expDiv.style.display = "block";
        expDiv.textContent = "💡 " + q.exp;
        updateScore();
      });
      optsDiv.appendChild(optEl);
    });
    quizContainer.appendChild(block);
  });

  // Exercices pratiques
  content.appendChild(el(`<h3 style="margin-top:26px;">✍️ Exercices pratiques de prompt</h3>`));
  content.appendChild(el(`<p class="section-sub" style="margin-bottom:16px;">Écris ton prompt dans un outil d'IA (ou dans le Prompt Canvas), puis coche ta propre checklist d'auto-évaluation.</p>`));
  const progress = getProgress();
  EXERCICES_PRATIQUES.forEach((ex, i)=>{
    const key = "ex_" + i;
    const card = el(`
      <div class="card">
        <h4 style="margin:0 0 8px;">${ex.titre}</h4>
        <p style="color:var(--text-muted); margin:0 0 12px;">${ex.consigne}</p>
        <div class="checklist"></div>
      </div>
    `);
    const checklistDiv = card.querySelector(".checklist");
    ex.checklist.forEach((item, ci)=>{
      const itemKey = key + "_" + ci;
      const checked = progress[itemKey] ? "checked" : "";
      const label = el(`<label><input type="checkbox" ${checked}> <span>${item}</span></label>`);
      label.querySelector("input").addEventListener("change", (e)=>{
        const p = getProgress();
        p[itemKey] = e.target.checked;
        saveProgress(p);
      });
      checklistDiv.appendChild(label);
    });
    content.appendChild(card);
  });
}

/* =========================================================
   9. GLOSSAIRE
   ========================================================= */
function renderGlossaire(){
  content.appendChild(el(`<h2 class="section-title">📖 Glossaire</h2>`));
  content.appendChild(el(`<p class="section-sub">Tous les termes techniques de l'IA, expliqués en une phrase. Utilise la recherche pour aller vite.</p>`));
  content.appendChild(el(`<input type="text" class="search-box" id="glossSearch" placeholder="🔍 Rechercher un terme...">`));
  content.appendChild(el(`<div id="glossList"></div>`));

  const allTerms = [
    ...CONCEPTS.map(c=>({terme:c.titre, def:c.def})),
    ...GLOSSAIRE
  ].sort((a,b)=> a.terme.localeCompare(b.terme, "fr"));

  function draw(filter=""){
    const list = document.getElementById("glossList");
    list.innerHTML = "";
    const f = filter.toLowerCase();
    const filtered = allTerms.filter(t => t.terme.toLowerCase().includes(f) || t.def.toLowerCase().includes(f));
    if(filtered.length === 0){
      list.appendChild(el(`<p class="section-sub">Aucun résultat.</p>`));
      return;
    }
    const grid = el(`<div class="grid grid-2"></div>`);
    filtered.forEach(t=>{
      grid.appendChild(el(`
        <div class="card" style="margin-bottom:0;">
          <h4 style="margin:0 0 6px;">${t.terme}</h4>
          <p style="margin:0; color:var(--text-muted); font-size:.88rem; line-height:1.5;">${t.def}</p>
        </div>
      `));
    });
    list.appendChild(grid);
  }
  draw();
  document.getElementById("glossSearch").addEventListener("input", (e)=> draw(e.target.value));
}

/* =========================================================
   10. FORMATION / CARRIÈRE
   ========================================================= */
function renderFormation(){
  content.appendChild(el(`<h2 class="section-title">🚀 Se former à l'IA / Carrière</h2>`));
  content.appendChild(el(`<p class="section-sub">Un parcours progressif pour apprendre sérieusement, jusqu'à potentiellement travailler dans l'IA.</p>`));

  content.appendChild(el(`<h3>🪜 Parcours d'apprentissage</h3>`));
  PARCOURS_FORMATION.forEach(p=>{
    content.appendChild(el(`
      <div class="card">
        <h4 style="margin:0 0 4px;">${p.niveau} <span class="tag">${p.duree}</span></h4>
        <ul style="margin:10px 0 0; padding-left:18px; color:var(--text-muted); line-height:1.7;">
          ${p.objectifs.map(o=>`<li>${o}</li>`).join("")}
        </ul>
      </div>
    `));
  });

  content.appendChild(el(`<h3 style="margin-top:24px;">💼 Métiers de l'IA</h3>`));
  const metierGrid = el(`<div class="grid grid-2" id="metierGrid"></div>`);
  content.appendChild(metierGrid);
  METIERS_IA.forEach(m=>{
    metierGrid.appendChild(el(`
      <div class="card" style="margin-bottom:0;">
        <h4 style="margin:0 0 6px;">${m.nom}</h4>
        <p style="margin:0; color:var(--text-muted); font-size:.88rem;">${m.desc}</p>
      </div>
    `));
  });

  content.appendChild(el(`<h3 style="margin-top:24px;">📚 Ressources pour aller plus loin</h3>`));
  const resDiv = el(`<div class="grid grid-2" id="resGrid"></div>`);
  content.appendChild(resDiv);
  RESSOURCES_APPRENTISSAGE.forEach(r=>{
    resDiv.appendChild(el(`
      <div class="card tool-links" style="margin-bottom:0;">
        <h4 style="margin:0 0 6px;">${r.nom}</h4>
        <p style="margin:0 0 8px; color:var(--text-muted); font-size:.88rem;">${r.desc}</p>
        <a href="${r.url}" target="_blank" rel="noopener noreferrer">${r.url} →</a>
      </div>
    `));
  });
}
